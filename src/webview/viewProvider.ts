import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { TrueForgeHarnessClient } from '../harness/client';
import { DiffStagingManager } from '../diff/staging';
import { ContextAssembler } from '../context/assembler';
import { WorkspaceProvider } from '../workspace/types';
import {
  WebviewToExtensionMessage,
  ExtensionToWebviewMessage,
  TimelineEntry,
} from './types';

export class TrueForgeAgentViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private extensionUri: vscode.Uri;
  private harnessClient: TrueForgeHarnessClient;
  private stagingManager: DiffStagingManager;
  private contextAssembler: ContextAssembler;
  private workspace: WorkspaceProvider;

  constructor(
    extensionUri: vscode.Uri,
    harnessClient: TrueForgeHarnessClient,
    stagingManager: DiffStagingManager,
    workspace: WorkspaceProvider
  ) {
    this.extensionUri = extensionUri;
    this.harnessClient = harnessClient;
    this.stagingManager = stagingManager;
    this.workspace = workspace;
    this.contextAssembler = new ContextAssembler(workspace);
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.getHtmlContent();

    webviewView.webview.onDidReceiveMessage(async (message: WebviewToExtensionMessage) => {
      await this.handleMessage(message);
    });
  }

  private getHtmlContent(): string {
    const htmlPath = path.join(this.extensionUri.fsPath, 'src', 'webview', 'ui', 'index.html');
    try {
      return fs.readFileSync(htmlPath, 'utf-8');
    } catch {
      return `<!DOCTYPE html><html><body><h3>Failed to load TrueForge UI</h3></body></html>`;
    }
  }

  private postMessage(msg: ExtensionToWebviewMessage): void {
    if (this.view) {
      this.view.webview.postMessage(msg);
    }
  }

  private async handleMessage(msg: WebviewToExtensionMessage): Promise<void> {
    switch (msg.type) {
      case 'checkHealth': {
        const health = await this.harnessClient.checkHealth();
        this.postMessage({
          type: 'healthStatus',
          online: health.online,
          message: health.message,
        });
        break;
      }

      case 'sendMessage': {
        await this.handleUserTurn(msg.prompt, msg.model);
        break;
      }

      case 'cancelRun': {
        await this.harnessClient.cancelActiveSession();
        this.postMessage({
          type: 'timelineEvent',
          entry: {
            id: 'cancel-' + Date.now(),
            timestamp: Date.now(),
            kind: 'error',
            title: 'Turn Cancelled',
            details: 'Execution cancelled by developer.',
          },
        });
        break;
      }

      case 'acceptHunk': {
        this.stagingManager.updateHunkStatus(msg.editId, msg.hunkId, 'accepted');
        this.postMessage({
          type: 'stagedEdits',
          edits: this.stagingManager.getPendingEdits(),
        });
        break;
      }

      case 'rejectHunk': {
        this.stagingManager.updateHunkStatus(msg.editId, msg.hunkId, 'rejected');
        this.postMessage({
          type: 'stagedEdits',
          edits: this.stagingManager.getPendingEdits(),
        });
        break;
      }

      case 'applyEdit': {
        const applied = await this.stagingManager.applyEdit(msg.editId, msg.acceptAll);
        if (applied) {
          vscode.window.showInformationMessage('Changes successfully applied to workspace.');
        }
        this.postMessage({
          type: 'stagedEdits',
          edits: this.stagingManager.getPendingEdits(),
        });
        break;
      }

      case 'rejectEdit': {
        this.stagingManager.rejectEdit(msg.editId);
        this.postMessage({
          type: 'stagedEdits',
          edits: this.stagingManager.getPendingEdits(),
        });
        break;
      }

      case 'undoEdit': {
        const undone = await this.stagingManager.undoLast();
        if (undone) {
          vscode.window.showInformationMessage(`Undid last applied edit to ${undone.file}`);
        } else {
          vscode.window.showInformationMessage('No actions to undo in stack.');
        }
        this.postMessage({
          type: 'stagedEdits',
          edits: this.stagingManager.getPendingEdits(),
        });
        break;
      }
    }
  }

  private async handleUserTurn(userPrompt: string, modelOverride?: string): Promise<void> {
    const agentName = 'vscode-coding-agent';

    // 1. Context Assembly & Budgeting (Differentiator 1: Explainable Context)
    this.postMessage({
      type: 'timelineEvent',
      entry: {
        id: 'ctx-' + Date.now(),
        timestamp: Date.now(),
        kind: 'searching',
        title: 'Assembling Context',
        details: 'Scanning repository, resolving @mentions, and budgeting tokens...',
      },
    });

    const contextResult = await this.contextAssembler.assembleContext(userPrompt);
    this.postMessage({
      type: 'contextInspected',
      items: contextResult.items,
      budget: contextResult.budget,
    });

    // 2. Prepare System Prompt & Agent
    const systemInstructions =
      'You are a senior AI software engineer pair programming in VS Code. ' +
      'Explore the workspace using tools (read_file, list_files, search_workspace, find_symbol). ' +
      'When you need to modify code, invoke propose_edit. All proposed edits are staged for developer review. ' +
      'When testing is needed, run commands with run_terminal.';

    try {
      await this.harnessClient.ensureAgent(
        agentName,
        systemInstructions,
        ['vscode-editor'],
        modelOverride
      );
    } catch (err: any) {
      this.postMessage({
        type: 'timelineEvent',
        entry: {
          id: 'agent-err-' + Date.now(),
          timestamp: Date.now(),
          kind: 'error',
          title: 'Agent Initialization Error',
          details: err.message || String(err),
        },
      });
    }

    // 3. Obtain or Create TrueForge Session
    let sessionId: string;
    try {
      sessionId = await this.harnessClient.getOrCreateSession(agentName);
    } catch (err: any) {
      this.postMessage({
        type: 'turnDone',
        success: false,
        error: `Failed to create TrueForge session: ${err.message}`,
      });
      return;
    }

    // 4. Inject Assembled Context and Run Turn Stream
    const promptWithContext = contextResult.formattedContext
      ? `${contextResult.formattedContext}\nUser Request: ${userPrompt}`
      : userPrompt;

    this.postMessage({
      type: 'timelineEvent',
      entry: {
        id: 'turn-start-' + Date.now(),
        timestamp: Date.now(),
        kind: 'thinking',
        title: 'Agent Turn Started',
        details: `Executing on TrueForge session [${sessionId.substring(0, 8)}]...`,
      },
    });

    // 5. Execute Turn with SSE streaming
    const turnResult = await this.harnessClient.executeTurn(
      sessionId,
      agentName,
      promptWithContext,
      async (event: any) => {
        // Map TrueForge SSE events directly to Timeline & Chat Stream
        if (event.type === 'model_message_delta') {
          const deltaText = event.delta?.content || '';
          this.postMessage({ type: 'streamDelta', text: deltaText });
        } else if (event.type === 'tool_approval_required') {
          this.postMessage({
            type: 'timelineEvent',
            entry: {
              id: 'approval-' + Date.now(),
              timestamp: Date.now(),
              kind: 'tool_call',
              title: `Tool Approval Required: ${event.tool?.name || 'tool'}`,
              details: JSON.stringify(event.tool?.arguments || {}),
            },
          });
        } else if (event.type === 'tool_response') {
          this.postMessage({
            type: 'timelineEvent',
            entry: {
              id: 'tool-resp-' + Date.now(),
              timestamp: Date.now(),
              kind: 'tool_result',
              title: `Tool Completed: ${event.tool?.name || 'tool'}`,
              details: event.response?.slice?.(0, 150) || 'Done',
            },
          });
          // Update staged edits if propose_edit was called
          this.postMessage({
            type: 'stagedEdits',
            edits: this.stagingManager.getPendingEdits(),
          });
        }
      }
    );

    // Refresh staged edits
    this.postMessage({
      type: 'stagedEdits',
      edits: this.stagingManager.getPendingEdits(),
    });

    this.postMessage({
      type: 'turnDone',
      success: turnResult.success,
      error: turnResult.error,
      usedFallback: turnResult.usedFallback,
    });
  }
}
