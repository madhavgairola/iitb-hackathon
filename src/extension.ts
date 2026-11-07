import * as vscode from 'vscode';
import { VSCodeWorkspaceProvider } from './workspace/vscodeProvider';
import { DiffStagingManager } from './diff/staging';
import { LocalMcpServer } from './mcp/server';
import { TrueForgeHarnessClient } from './harness/client';

let mcpServer: LocalMcpServer | undefined;
let harnessClient: TrueForgeHarnessClient | undefined;
let stagingManager: DiffStagingManager | undefined;

export async function activate(context: vscode.ExtensionContext) {
  console.log('TrueForge AI Coding Agent is activating...');

  const workspaceProvider = new VSCodeWorkspaceProvider();
  stagingManager = new DiffStagingManager(workspaceProvider);
  mcpServer = new LocalMcpServer(workspaceProvider, stagingManager);
  harnessClient = new TrueForgeHarnessClient();

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

  // Inline Edit command (Ctrl+K)
  const inlineEditCmd = vscode.commands.registerCommand('trueforge.inlineEdit', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('No active editor found for inline editing.');
      return;
    }

    const selection = editor.selection;
    const selectedText = editor.document.getText(selection);
    const instruction = await vscode.window.showInputBox({
      prompt: 'Describe the modification you want the agent to make to this code:',
      placeHolder: "e.g. 'Treat values off and n as false as well, case-insensitively'",
    });

    if (!instruction) {
      return;
    }

    vscode.window.showInformationMessage(`TrueForge: Generating inline edit for instruction: "${instruction}"...`);
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

  context.subscriptions.push(healthCmd, startChatCmd, inlineEditCmd, undoCmd, cancelTurnCmd);
  console.log('TrueForge AI Coding Agent activated successfully.');
}

export async function deactivate() {
  if (mcpServer) {
    await mcpServer.stop();
    console.log('TrueForge Local MCP Server stopped.');
  }
}
