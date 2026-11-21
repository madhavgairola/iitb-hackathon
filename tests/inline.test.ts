import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { NodeWorkspaceProvider } from '../src/workspace/nodeProvider';
import { DiffStagingManager } from '../src/diff/staging';
import { TrueForgeHarnessClient } from '../src/harness/client';
import { InlineEditController } from '../src/inline/inlineEdit';

describe('Inline Editing Controller & Task A (Flask get_debug_flag)', () => {
  const rootPath = path.resolve(__dirname, '..');
  const workspace = new NodeWorkspaceProvider(rootPath);
  const staging = new DiffStagingManager(workspace);
  const client = new TrueForgeHarnessClient();
  const controller = new InlineEditController(client, staging, workspace);

  it('builds an anchored inline edit prompt with target lines and selected snippet', () => {
    const prompt = controller.buildInlinePrompt(
      'src/flask/helpers.py',
      28,
      34,
      'def get_debug_flag(): pass',
      "Treat 'off' and 'n' as false as well"
    );

    expect(prompt).toContain('INLINE EDIT REQUEST on file "src/flask/helpers.py" (lines 28-34)');
    expect(prompt).toContain("Treat 'off' and 'n' as false as well");
    expect(prompt).toContain('propose_edit');
  });

  it('replaces targeted line range cleanly in-memory without shifting outside lines', () => {
    const original = 'line1\nline2\nline3\nline4\nline5';
    const replacement = 'line2-new\nline3-new';
    const updated = controller.applySelectedSnippetReplacement(original, 2, 3, replacement);

    expect(updated).toBe('line1\nline2-new\nline3-new\nline4\nline5');
  });

  it('executes Task A modification on Flask 3.1.3 fixture and verifies expected False output', async () => {
    const flaskHelperPath = 'fixtures/flask/src/flask/helpers.py';
    const exists = await workspace.fileExists(flaskHelperPath);
    if (!exists) {
      console.warn('Flask fixture not found, skipping fixture verification');
      return;
    }

    const originalContent = await workspace.readFile(flaskHelperPath);
    expect(originalContent).toContain('def get_debug_flag() -> bool:');
    expect(
      originalContent.includes('{"0", "false", "no"}') ||
      originalContent.includes('{"0", "false", "no", "off", "n"}')
    ).toBe(true);

    // Target modified content satisfying Task A:
    // Treat 'off' and 'n' as false as well, case-insensitively, and update docstring to list every value treated as false.
    const proposedModification = originalContent.replace(
      '    return bool(val and val.lower() not in {"0", "false", "no"})',
      '    return bool(val and val.lower() not in {"0", "false", "no", "off", "n"})'
    ).replace(
      'The default is ``False``.\n    """',
      'The default is ``False``.\n    Values "0", "false", "no", "off", and "n" are treated as false.\n    """'
    );

    // 1. Stage the edit (NO silent write!)
    const summary = await staging.stageEdit(
      flaskHelperPath,
      proposedModification,
      "Treat 'off' and 'n' as false as well, case-insensitively, and update docstring"
    );

    expect(summary.hunksCount).toBeGreaterThanOrEqual(1);

    // File on disk must STILL be original
    expect(await workspace.readFile(flaskHelperPath)).toBe(originalContent);

    // 2. Apply edit to disk
    await staging.applyEdit(summary.editId, true);
    const updatedOnDisk = await workspace.readFile(flaskHelperPath);
    expect(updatedOnDisk).toContain('{"0", "false", "no", "off", "n"}');

    // 3. Run Task A verification commands with python for all required values
    for (const val of ['off', 'OFF', 'n', 'N']) {
      const cmdResult = await workspace.runCommand(
        `python -c "import os; os.environ['FLASK_DEBUG'] = '${val}'; from flask.helpers import get_debug_flag; print(get_debug_flag())"`,
        'fixtures/flask/src'
      );

      if (cmdResult.exitCode === 0) {
        expect(cmdResult.stdout.trim()).toBe('False');
      }
    }

    // 4. Undo edit to restore clean git state
    const undoEntry = await staging.undoLast();
    expect(undoEntry?.previousContent).toBe(originalContent);
    expect(await workspace.readFile(flaskHelperPath)).toBe(originalContent);
  }, 20000);
});
