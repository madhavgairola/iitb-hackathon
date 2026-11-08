import * as path from 'path';
import { NodeWorkspaceProvider } from '../src/workspace/nodeProvider';
import { DiffStagingManager } from '../src/diff/staging';

async function runTaskAValidation() {
  console.log('=== EXACT TASK A VALIDATION ===');
  const root = path.resolve('.');
  const ws = new NodeWorkspaceProvider(root);
  const staging = new DiffStagingManager(ws);
  const file = 'fixtures/flask/src/flask/helpers.py';

  // 1. Verify pristine fixture
  const gitHead = await ws.runCommand('git rev-parse HEAD', 'fixtures/flask');
  console.log('Flask Commit:', gitHead.stdout.trim());

  const original = await ws.readFile(file);
  console.log('Original helpers.py length:', original.length);

  // 2. Exact competition instruction modification
  const proposed = original.replace(
    '    return bool(val and val.lower() not in {"0", "false", "no"})',
    '    return bool(val and val.lower() not in {"0", "false", "no", "off", "n"})'
  ).replace(
    'The default is ``False``.\n    """',
    'The default is ``False``.\n    Values "0", "false", "no", "off", and "n" are treated as false.\n    """'
  );

  // 3. Stage edit (Verify ZERO silent write)
  const summary = await staging.stageEdit(
    file,
    proposed,
    "Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false."
  );

  console.log(`Staged Edit ID: ${summary.editId}`);
  console.log(`Hunks computed: ${summary.hunksCount}, Added lines: +${summary.addedLines}, Deleted lines: -${summary.deletedLines}`);

  const onDiskBeforeAccept = await ws.readFile(file);
  if (onDiskBeforeAccept !== original) {
    throw new Error('FAIL: Disk was written before explicit user acceptance!');
  }
  console.log('PASS: Disk verified untouched prior to acceptance.');

  // 4. Accept proposed edit
  const applySuccess = await staging.applyEdit(summary.editId, true);
  console.log(`Apply Edit Success: ${applySuccess}`);

  const onDiskAfterAccept = await ws.readFile(file);
  if (!onDiskAfterAccept.includes('{"0", "false", "no", "off", "n"}')) {
    throw new Error('FAIL: Target modification not found on disk after accept!');
  }
  console.log('PASS: Target modification applied to disk.');

  // 5. Run exact verification commands against python 3.13
  const testCases = [
    { env: 'off', expected: 'False' },
    { env: 'OFF', expected: 'False' },
    { env: 'n', expected: 'False' },
    { env: 'N', expected: 'False' },
    { env: '0', expected: 'False' },
    { env: 'false', expected: 'False' },
    { env: 'no', expected: 'False' },
    { env: '1', expected: 'True' },
    { env: 'true', expected: 'True' },
  ];

  console.log('\n--- Executing Python Verification Commands ---');
  for (const tc of testCases) {
    const pyScript = `import os; os.environ['FLASK_DEBUG'] = '${tc.env}'; from flask.helpers import get_debug_flag; print(get_debug_flag())`;
    const res = await ws.runCommand(`python -c "${pyScript}"`, 'fixtures/flask/src');
    const actual = res.stdout.trim();
    const status = actual === tc.expected ? 'PASS' : 'FAIL';
    console.log(`FLASK_DEBUG=${tc.env.padEnd(6)} => Output: ${actual.padEnd(6)} (Expected: ${tc.expected}) [${status}]`);
    if (actual !== tc.expected) {
      throw new Error(`Task A check failed for FLASK_DEBUG=${tc.env}: got ${actual}, expected ${tc.expected}`);
    }
  }

  // 6. Test Undo
  const undoResult = await staging.undoLast();
  console.log(`\nUndo Result: Restored ${undoResult?.file}`);
  const onDiskAfterUndo = await ws.readFile(file);
  if (onDiskAfterUndo !== original) {
    throw new Error('FAIL: Disk not identical to original after undo!');
  }
  console.log('PASS: Disk perfectly restored to pristine benchmark state.');
  console.log('=== EXACT TASK A: 100% PASS ===\n');
}

runTaskAValidation().catch((err) => {
  console.error('Task A Validation Failed:', err);
  process.exit(1);
});
