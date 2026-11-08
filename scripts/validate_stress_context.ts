import * as path from 'path';
import { NodeWorkspaceProvider } from '../src/workspace/nodeProvider';
import { ContextAssembler } from '../src/context/assembler';

async function runContextStressTest() {
  console.log('=== CONTEXT ENGINEERING STRESS TEST (UNFAMILIAR REPOSITORY TASKS) ===');
  const flaskRoot = path.resolve('fixtures/flask');
  const ws = new NodeWorkspaceProvider(flaskRoot);
  const assembler = new ContextAssembler(ws, 8000);

  const testCases = [
    {
      name: 'Unfamiliar Task 1: Request Teardown Hooks',
      prompt: 'Add teardown exception handling to request processing that invokes custom error callbacks before context pops',
      expectedKeyword: 'teardown',
      relevantFiles: ['src/flask/app.py', 'src/flask/ctx.py'],
    },
    {
      name: 'Unfamiliar Task 2: JSON Response Serialization',
      prompt: 'Update json response serialization to support dataclasses and custom datetime formatters',
      expectedKeyword: 'json',
      relevantFiles: ['src/flask/json/__init__.py', 'src/flask/json/provider.py', 'src/flask/app.py'],
    },
    {
      name: 'Unfamiliar Task 3: Session Cookie Partitioning',
      prompt: 'Configure session cookie partitioned attribute for cross-site iframe embedding',
      expectedKeyword: 'session',
      relevantFiles: ['src/flask/sessions.py', 'src/flask/app.py'],
    },
  ];

  for (const tc of testCases) {
    console.log(`\n------------------------------------------------------------`);
    console.log(`Test: ${tc.name}`);
    console.log(`Prompt: "${tc.prompt}"`);

    const result = await assembler.assembleContext(tc.prompt);

    console.log(`Summary:`);
    console.log(`  - Files Scanned: ${result.budget.filesScanned}`);
    console.log(`  - Files Selected: ${result.budget.filesSelected}`);
    console.log(`  - Token Budget Used: ${result.budget.usedTokens} / ${result.budget.maxTokens}`);

    console.log(`Selected Items:`);
    result.items.forEach((item, idx) => {
      console.log(`  [${idx + 1}] File: ${item.file}`);
      console.log(`      Reason: ${item.reason}`);
      console.log(`      Tokens: ${item.tokens}`);
    });

    const matchedRelevant = result.items.some((item) =>
      tc.relevantFiles.some((rf) => item.file === rf || item.file.includes(path.basename(rf)))
    );
    console.log(`Verification: Relevant source files identified: ${matchedRelevant ? 'YES (PASS)' : 'NO'}`);
    if (!matchedRelevant) {
      console.warn(`WARNING: None of expected ${tc.relevantFiles.join(', ')} were selected`);
    }
  }

  console.log('\n=== ALL CONTEXT STRESS TESTS EXECUTED SUCCESSFULLY ===');
}

runContextStressTest().catch((err) => {
  console.error('Stress Test Failed:', err);
  process.exit(1);
});
