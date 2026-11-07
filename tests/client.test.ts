import { describe, it, expect, vi } from 'vitest';
import { TrueForgeHarnessClient } from '../src/harness/client';

describe('TrueForgeHarnessClient', () => {
  it('instantiates with custom or default baseUrl and models', () => {
    const client = new TrueForgeHarnessClient({
      baseUrl: 'http://localhost:8000',
      primaryModel: 'openai/gpt-4o',
      fallbackModel: 'gemini/gemini-2.5-pro',
    });
    expect(client).toBeDefined();
  });

  it('reports offline status cleanly when server is unreachable', async () => {
    const client = new TrueForgeHarnessClient({
      baseUrl: 'http://127.0.0.1:9999', // Non-existent port
    });
    const health = await client.checkHealth();
    expect(health.online).toBe(false);
    expect(health.message).toBeDefined();
  });
});
