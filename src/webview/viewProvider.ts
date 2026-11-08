import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { TrueForgeHarnessClient } from '../harness/client';
import { DiffStagingManager } from '../diff/staging';
import { extractFilesFromMarkdownText } from '../diff/markdownExtractor';
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

      case 'getWorkspaceFiles': {
        try {
          const files = await this.workspace.listFiles('');
          this.postMessage({
            type: 'workspaceFiles',
            files,
          });
        } catch {
          this.postMessage({
            type: 'workspaceFiles',
            files: [],
          });
        }
        break;
      }

      case 'sendMessage': {
        await this.handleUserTurn(msg.prompt, msg.model);
        break;
      }

      case 'openFile': {
        try {
          const rootPath = this.workspace.getRootPath();
          let filePath = msg.file.trim();
          if (filePath.startsWith('@file:')) {
            filePath = filePath.slice(6);
          }
          const fullPath = path.isAbsolute(filePath)
            ? filePath
            : path.join(rootPath, filePath);

          if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
            const doc = await vscode.workspace.openTextDocument(fullPath);
            await vscode.window.showTextDocument(doc, { preview: true });
          } else {
            // Check if there is an in-memory or staged file with this name
            const staged = this.stagingManager
              .getPendingEdits()
              .find((e) => e.file === filePath || e.file.endsWith(filePath) || fullPath.endsWith(e.file));

            if (staged) {
              const doc = await vscode.workspace.openTextDocument({
                content: staged.proposedContent,
                language: path.extname(staged.file).replace('.', '') || 'python',
              });
              await vscode.window.showTextDocument(doc, { preview: true });
            } else {
              // Try finding file in workspace if only basename was given
              const foundFiles = await this.workspace.listFiles('');
              const matched = foundFiles.find(
                (f) => f === filePath || f.endsWith(`/${filePath}`) || f.endsWith(`\\${filePath}`)
              );
              if (matched) {
                const targetPath = path.join(rootPath, matched);
                const doc = await vscode.workspace.openTextDocument(targetPath);
                await vscode.window.showTextDocument(doc, { preview: true });
              } else {
                vscode.window.showWarningMessage(`File not found: ${filePath}`);
              }
            }
          }
        } catch (err: any) {
          vscode.window.showErrorMessage(`Unable to open file: ${err.message}`);
        }
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
      'You are an autonomous senior AI software engineering agent pair programming in VS Code. ' +
      'CORE RULES OF BEHAVIOR:\n' +
      '1. ALWAYS TAKE ACTION: When the user asks you to create, build, modify, or add files/code, you MUST use the `propose_edit` tool to stage the actual files into the workspace. Do NOT just print code in markdown or explain what to do.\n' +
      '2. MULTI-FILE WORKFLOWS: When building projects, websites, or features that require multiple files (e.g. index.html, styles.css, app.js), call `propose_edit` for each file.\n' +
      '3. EXPLORE BEFORE EDITING: Use `read_file`, `list_files`, `search_workspace`, and `find_symbol` to explore the repository.\n' +
      '4. ZERO SILENT WRITES: All file modifications and creations MUST go through `propose_edit` so they can be inspected and approved in the Diff Review buffer.\n' +
      '5. RUN TERMINAL: Use `run_terminal` to run tests or build commands when requested.';

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
      this.postMessage({
        type: 'turnDone',
        success: false,
        error: `Agent initialization failed: ${err.message || String(err)}`,
      });
      return;
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
    let accumulatedText = '';
    const turnResult = await this.harnessClient.executeTurn(
      sessionId,
      agentName,
      promptWithContext,
      async (event: any) => {
        // Map TrueForge SSE events directly to Timeline & Chat Stream
        if (event.type === 'model.message.delta' || event.type === 'model_message_delta') {
          const deltaText = event.content ?? event.delta?.content ?? '';
          if (deltaText) {
            accumulatedText += deltaText;
            this.postMessage({ type: 'streamDelta', text: deltaText });
          }
        } else if (event.type === 'model.message' || event.type === 'model_message') {
          if (event.content && typeof event.content === 'string') {
            accumulatedText = event.content;
            this.postMessage({ type: 'streamDelta', text: event.content });
          }
        } else if (event.type === 'tool.approval.required' || event.type === 'tool_approval_required') {
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
        } else if (event.type === 'tool.response' || event.type === 'tool_response') {
          this.postMessage({
            type: 'timelineEvent',
            entry: {
              id: 'tool-resp-' + Date.now(),
              timestamp: Date.now(),
              kind: 'tool_result',
              title: `Tool Completed: ${event.tool?.name || event.toolCallId || 'tool'}`,
              details: (event.content || event.response || 'Done').slice(0, 150),
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

    // Auto-staging fallback: If the LLM outputted files in markdown instead of calling propose_edit,
    // automatically extract and stage them into the Diff Review staging buffer.
    const currentPending = this.stagingManager.getPendingEdits();
    if (currentPending.length === 0 && accumulatedText) {
      const extractedFiles = extractFilesFromMarkdownText(accumulatedText);
      for (const file of extractedFiles) {
        await this.stagingManager.stageEdit(
          file.path,
          file.content,
          `Generated by agent for: ${userPrompt.slice(0, 50)}...`
        );
      }
      if (extractedFiles.length > 0) {
        this.postMessage({
          type: 'timelineEvent',
          entry: {
            id: 'auto-stage-' + Date.now(),
            timestamp: Date.now(),
            kind: 'tool_result',
            title: `Auto-Staged ${extractedFiles.length} File(s) to Diff Review Buffer`,
            details: extractedFiles.map((f) => f.path).join(', '),
          },
        });
      }
    }

    // Refresh staged edits
    this.postMessage({
      type: 'stagedEdits',
      edits: this.stagingManager.getPendingEdits(),
    });

    if (turnResult.usedFallback) {
      this.postMessage({
        type: 'timelineEvent',
        entry: {
          id: 'fallback-' + Date.now(),
          timestamp: Date.now(),
          kind: 'warning',
          title: 'Resilience Fallback Triggered',
          details: 'Primary model encountered provider error. Automatically failed over to secondary model without dropping session.',
        },
      });
    }

    this.postMessage({
      type: 'turnDone',
      success: turnResult.success,
      error: turnResult.error,
      usedFallback: turnResult.usedFallback,
    });
  }
}
