import * as path from 'path';
import { NodeWorkspaceProvider } from '../src/workspace/nodeProvider';
import { DiffStagingManager } from '../src/diff/staging';
import { TrueForgeHarnessClient } from '../src/harness/client';

async function validateTaskC() {
  console.log('=== EXACT TASK C: RESILIENCE & MODEL FALLBACK VALIDATION ===');
  const flaskRoot = path.resolve('fixtures/flask');
  const ws = new NodeWorkspaceProvider(flaskRoot);
  const staging = new DiffStagingManager(ws);

  // 1. Initial git status
  console.log('\n[1] Checking initial git status in Flask repository...');
  const beforeGit = await ws.runCommand('git status --porcelain');
  console.log(`Git status before: "${beforeGit.stdout.trim()}" (empty means pristine clean)`);
  if (beforeGit.stdout.trim() !== '') {
    throw new Error('Flask fixture is not clean before test!');
  }

  // 2. Configure primary with unreachable/invalid endpoint & secondary model
  console.log('\n[2] Setting up TrueForge client with Primary Model failover to Secondary Model...');
  const configuredPrimary = 'unreachable/model-fail';
  const configuredSecondary = 'gemini/gemini-2.5-pro';

  const client = new TrueForgeHarnessClient({
    baseUrl: 'http://localhost:8790',
    primaryModel: configuredPrimary,
    fallbackModel: configuredSecondary,
  });

  console.log(`Primary Model: ${configuredPrimary}`);
  console.log(`Secondary Model (Configurable): ${configuredSecondary}`);

  // 3. Test automatic failover logic
  console.log('\n[3] Simulating primary failure (401 / unreachable provider) during turn execution...');
  let primaryAttempted = false;
  let fallbackAttempted = false;
  let switchedModelTarget = '';

  (client as any).runTurnStream = async (sessionId: string, prompt: string, onEvent: any) => {
    if (!primaryAttempted) {
      primaryAttempted = true;
      console.log(`  -> Attempting with Primary Model [${configuredPrimary}]...`);
      const err: any = new Error('HTTP 401 Unauthorized: model provider key rejected or model endpoint unreachable');
      err.statusCode = 401;
      throw err;
    }
    fallbackAttempted = true;
    console.log(`  -> Attempting with Fallback Model [${configuredSecondary}]...`);
    onEvent({
      type: 'content_delta',
      data: { delta: { text: 'Task completed successfully via fallback model.' } },
    });
  };

  client.switchAgentModel = async (agentName: string, newModel: string): Promise<any> => {
    console.log(`  -> Resilience Triggered: Switching agent [${agentName}] to secondary model [${newModel}]...`);
    switchedModelTarget = newModel;
    return {} as any;
  };

  const turnResult = await client.executeTurn(
    'test-session-resilience',
    'vscode-coding-agent',
    'Validate Task C resilience fallback',
    async (ev) => {
      if (ev.type === 'content_delta') {
        console.log(`  Event received: ${ev.data.delta.text}`);
      }
    }
  );

  console.log(`Turn result: success=${turnResult.success}, usedFallback=${turnResult.usedFallback}`);
  if (!turnResult.success || !turnResult.usedFallback) {
    throw new Error('FAIL: Resilience fallback did not succeed!');
  }
  if (switchedModelTarget !== configuredSecondary) {
    throw new Error(`FAIL: Did not switch to configured secondary model: ${switchedModelTarget}`);
  }
  console.log('PASS: Automatic fallback to secondary model completed without user intervention!');

  // 4. Test zero partial or corrupted changes on aborted/failed turn
  console.log('\n[4] Testing zero partial/corrupted changes on dead connection...');
  const deadClient = new TrueForgeHarnessClient({
    baseUrl: 'http://127.0.0.1:9999', // Dead offline port
    primaryModel: 'offline/dead',
  });

  const deadResult = await deadClient.executeTurn(
    'dead-session',
    'vscode-coding-agent',
    'Corrupt nothing prompt',
    async () => {}
  );
  console.log(`Dead connection result: success=${deadResult.success}, error="${deadResult.error}"`);
  if (deadResult.success) {
    throw new Error('FAIL: Dead connection should have failed!');
  }

  // 5. Verify staging buffer and git status after failure
  console.log('\n[5] Verifying zero dirty files or partial writes after failures...');
  const pendingEdits = staging.getPendingEdits();
  console.log(`Pending staging edits: ${pendingEdits.length} (expected 0)`);
  if (pendingEdits.length !== 0) {
    throw new Error('FAIL: Stray edits left in staging buffer!');
  }

  const afterGit = await ws.runCommand('git status --porcelain');
  console.log(`Git status after: "${afterGit.stdout.trim()}" (expected clean empty)`);
  if (afterGit.stdout.trim() !== '') {
    throw new Error('FAIL: Git tree is dirty after failed turn!');
  }

  console.log('\n=== TASK C VALIDATION COMPLETE: ALL ASSERTIONS PASSED 100% ===');
}

validateTaskC().catch((err) => {
  console.error('Task C Validation Failed:', err);
  process.exit(1);
});
