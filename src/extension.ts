import * as vscode from 'vscode';
import { VSCodeWorkspaceProvider } from './workspace/vscodeProvider';
import { DiffStagingManager } from './diff/staging';
import { LocalMcpServer } from './mcp/server';
import { TrueForgeHarnessClient } from './harness/client';
import { TrueForgeAgentViewProvider } from './webview/viewProvider';
import { TrueForgeDiffContentProvider } from './inline/diffProvider';
import { InlineEditController } from './inline/inlineEdit';
import { TrueForgeStatusBarIndicator } from './statusbar/indicator';

let mcpServer: LocalMcpServer | undefined;
let harnessClient: TrueForgeHarnessClient | undefined;
let stagingManager: DiffStagingManager | undefined;
let viewProvider: TrueForgeAgentViewProvider | undefined;
let inlineController: InlineEditController | undefined;
let statusBarIndicator: TrueForgeStatusBarIndicator | undefined;

export async function activate(context: vscode.ExtensionContext) {
  console.log('TrueForge AI Coding Agent is activating...');

  const workspaceProvider = new VSCodeWorkspaceProvider();
  stagingManager = new DiffStagingManager(workspaceProvider);
  mcpServer = new LocalMcpServer(workspaceProvider, stagingManager);
  harnessClient = new TrueForgeHarnessClient();
  inlineController = new InlineEditController(harnessClient, stagingManager, workspaceProvider);

  // Status Bar Indicator
  statusBarIndicator = new TrueForgeStatusBarIndicator(harnessClient);
  statusBarIndicator.start();
  context.subscriptions.push({ dispose: () => statusBarIndicator?.dispose() });

  // Register TrueForge Diff Preview Text Document Content Provider
  const diffProvider = TrueForgeDiffContentProvider.getInstance();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      TrueForgeDiffContentProvider.SCHEME,
      diffProvider
    )
  );

  // Register Webview View Provider for Agent Workspace Sidebar
  viewProvider = new TrueForgeAgentViewProvider(
    context.extensionUri,
    harnessClient,
    stagingManager,
    workspaceProvider
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('trueforge.agentView', viewProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // Start local MCP server
  try {
    const endpoint = await mcpServer.start(4545);
    console.log(`TrueForge Local MCP Server started at ${endpoint}`);

    // Register with TrueForge
    harnessClient
      .registerMcpServer(
        'vscode-editor',
        endpoint,
        'VS Code workspace editor tools: reading, searching, staging edits, and terminal execution'
      )
      .then(() => {
        console.log('Successfully registered vscode-editor MCP server with TrueForge.');
        statusBarIndicator?.updateStatus();
      })
      .catch((err) => {
        console.warn('Note: TrueForge server not reachable on startup for MCP registration:', err.message);
      });
  } catch (err: any) {
    console.error('Failed to start Local MCP server:', err);
    vscode.window.showErrorMessage(`Failed to start TrueForge MCP server: ${err.message}`);
  }

  // Health check command
  const healthCmd = vscode.commands.registerCommand('trueforge.checkHealth', async () => {
    if (!harnessClient) return;
    const health = await harnessClient.checkHealth();
    statusBarIndicator?.updateStatus();
    if (health.online) {
      vscode.window.showInformationMessage(`TrueForge Status: Online (${health.message})`);
    } else {
      vscode.window.showWarningMessage(`TrueForge Status: Offline (${health.message})`);
    }
  });

  // Start Chat command
  const startChatCmd = vscode.commands.registerCommand('trueforge.startChat', () => {
    vscode.commands.executeCommand('workbench.view.extension.trueforge-agent-sidebar');
  });

  // Inline Edit command (Ctrl+K / Cmd+K)
  const inlineEditCmd = vscode.commands.registerCommand('trueforge.inlineEdit', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('No active editor found for inline editing.');
      return;
    }
    if (inlineController) {
      await inlineController.executeInlineEdit(editor);
    }
  });

  // Undo Last Edit command
  const undoCmd = vscode.commands.registerCommand('trueforge.undoLastEdit', async () => {
    if (!stagingManager) return;
    const undone = await stagingManager.undoLast();
    if (undone) {
      vscode.window.showInformationMessage(`Undid last change to ${undone.file}`);
    } else {
      vscode.window.showInformationMessage('No changes in undo stack.');
    }
  });

  // Cancel turn command
  const cancelTurnCmd = vscode.commands.registerCommand('trueforge.cancelTurn', async () => {
    if (harnessClient) {
      await harnessClient.cancelActiveSession();
      vscode.window.showInformationMessage('TrueForge run cancelled.');
    }
  });

  // Configure Model API Key command
  const configKeyCmd = vscode.commands.registerCommand('trueforge.configureApiKey', async () => {
    if (!harnessClient) return;

    const provider = await vscode.window.showQuickPick(
      [
        { label: 'gemini', description: 'Google Gemini (gemini-2.5-pro, gemini-2.0-flash)' },
        { label: 'openai', description: 'OpenAI (gpt-4o, gpt-4o-mini)' },
        { label: 'anthropic', description: 'Anthropic (claude-3-7-sonnet)' },
      ],
      { placeHolder: 'Select Model Provider to configure in TrueForge' }
    );

    if (!provider) return;

    const apiKey = await vscode.window.showInputBox({
      title: `Enter API Key for ${provider.label}`,
      password: true,
      placeHolder: 'API key will be sent securely to local TrueForge harness',
    });

    if (!apiKey) return;

    const models =
      provider.label === 'gemini'
        ? ['gemini-2.5-pro', 'gemini-2.0-flash']
        : provider.label === 'openai'
        ? ['gpt-4o', 'gpt-4o-mini']
        : ['claude-3-7-sonnet'];

    try {
      await harnessClient.configureModelProvider(provider.label, apiKey, models);
      vscode.window.showInformationMessage(
        `Successfully configured ${provider.label} in local TrueForge harness!`
      );
      statusBarIndicator?.updateStatus();
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to configure model in TrueForge: ${err.message}`);
    }
  });

  context.subscriptions.push(healthCmd, startChatCmd, inlineEditCmd, undoCmd, cancelTurnCmd, configKeyCmd);
  console.log('TrueForge AI Coding Agent activated successfully.');
}

export async function deactivate() {
  if (statusBarIndicator) {
    statusBarIndicator.dispose();
  }
  if (mcpServer) {
    await mcpServer.stop();
    console.log('TrueForge Local MCP Server stopped.');
  }
}
