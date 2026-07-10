import { describe, expect, it } from 'vitest';
import { idempotencyKeySchema } from './index';
describe('idempotency key', () => { it('rejects short keys', () => expect(idempotencyKeySchema.safeParse('short').success).toBe(false)); });
