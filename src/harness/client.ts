import { TrueForge, TrueForgeError } from '@truefoundry/trueforge-sdk';

export interface HarnessConfig {
  baseUrl?: string;
  token?: string;
  primaryModel?: string;   // e.g. "openai/gpt-4o" or "gemini/gemini-2.5-pro"
  fallbackModel?: string;  // e.g. "anthropic/claude-3-7-sonnet" or secondary
}

export type StreamEventHandler = (event: TrueForge.TurnStreamingEvent) => void | Promise<void>;

export class TrueForgeHarnessClient {
  private client: TrueForge;
  private baseUrl: string;
  private primaryModel: string;
  private fallbackModel: string;
  private activeSessionId?: string;
  private activeTurnAbortController?: AbortController;

  constructor(config: HarnessConfig = {}) {
    this.baseUrl = config.baseUrl || 'http://localhost:8790';
    this.primaryModel = config.primaryModel || 'requesty/gpt-4o';
    this.fallbackModel = config.fallbackModel || 'gemini/gemini-2.5-pro';
    this.client = new TrueForge({
      baseUrl: this.baseUrl,
      token: config.token,
    });
  }

  /**
   * Health check to ensure TrueForge local harness server is reachable.
   */
  public async checkHealth(): Promise<{ online: boolean; message: string }> {
    try {
      // TrueForge exposes server capabilities
      const capabilities = await this.client.server.getCapabilities();
      return {
        online: true,
        message: `Connected to TrueForge (${capabilities.version || 'v0.1'})`,
      };
    } catch (err: any) {
      return {
        online: false,
        message: err?.message || 'TrueForge local server unreachable at ' + this.baseUrl,
      };
    }
  }

  /**
   * Register or update a remote MCP Server (such as our local VS Code Editor MCP server).
   */
  public async registerMcpServer(name: string, url: string, description: string): Promise<void> {
    await this.client.settings.mcpServers.createOrUpdate({
      manifest: {
        type: 'remote',
        name,
        url,
        description,
      },
    });
  }

