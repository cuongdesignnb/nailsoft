import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('OpenAPI contract', () => {
  it('declares the Sprint 1 API and common response envelopes', async () => {
    const contract = await readFile('docs/api/openapi.yaml', 'utf8');

    expect(contract).toContain('openapi: 3.1.0');
    expect(contract).toContain('/auth/login:');
    expect(contract).toContain('/auth/refresh:');
    expect(contract).toContain('/auth/select-workspace:');
    expect(contract).toContain('/users/invitations:');
    expect(contract).toContain('/auth/mfa/challenge/verify:');
    expect(contract).toContain('requestId:');
    expect(contract).toContain('timestamp:');
  });
});
