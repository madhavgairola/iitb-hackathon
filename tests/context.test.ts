import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { NodeWorkspaceProvider } from '../src/workspace/nodeProvider';
import { ContextAssembler } from '../src/context/assembler';

describe('Explainable Context Assembler & Token Budgeter', () => {
  const rootPath = path.resolve(__dirname, '..');
  const workspace = new NodeWorkspaceProvider(rootPath);
  const assembler = new ContextAssembler(workspace, 4000);

  it('resolves explicit @file mentions with top priority', async () => {
    const prompt = 'Please check the configuration in @file:package.json and explain the scripts';
    const result = await assembler.assembleContext(prompt);

    expect(result.items.length).toBeGreaterThan(0);
    const fileItem = result.items.find((i) => i.file === 'package.json');
    expect(fileItem).toBeDefined();
    expect(fileItem?.explicitMention).toBe(true);
    expect(fileItem?.reason).toContain('Explicitly mentioned');
  });

  it('enforces token budget and calculates usage', async () => {
    const prompt = 'Look at @file:package.json and find trueforge-coding-agent';
    const result = await assembler.assembleContext(prompt);

    expect(result.budget.usedTokens).toBeGreaterThan(0);
    expect(result.budget.usedTokens).toBeLessThanOrEqual(result.budget.maxTokens);
    expect(result.budget.filesSelected).toBe(result.items.length);
  });

  it('provides explainability for why each file was selected', async () => {
    const prompt = 'Where is esbuild configured in @file:esbuild.js?';
    const result = await assembler.assembleContext(prompt);

    const esbuildItem = result.items.find((i) => i.file === 'esbuild.js');
    expect(esbuildItem).toBeDefined();
    expect(esbuildItem?.reason).toBeDefined();
    expect(esbuildItem?.tokens).toBeGreaterThan(0);
  });
});
