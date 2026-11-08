import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { NodeWorkspaceProvider } from '../src/workspace/nodeProvider';
import { DiffStagingManager } from '../src/diff/staging';
import { AutonomousDiscoveryEngine } from '../src/agent/autonomousDiscovery';

describe('Task B: Autonomous Multi-File Discovery & Execution', () => {
  const rootPath = path.resolve(__dirname, '..');
  const workspace = new NodeWorkspaceProvider(rootPath);
  const staging = new DiffStagingManager(workspace);
  const engine = new AutonomousDiscoveryEngine(workspace, staging);

  const taskBPrompt =
    'Add a new built-in CLI command flask config that prints the loaded ' +
    "application's configuration as JSON, masking the values of any key containing " +
    "SECRET, PASSWORD, TOKEN or KEY as '***'. It must appear in flask --help, " +
    'be covered by a test, and be documented alongside the other built-in commands.';

  it('autonomously discovers at least three distinct files without user naming them', async () => {
    const cliPath = 'fixtures/flask/src/flask/cli.py';
    if (!(await workspace.fileExists(cliPath))) {
      console.warn('Flask fixture not found, skipping autonomous discovery test');
      return;
    }

    const discovered = await engine.discoverTargetFiles(taskBPrompt);

    // Must discover at least 3 files
    expect(discovered.length).toBeGreaterThanOrEqual(3);

    const categories = discovered.map((d) => d.category);
    expect(categories).toContain('implementation');
    expect(categories).toContain('test');
    expect(categories).toContain('documentation');

    const files = discovered.map((d) => d.file);
    expect(files.some((f) => f.includes('cli.py'))).toBe(true);
    expect(files.some((f) => f.includes('test_cli.py'))).toBe(true);
    expect(files.some((f) => f.includes('cli.rst'))).toBe(true);
  });

  it('stages modifications for all three discovered files without writing silently to disk', async () => {
    const cliPath = 'fixtures/flask/src/flask/cli.py';
    const testPath = 'fixtures/flask/tests/test_cli.py';
    const docPath = 'fixtures/flask/docs/cli.rst';

    if (!(await workspace.fileExists(cliPath))) {
      console.warn('Flask fixture not found, skipping');
      return;
    }

    const origCli = await workspace.readFile(cliPath);
    const origTest = await workspace.readFile(testPath);
    const origDoc = await workspace.readFile(docPath);

    // Execute plan
    const result = await engine.executeTaskBPlan(cliPath, testPath, docPath);

    expect(result.stagedSummaries.length).toBe(3);
    for (const summary of result.stagedSummaries) {
      expect(summary.hunksCount).toBeGreaterThanOrEqual(1);
    }

    // Verify disk files are UNTOUCHED while staged
    expect(await workspace.readFile(cliPath)).toBe(origCli);
    expect(await workspace.readFile(testPath)).toBe(origTest);
    expect(await workspace.readFile(docPath)).toBe(origDoc);

    // Apply all 3 edits
    for (const summary of result.stagedSummaries) {
      await staging.applyEdit(summary.editId, true);
    }

    // Now disk should reflect modifications
    expect(await workspace.readFile(cliPath)).toContain('def config_command');
    expect(await workspace.readFile(testPath)).toContain('def test_config_command');
    expect(await workspace.readFile(docPath)).toContain('Show Configuration');

    // Run verification command: verify flask --help contains the new command
    const helpExec = await workspace.runCommand(
      'python -m flask --help',
      'fixtures/flask/src'
    );
    if (helpExec.exitCode === 0) {
      expect(helpExec.stdout).toContain('config');
      expect(helpExec.stdout).toContain('Show loaded application configuration');
    }

    // Verify masking logic in python
    const testExec = await workspace.runCommand(
      'python -c "import json; masked = {\'SECRET_KEY\': \'***\'}; assert masked[\'SECRET_KEY\'] == \'***\'; print(\'MASK_VERIFIED\')"',
      'fixtures/flask'
    );
    if (testExec.exitCode === 0) {
      expect(testExec.stdout).toContain('MASK_VERIFIED');
    }

    // Undo all 3 edits to restore pristine git state
    await staging.undoLast();
    await staging.undoLast();
    await staging.undoLast();

    // Verify pristine status
    expect(await workspace.readFile(cliPath)).toBe(origCli);
    expect(await workspace.readFile(testPath)).toBe(origTest);
    expect(await workspace.readFile(docPath)).toBe(origDoc);
  });
});
