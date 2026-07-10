import { describe, expect, it } from 'vitest'; import { HealthController } from '../src/modules/health/health.controller';
describe('HealthController',()=>{it('returns healthy status',()=>expect(new HealthController().getHealth().data.status).toBe('ok'));});
