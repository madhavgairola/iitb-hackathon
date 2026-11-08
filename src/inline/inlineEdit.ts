import * as vscode from 'vscode';
import * as path from 'path';
import { TrueForgeHarnessClient } from '../harness/client';
import { DiffStagingManager } from '../diff/staging';
import { WorkspaceProvider } from '../workspace/types';
import { TrueForgeDiffContentProvider } from './diffProvider';

export class InlineEditController {
  private harnessClient: TrueForgeHarnessClient;
  private stagingManager: DiffStagingManager;
  private workspace: WorkspaceProvider;

  constructor(
    harnessClient: TrueForgeHarnessClient,
    stagingManager: DiffStagingManager,
    workspace: WorkspaceProvider
  ) {
    this.harnessClient = harnessClient;
    this.stagingManager = stagingManager;
    this.workspace = workspace;
  }

  /**
   * Generates prompt instructions for inline editing on a target code range.
   */
  public buildInlinePrompt(
    filePath: string,
    startLine: number,
    endLine: number,
    selectedCode: string,
    instruction: string
  ): string {
    return (
      `INLINE EDIT REQUEST on file "${filePath}" (lines ${startLine}-${endLine}):\n\n` +
      `SELECTED CODE:\n\`\`\`\n${selectedCode}\n\`\`\`\n\n` +
      `INSTRUCTION:\n${instruction}\n\n` +
      `REQUIREMENTS:\n` +
      `1. Modify the selected code to satisfy the instruction precisely.\n` +
      `2. Call the propose_edit tool with the complete modified file content and explanation, OR output the modified code.\n` +
      `3. Do NOT make unrelated modifications.`
    );
  }

  /**
   * Applies an inline code modification to the file content in-memory.
   */
  public applySelectedSnippetReplacement(
    fullFileContent: string,
    startLine: number,
    endLine: number,
    replacementSnippet: string
  ): string {
    const lines = fullFileContent.split('\n');
    const startIdx = Math.max(0, startLine - 1);
    const deleteCount = Math.max(1, endLine - startLine + 1);
    const replacementLines = replacementSnippet.split('\n');

    lines.splice(startIdx, deleteCount, ...replacementLines);
    return lines.join('\n');
  }

  /**
   * Executes the inline edit interactive flow in VS Code.
   */
  public async executeInlineEdit(editor: vscode.TextEditor): Promise<void> {
    const document = editor.document;
    const selection = editor.selection;

    let selectedText = document.getText(selection);
    let startLine = selection.start.line + 1;
    let endLine = selection.end.line + 1;

    // If selection is empty, default to current line
    if (!selectedText.trim()) {
      const line = document.lineAt(selection.start.line);
      selectedText = line.text;
      startLine = line.lineNumber + 1;
      endLine = line.lineNumber + 1;
    }

    const relPath = path.relative(this.workspace.getRootPath(), document.uri.fsPath).replace(/\\/g, '/');

    const instruction = await vscode.window.showInputBox({
      title: 'TrueForge: Inline Edit',
      prompt: `Edit ${relPath} (lines ${startLine}-${endLine})`,
      placeHolder: "e.g. 'Treat values off and n as false as well, case-insensitively'",
    });

    if (!instruction) {
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'TrueForge: Generating proposed edit...',
        cancellable: true,
      },
      async (_progress, token) => {
        token.onCancellationRequested(async () => {
          await this.harnessClient.cancelActiveSession();
        });

        const agentName = 'vscode-inline-agent';
        await this.harnessClient.ensureAgent(
          agentName,
          'You are an inline code editor assistant. Modify code precisely according to user instructions.',
          ['vscode-editor']
        );

        const sessionId = await this.harnessClient.getOrCreateSession(agentName);
        const prompt = this.buildInlinePrompt(relPath, startLine, endLine, selectedText, instruction);

        let streamedText = '';
        const turnResult = await this.harnessClient.executeTurn(
          sessionId,
          agentName,
          prompt,
          async (event: any) => {
            if (event.type === 'model.message.delta' || event.type === 'model_message_delta') {
              streamedText += event.content ?? event.delta?.content ?? '';
            }
          }
        );

        if (!turnResult.success) {
          vscode.window.showErrorMessage(`Inline edit failed: ${turnResult.error}`);
          return;
        }

        // Check if edit was staged via tool, or if we need to stage streamed replacement
        const pendingEdits = this.stagingManager.getPendingEdits();
        let targetEdit = pendingEdits.find((e) => e.file === relPath);

        if (!targetEdit && streamedText.trim()) {
          // Extract code block if agent replied with code
          const codeMatch = streamedText.match(/```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```/);
          const snippetToUse = codeMatch ? codeMatch[1] : streamedText;

          const originalContent = document.getText();
          const proposedContent = this.applySelectedSnippetReplacement(
            originalContent,
            startLine,
            endLine,
            snippetToUse
          );

          const summary = await this.stagingManager.stageEdit(relPath, proposedContent, instruction);
          targetEdit = this.stagingManager.getEdit(summary.editId);
        }

        if (!targetEdit) {
          vscode.window.showInformationMessage('No code changes were proposed by the agent.');
          return;
        }

        // Render Native VS Code Diff
        await this.showNativeDiff(document.uri, targetEdit.proposedContent, targetEdit.id);
      }
    );
  }

  /**
   * Opens VS Code side-by-side diff viewer for proposed changes.
   */
  public async showNativeDiff(
    fileUri: vscode.Uri,
    proposedContent: string,
    editId: string
  ): Promise<void> {
    const diffProvider = TrueForgeDiffContentProvider.getInstance();
    const previewUri = vscode.Uri.parse(
      `${TrueForgeDiffContentProvider.SCHEME}:${fileUri.fsPath}?editId=${editId}`
    );

    diffProvider.setContent(previewUri, proposedContent);

    const title = `${path.basename(fileUri.fsPath)} (Proposed Edit)`;
    await vscode.commands.executeCommand('vscode.diff', fileUri, previewUri, title);

    // Prompt user with Accept / Reject action
    const choice = await vscode.window.showInformationMessage(
      `Proposed modification staged for ${path.basename(fileUri.fsPath)}. Accept or Reject?`,
      'Accept Changes',
      'Reject Changes'
    );

    if (choice === 'Accept Changes') {
      await this.stagingManager.applyEdit(editId, true);
      diffProvider.removeContent(previewUri);
      vscode.window.showInformationMessage(`Applied proposed changes to ${path.basename(fileUri.fsPath)}`);
    } else if (choice === 'Reject Changes') {
      this.stagingManager.rejectEdit(editId);
      diffProvider.removeContent(previewUri);
      vscode.window.showInformationMessage(`Rejected proposed changes.`);
    }
  }
}
