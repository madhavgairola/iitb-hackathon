import * as vscode from 'vscode';
import * as path from 'path';
import { WorkspaceProvider, SearchResult, SymbolResult, CommandResult } from './types';
import { NodeWorkspaceProvider } from './nodeProvider';

export class VSCodeWorkspaceProvider implements WorkspaceProvider {
  private fallbackNodeProvider?: NodeWorkspaceProvider;

  constructor() {
    const root = this.getRootPath();
    if (root) {
      this.fallbackNodeProvider = new NodeWorkspaceProvider(root);
    }
  }

  public getRootPath(): string {
    const folders = vscode.workspace.workspaceFolders;
    return folders && folders.length > 0 ? folders[0].uri.fsPath : process.cwd();
  }

  private getUri(relPath: string): vscode.Uri {
    if (path.isAbsolute(relPath)) {
      return vscode.Uri.file(relPath);
    }
    return vscode.Uri.file(path.join(this.getRootPath(), relPath));
  }

  public async readFile(relPath: string): Promise<string> {
    const uri = this.getUri(relPath);
    const data = await vscode.workspace.fs.readFile(uri);
    return new TextDecoder().decode(data);
  }

  public async writeFile(relPath: string, content: string): Promise<void> {
    const uri = this.getUri(relPath);
    const data = new TextEncoder().encode(content);
    await vscode.workspace.fs.writeFile(uri, data);
  }

  public async fileExists(relPath: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(this.getUri(relPath));
      return true;
    } catch {
      return false;
    }
  }

  public async listFiles(options?: { pattern?: string; directory?: string; limit?: number }): Promise<string[]> {
    if (this.fallbackNodeProvider) {
      return await this.fallbackNodeProvider.listFiles(options);
    }
    return [];
  }

  public async searchText(
    query: string,
    options?: { maxResults?: number; isRegex?: boolean; filePattern?: string }
  ): Promise<SearchResult[]> {
    if (this.fallbackNodeProvider) {
      return await this.fallbackNodeProvider.searchText(query, options);
    }
    return [];
  }

  public async findSymbols(query: string, filePath?: string): Promise<SymbolResult[]> {
    try {
      const symbols: vscode.SymbolInformation[] | undefined = await vscode.commands.executeCommand(
        'vscode.executeWorkspaceSymbolProvider',
        query
      );
      if (symbols && symbols.length > 0) {
        return symbols.map((s) => ({
          name: s.name,
          kind: vscode.SymbolKind[s.kind],
          file: path.relative(this.getRootPath(), s.location.uri.fsPath).replace(/\\/g, '/'),
          line: s.location.range.start.line + 1,
          containerName: s.containerName,
        }));
      }
    } catch {
      // Fallback to node provider if VS Code symbol provider is not ready
    }

    if (this.fallbackNodeProvider) {
      return await this.fallbackNodeProvider.findSymbols(query, filePath);
    }
    return [];
  }

  public async runCommand(command: string, cwd?: string, timeoutMs?: number): Promise<CommandResult> {
    if (this.fallbackNodeProvider) {
      return await this.fallbackNodeProvider.runCommand(command, cwd, timeoutMs);
    }
    return {
      stdout: '',
      stderr: 'No workspace opened',
      exitCode: 1,
      durationMs: 0,
    };
  }
}
