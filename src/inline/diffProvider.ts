import * as vscode from 'vscode';

export class TrueForgeDiffContentProvider implements vscode.TextDocumentContentProvider {
  public static readonly SCHEME = 'trueforge-preview';
  private static instance: TrueForgeDiffContentProvider;

  private contents: Map<string, string> = new Map();
  private onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  public readonly onDidChange = this.onDidChangeEmitter.event;

  public static getInstance(): TrueForgeDiffContentProvider {
    if (!TrueForgeDiffContentProvider.instance) {
      TrueForgeDiffContentProvider.instance = new TrueForgeDiffContentProvider();
    }
    return TrueForgeDiffContentProvider.instance;
  }

  public setContent(uri: vscode.Uri, content: string): void {
    this.contents.set(uri.toString(), content);
    this.onDidChangeEmitter.fire(uri);
  }

  public removeContent(uri: vscode.Uri): void {
    this.contents.delete(uri.toString());
  }

  public provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) || '';
  }
}
