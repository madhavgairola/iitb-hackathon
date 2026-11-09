import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';
import { NodeWorkspaceProvider } from '../src/workspace/nodeProvider';
import { DiffStagingManager } from '../src/diff/staging';
import { TrueForgeHarnessClient } from '../src/harness/client';

describe('Task C: Resilience, Fault Tolerance & Model Fallback', () => {
  const rootPath = path.resolve(__dirname, '..');
  const workspace = new NodeWorkspaceProvider(rootPath);
  const staging = new DiffStagingManager(workspace);

  beforeEach(async () => {
    await workspace.runCommand('git restore src/flask/helpers.py', 'fixtures/flask');
  });

  it('handles completely unreachable TrueForge endpoint gracefully without throwing uncaught errors', async () => {
    const unreachableClient = new TrueForgeHarnessClient({
      baseUrl: 'http://127.0.0.1:9998', // Offline port
    });

    const result = await unreachableClient.executeTurn(
      'dummy-session',
      'dummy-agent',
      'Treat off and n as false',
      async () => {}
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();

    // Verify git status of target file in Flask benchmark is completely clean
    const gitCheck = await workspace.runCommand('git status --porcelain src/flask/helpers.py', 'fixtures/flask');
    expect(gitCheck.stdout.trim()).toBe('');
  });

  it('automatically falls back to secondary configured model when primary encounters provider error', async () => {
    const client = new TrueForgeHarnessClient({
      primaryModel: 'openai/gpt-4o',
      fallbackModel: 'gemini/gemini-2.5-pro',
    });

    let primaryAttempted = false;
    let fallbackAttempted = false;

    // Spy on internal runTurnStream and switchAgentModel
    vi.spyOn(client as any, 'runTurnStream').mockImplementation(async () => {
      if (!primaryAttempted) {
        primaryAttempted = true;
        const err: any = new Error('Model provider authentication failed: invalid API key');
        err.statusCode = 401;
        throw err;
      }
      fallbackAttempted = true;
    });

    vi.spyOn(client, 'switchAgentModel').mockImplementation(async (_agent, newModel) => {
      expect(newModel).toBe('gemini/gemini-2.5-pro');
    });

    const result = await client.executeTurn(
      'session-resilience',
      'vscode-agent',
      'Treat off and n as false in get_debug_flag',
      async () => {}
    );

    expect(primaryAttempted).toBe(true);
    expect(fallbackAttempted).toBe(true);
    expect(result.success).toBe(true);
    expect(result.usedFallback).toBe(true);
  });

  it('guarantees zero modified or dirty files in workspace on failed turn or cancellation', async () => {
    const flaskHelperPath = 'fixtures/flask/src/flask/helpers.py';
    if (!(await workspace.fileExists(flaskHelperPath))) {
      return;
    }

    const initialContent = await workspace.readFile(flaskHelperPath);

    const client = new TrueForgeHarnessClient({
      baseUrl: 'http://127.0.0.1:9997', // Dead endpoint
    });

    // Run Task A prompt against dead endpoint
    const turnResult = await client.executeTurn(
      'session-fail',
      'vscode-agent',
      'Treat values off and n as false in get_debug_flag',
      async () => {}
    );

    expect(turnResult.success).toBe(false);

    // Verify staging buffer has no stray edits
    expect(staging.getPendingEdits().length).toBe(0);

    // Verify file content is completely identical
    const contentAfterFailure = await workspace.readFile(flaskHelperPath);
    expect(contentAfterFailure).toBe(initialContent);

    // Verify git status of target file is completely clean
    const gitCheck = await workspace.runCommand('git status --porcelain src/flask/helpers.py', 'fixtures/flask');
    expect(gitCheck.stdout.trim()).toBe('');
  });
});
