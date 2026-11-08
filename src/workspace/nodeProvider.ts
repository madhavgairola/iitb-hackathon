import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { WorkspaceProvider, SearchResult, SymbolResult, CommandResult } from './types';

const execAsync = promisify(exec);

export class NodeWorkspaceProvider implements WorkspaceProvider {
  private rootPath: string;

  constructor(rootPath: string) {
    this.rootPath = path.resolve(rootPath);
  }

  public getRootPath(): string {
    return this.rootPath;
  }

  private resolvePath(relPath: string): string {
    if (path.isAbsolute(relPath)) {
      return relPath;
    }
    return path.join(this.rootPath, relPath);
  }

  public async readFile(relPath: string): Promise<string> {
    const fullPath = this.resolvePath(relPath);
    return await fs.readFile(fullPath, 'utf-8');
  }

  public async writeFile(relPath: string, content: string): Promise<void> {
    const fullPath = this.resolvePath(relPath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
  }

  public async fileExists(relPath: string): Promise<boolean> {
    try {
      await fs.access(this.resolvePath(relPath));
      return true;
    } catch {
      return false;
    }
  }

  public async listFiles(options?: { pattern?: string; directory?: string; limit?: number }): Promise<string[]> {
    const baseDir = options?.directory ? this.resolvePath(options.directory) : this.rootPath;
    const limit = options?.limit || 200;
    const results: string[] = [];

    const scan = async (dir: string) => {
      if (results.length >= limit) return;
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      // Prioritize src, tests, lib directories first for code-intelligence relevance
      const dirPriority = (name: string): number => {
        const lower = name.toLowerCase();
        if (lower === 'src' || lower === 'lib' || lower === 'app') return 1;
        if (lower === 'tests' || lower === 'test') return 2;
        if (lower.endsWith('.py') || lower.endsWith('.ts') || lower.endsWith('.js')) return 3;
        return 4;
      };

      entries.sort((a, b) => dirPriority(a.name) - dirPriority(b.name));

      for (const entry of entries) {
        if (results.length >= limit) break;
        if (
          entry.name.startsWith('.') ||
          entry.name === 'node_modules' ||
          entry.name === '__pycache__' ||
          entry.name === 'dist' ||
          entry.name === 'build' ||
          entry.name === '.venv' ||
          entry.name === 'venv' ||
          entry.name === 'env' ||
          entry.name === '.tox' ||
          entry.name === 'package-lock.json'
        ) {
          continue;
        }
        const full = path.join(dir, entry.name);
        const rel = path.relative(this.rootPath, full).replace(/\\/g, '/');

        if (entry.isDirectory()) {
          await scan(full);
        } else if (entry.isFile()) {
          if (!options?.pattern || rel.includes(options.pattern)) {
            results.push(rel);
          }
        }
      }
    };

    await scan(baseDir);
    return results;
  }

  public async searchText(
    query: string,
    options?: { maxResults?: number; isRegex?: boolean; filePattern?: string }
  ): Promise<SearchResult[]> {
    const maxResults = options?.maxResults || 50;
    const results: SearchResult[] = [];
    const files = await this.listFiles({ pattern: options?.filePattern, limit: 1000 });

    const regex = options?.isRegex
      ? new RegExp(query, 'gi')
      : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');

    for (const file of files) {
      if (results.length >= maxResults) break;
      try {
        const content = await this.readFile(file);
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            regex.lastIndex = 0; // reset state
            results.push({
              file,
              line: i + 1,
              content: lines[i].trim(),
              preview: lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + 2)).join('\n'),
            });
            if (results.length >= maxResults) break;
          }
        }
      } catch {
        // Skip binary or unreadable files
      }
    }

    return results;
  }

  public async findSymbols(query: string, filePath?: string): Promise<SymbolResult[]> {
    const results: SymbolResult[] = [];
    const files = filePath ? [filePath] : await this.listFiles({ limit: 150 });
    const targetQuery = query.toLowerCase();

    // Regex for common Python and TS symbols
    const pythonSymbolRegex = /^\s*(def|class)\s+([a-zA-Z0-9_]+)/;
    const tsSymbolRegex = /^\s*(export\s+)?(function|class|interface|type|const)\s+([a-zA-Z0-9_]+)/;

    for (const file of files) {
      try {
        const content = await this.readFile(file);
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const pyMatch = line.match(pythonSymbolRegex);
          if (pyMatch) {
            const [, kind, name] = pyMatch;
            if (name.toLowerCase().includes(targetQuery)) {
              results.push({
                file,
                name,
                kind,
                line: i + 1,
              });
            }
            continue;
          }

          const tsMatch = line.match(tsSymbolRegex);
          if (tsMatch) {
            const [, , kind, name] = tsMatch;
            if (name.toLowerCase().includes(targetQuery)) {
              results.push({
                file,
                name,
                kind,
                line: i + 1,
              });
            }
          }
        }
      } catch {
        // Skip unreadable files
      }
    }

    return results;
  }

  public async runCommand(command: string, cwd?: string, timeoutMs: number = 30000): Promise<CommandResult> {
    const start = Date.now();
    const workingDir = cwd ? this.resolvePath(cwd) : this.rootPath;

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: workingDir,
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
      });
      return {
        stdout: stdout || '',
        stderr: stderr || '',
        exitCode: 0,
        durationMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        stdout: err?.stdout || '',
        stderr: err?.stderr || err?.message || '',
        exitCode: typeof err?.code === 'number' ? err.code : 1,
        durationMs: Date.now() - start,
      };
    }
  }
}
