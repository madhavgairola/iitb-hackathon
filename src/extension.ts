import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  console.log('TrueForge AI Coding Agent is activating...');

  const startChatCmd = vscode.commands.registerCommand('trueforge.startChat', () => {
    vscode.window.showInformationMessage('TrueForge Agent Workspace activated.');
  });

  const inlineEditCmd = vscode.commands.registerCommand('trueforge.inlineEdit', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('No active editor found for inline editing.');
      return;
    }
    const selection = editor.selection;
    const selectedText = editor.document.getText(selection);
    vscode.window.showInformationMessage(
      `TrueForge Inline Edit invoked on ${selectedText.length} characters.`
    );
  });

  const cancelTurnCmd = vscode.commands.registerCommand('trueforge.cancelTurn', () => {
    vscode.window.showInformationMessage('TrueForge run cancelled.');
  });

  context.subscriptions.push(startChatCmd, inlineEditCmd, cancelTurnCmd);
  console.log('TrueForge AI Coding Agent activated successfully.');
}

export function deactivate() {
  console.log('TrueForge AI Coding Agent deactivated.');
}
