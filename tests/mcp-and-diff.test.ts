import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'path';
import * as http from 'http';
import { NodeWorkspaceProvider } from '../src/workspace/nodeProvider';
import { DiffStagingManager } from '../src/diff/staging';
import { HunkManager } from '../src/diff/hunks';
import { LocalMcpServer } from '../src/mcp/server';
import { ToolDispatcher } from '../src/mcp/tools';

describe('MCP Server, Tools and Diff Safety Engine', () => {
  const rootPath = path.resolve(__dirname, '..');
  const workspace = new NodeWorkspaceProvider(rootPath);
  const staging = new DiffStagingManager(workspace);
  const dispatcher = new ToolDispatcher(workspace, staging);

  describe('Workspace Provider & Tools', () => {
    it('list_files finds package.json and tsconfig.json', async () => {
      const result = await dispatcher.dispatch('list_files', { pattern: '.json' });
      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text);
      expect(data.files).toContain('package.json');
      expect(data.files).toContain('tsconfig.json');
    });

    it('read_file returns numbered lines for package.json', async () => {
      const result = await dispatcher.dispatch('read_file', {
        path: 'package.json',
        start_line: 1,
        end_line: 5,
      });
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('1: {');
      expect(result.content[0].text).toContain('trueforge-coding-agent');
    });

    it('search_workspace finds keywords across files', async () => {
      const result = await dispatcher.dispatch('search_workspace', {
        query: 'trueforge-coding-agent',
      });
      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text);
      expect(data.match_count).toBeGreaterThan(0);
      expect(data.matches.some((m: any) => m.file === 'package.json')).toBe(true);
    });

    it('run_terminal executes commands and returns output', async () => {
      const result = await dispatcher.dispatch('run_terminal', {
        command: 'node -e "console.log(\'mcp-terminal-test\')"',
      });
      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text);
      expect(data.stdout.trim()).toBe('mcp-terminal-test');
      expect(data.exitCode).toBe(0);
    });
  });

  describe('Diff Safety & Staging Engine (No Silent Writes)', () => {
    it('propose_edit stages edits into buffer without altering file on disk', async () => {
      const original = await workspace.readFile('package.json');
      const proposed = original.replace('"version": "0.1.0"', '"version": "0.2.0"');

      const result = await dispatcher.dispatch('propose_edit', {
        path: 'package.json',
        instruction: 'Bump version for test',
        proposed_content: proposed,
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text);
      expect(data.status).toBe('staged_for_review');
      expect(data.hunksCount).toBe(1);

      // Verify file on disk is UNTOUCHED
      const currentOnDisk = await workspace.readFile('package.json');
      expect(currentOnDisk).toBe(original);
      expect(currentOnDisk).toContain('"version": "0.1.0"');
    });

    it('supports individual hunk accept/reject and applies changes correctly', async () => {
      const initialText = 'line1\nline2\nline3\nline4\nline5';
      const modifiedText = 'line1\nline2-modified\nline3\nline4-modified\nline5';

      const hunks = HunkManager.computeHunks('dummy.txt', initialText, modifiedText, 'test-edit');
      expect(hunks.length).toBeGreaterThanOrEqual(1);

      // Accept first hunk
      hunks[0].status = 'accepted';
      const applied = HunkManager.applyHunks(initialText, hunks);
      expect(applied).toContain('line2-modified');
    });

    it('supports undoing applied edits', async () => {
      const testFile = 'tests/undo-test.tmp';
      await workspace.writeFile(testFile, 'initial content');

      const summary = await staging.stageEdit(testFile, 'new content', 'test edit');
      // Apply the edit
      await staging.applyEdit(summary.editId, true);

      expect(await workspace.readFile(testFile)).toBe('new content');

      // Undo the edit
      const undoEntry = await staging.undoLast();
      expect(undoEntry?.previousContent).toBe('initial content');
      expect(await workspace.readFile(testFile)).toBe('initial content');

      // Clean up test file
      const fs = await import('fs/promises');
      await fs.unlink(path.resolve(rootPath, testFile));
    });
  });

  describe('Local MCP HTTP Server', () => {
    let mcpServer: LocalMcpServer;
    const testPort = 4599;

    beforeAll(async () => {
      mcpServer = new LocalMcpServer(workspace, staging);
      await mcpServer.start(testPort);
    });

    afterAll(async () => {
      await mcpServer.stop();
    });

    it('responds to health check on HTTP port', async () => {
      const health = await new Promise<any>((resolve, reject) => {
        http.get(`http://127.0.0.1:${testPort}/health`, (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => resolve(JSON.parse(body)));
        }).on('error', reject);
      });

      expect(health.status).toBe('ok');
      expect(health.name).toBe('vscode-editor-mcp');
      expect(health.tools).toContain('read_file');
      expect(health.tools).toContain('propose_edit');
      expect(health.tools).toContain('run_terminal');
    });
  });
});