  /**
   * Configure or update model provider credentials (including Requesty router or custom providers).
   */
  public async configureModelProvider(
    providerName: string,
    apiKey: string,
    models: string[],
    baseUrl?: string
  ): Promise<void> {
    const isRequesty = providerName === 'requesty' || apiKey.startsWith('rqsty-');
    const resolvedBaseUrl = baseUrl || (isRequesty ? 'https://router.requesty.ai/v1' : undefined);

    if (isRequesty) {
      await this.client.settings.modelProviders.createOrUpdate({
        manifest: {
          type: 'custom',
          name: 'requesty',
          auth: { apiKey },
          baseUrl: 'https://router.requesty.ai/v1',
          models: models.map((m) => {
            const cleanName = m.replace(/^requesty\//, '').replace(/^openai\//, '');
            return {
              name: cleanName,
              modelId: `openai/${cleanName}`,
              properties: {
                contextLength: 128000,
                maxOutputTokens: 16000,
              },
            };
          }),
        },
      });
      this.primaryModel = 'requesty/gpt-4o';
    } else {
      await this.client.settings.modelProviders.createOrUpdate({
        manifest: {
          type: 'openai',
          auth: { apiKey },
          baseUrl: resolvedBaseUrl,
          models: models.map((m) => ({
            name: m,
            modelId: m,
            properties: {
              contextLength: 128000,
              maxOutputTokens: 16000,
            },
          })),
        },
      });
    }
  }

  /**
   * Ensure the coding agent exists in TrueForge with necessary instructions and tools.
   */
  public async ensureAgent(
    name: string,
    instructions: string,
    mcpServerNames: string[] = ['vscode-editor'],
    modelOverride?: string
  ): Promise<TrueForge.GetAgentResponse> {
    const modelToUse = modelOverride || this.primaryModel;

    // Only attach MCP servers that are actually registered and configured in TrueForge
    let activeMcpServers: string[] = [];
    try {
      const registered = await this.client.settings.mcpServers.list();
      const registeredNames = new Set((registered.data || []).map((s: any) => s.name));
      activeMcpServers = mcpServerNames.filter((s) => registeredNames.has(s));
    } catch {
      activeMcpServers = [];
    }

    const spec: TrueForge.AgentSpec = {
      instructions,
      model: { name: modelToUse },
      ...(activeMcpServers.length > 0
        ? {
            mcpServers: activeMcpServers.map((srv) => ({
              name: srv,
              enableTools: ['@all'],
              preload: true,
            })),
          }
        : {}),
      config: {
        iterationLimit: 60,
        dynamicSubAgents: { enabled: false },
      },
    };

    try {
      const list = await this.client.agents.list();
      const existing = (list.data || []).find((a: any) => a.name === name);
      if (existing) {
        return await this.client.agents.update(existing.id, {
          description: 'VS Code Intelligent Coding Agent',
          manifest: spec,
        });
      }
      return await this.client.agents.create({
        name,
        description: 'VS Code Intelligent Coding Agent',
        manifest: spec,
      });
    } catch {
      // Fallback direct create if listing is not supported
      return await this.client.agents.create({
        name,
        description: 'VS Code Intelligent Coding Agent',
        manifest: spec,
      });
    }
  }

  /**
   * Switch the model of an existing agent (used for Resilience / Fallback).
   */
  public async switchAgentModel(agentName: string, newModelFqn: string): Promise<void> {
    const list = await this.client.agents.list();
    const existing = (list.data || []).find((a: any) => a.name === agentName);
    if (!existing) return;

    const updatedSpec: TrueForge.AgentSpec = {
      ...existing.manifest,
      model: { name: newModelFqn },
    };
    await this.client.agents.update(existing.id, {
      description: existing.description,
      manifest: updatedSpec,
    });
  }

  /**
   * Create or retrieve a working session.
   */
  public async getOrCreateSession(agentName: string): Promise<string> {
    if (this.activeSessionId) {
      try {
        await this.client.sessions.get(this.activeSessionId);
        return this.activeSessionId;
      } catch {
        this.activeSessionId = undefined;
      }
    }

    const session = await this.client.sessions.create({
      agent: { name: agentName },
    });
    this.activeSessionId = session.data.id;
    return session.data.id;
  }

  /**
   * Execute a turn stream with automatic resilience fallback on failure.
   */
  public async executeTurn(
    sessionId: string,
    agentName: string,
    userPrompt: string,
    onEvent: StreamEventHandler
  ): Promise<{ success: boolean; error?: string; usedFallback?: boolean }> {
    this.activeTurnAbortController = new AbortController();

    try {
      await this.runTurnStream(sessionId, userPrompt, onEvent);
      return { success: true };
    } catch (err: any) {
      console.warn('TrueForge turn encountered error:', err?.message || err);

      // Task C Resilience: Check if error is due to model provider error / unreachable endpoint
      const isModelFailure =
        err instanceof TrueForgeError ||
        err?.statusCode === 502 ||
        err?.statusCode === 503 ||
        err?.statusCode === 401 ||
        err?.message?.includes('model') ||
        err?.message?.includes('provider') ||
        err?.message?.includes('unreachable');

      if (isModelFailure && this.fallbackModel && this.fallbackModel !== this.primaryModel) {
        console.warn(`Resilience: Failing over to secondary model [${this.fallbackModel}]...`);
        try {
          await this.switchAgentModel(agentName, this.fallbackModel);
          await this.runTurnStream(sessionId, userPrompt, onEvent);
          return { success: true, usedFallback: true };
        } catch (fallbackErr: any) {
          return {
            success: false,
            error: `Both primary and fallback models failed: ${fallbackErr.message || fallbackErr}`,
          };
        }
      }

      return {
        success: false,
        error: err?.message || 'Turn execution failed',
      };
    } finally {
      this.activeTurnAbortController = undefined;
    }
  }

  private async runTurnStream(
    sessionId: string,
    userPrompt: string,
    onEvent: StreamEventHandler
  ): Promise<void> {
    const stream = await this.client.sessions.createTurnStream(
      sessionId,
      {
        input: [
          {
            type: 'user.message',
            content: userPrompt,
          },
        ],
      },
      {
        abortSignal: this.activeTurnAbortController?.signal,
      }
    );

    for await (const event of stream) {
      await onEvent(event);
      if (event.type === 'turn.done' && (event as any).state?.status === 'error') {
        throw new Error((event as any).state?.message || 'TrueForge turn completed with error state');
      }
    }
  }

  /**
   * Cancel an in-flight session turn cleanly.
   */
  public async cancelActiveSession(): Promise<boolean> {
    if (this.activeTurnAbortController) {
      this.activeTurnAbortController.abort();
    }
    if (this.activeSessionId) {
      try {
        await this.client.sessions.cancel(this.activeSessionId);
        return true;
      } catch (err) {
        console.warn('Failed to cancel session on TrueForge server:', err);
      }
    }
    return false;
  }
}
