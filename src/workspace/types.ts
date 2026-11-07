export interface SearchResult {
  file: string;
  line: number;
  content: string;
  preview?: string;
}

export interface SymbolResult {
  name: string;
  kind?: string;
  file: string;
  line: number;
  containerName?: string;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export interface WorkspaceProvider {
  getRootPath(): string;
  readFile(relPath: string): Promise<string>;
  writeFile(relPath: string, content: string): Promise<void>;
  fileExists(relPath: string): Promise<boolean>;
  listFiles(options?: { pattern?: string; directory?: string; limit?: number }): Promise<string[]>;
  searchText(query: string, options?: { maxResults?: number; isRegex?: boolean; filePattern?: string }): Promise<SearchResult[]>;
  findSymbols(query: string, filePath?: string): Promise<SymbolResult[]>;
  runCommand(command: string, cwd?: string, timeoutMs?: number): Promise<CommandResult>;
}
