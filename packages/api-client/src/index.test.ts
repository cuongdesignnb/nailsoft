import { describe, expect, it, vi } from 'vitest';
import { createRefreshSingleFlight } from './index';

describe('refresh single-flight', () => {
  it('shares one refresh request across concurrent callers', async () => {
    let release!: (value: boolean) => void;
    const operation = vi.fn()
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => { release = resolve; }))
      .mockResolvedValue(true);
    const refresh = createRefreshSingleFlight(operation);
    const first = refresh();
    const second = refresh();
    expect(first).toBe(second);
    expect(operation).toHaveBeenCalledTimes(1);
    release(true);
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    await refresh();
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('releases the flight after failure so a retry can run', async () => {
    const operation = vi.fn().mockRejectedValueOnce(new Error('revoked family')).mockResolvedValueOnce(true);
    const refresh = createRefreshSingleFlight(operation);
    await expect(refresh()).rejects.toThrow('revoked family');
    await expect(refresh()).resolves.toBe(true);
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
