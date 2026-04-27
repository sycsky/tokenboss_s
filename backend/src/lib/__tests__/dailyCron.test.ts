import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock newapi BEFORE importing dailyCron so its top-level
// `import { newapi }` picks up the test double.
vi.mock('../newapi.js', async (orig) => {
  const real = await orig<typeof import('../newapi.js')>();
  return {
    ...real,
    newapi: {
      updateUser: vi.fn(),
    },
  };
});

import { init, putUser, setUserPlan, getUser } from '../store.js';
import { runQuotaSweep } from '../dailyCron.js';
import { newapi } from '../newapi.js';

const updateUserMock = newapi.updateUser as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.SQLITE_PATH = ':memory:';
  init();
  updateUserMock.mockReset();
  updateUserMock.mockResolvedValue({ id: 1, username: 'x', quota: 0, group: 'default' });
});

const futureIso = (offsetMs: number) =>
  new Date(Date.now() + offsetMs).toISOString();
const pastIso = (offsetMs: number) =>
  new Date(Date.now() - offsetMs).toISOString();

function makeUser(over: Partial<{ userId: string; newapiUserId: number | null }> = {}) {
  putUser({
    userId: over.userId ?? 'u_a',
    email: `${over.userId ?? 'u_a'}@x.com`,
    createdAt: new Date().toISOString(),
    plan: 'free',
    newapiUserId: over.newapiUserId ?? 100,
  });
}

describe('runQuotaSweep', () => {
  it('resets only paid users whose quotaNextResetAt is due', async () => {
    // User 1: due (nextResetAt was 1 minute ago)
    makeUser({ userId: 'u_due', newapiUserId: 11 });
    setUserPlan('u_due', {
      plan: 'plus',
      subscriptionStartedAt: pastIso(2 * 86400_000),
      subscriptionExpiresAt: futureIso(28 * 86400_000),
      dailyQuotaUsd: 30,
      quotaNextResetAt: pastIso(60_000),
    });

    // User 2: not due yet (nextResetAt is 12h in the future)
    makeUser({ userId: 'u_pending', newapiUserId: 22 });
    setUserPlan('u_pending', {
      plan: 'plus',
      subscriptionStartedAt: pastIso(12 * 3600_000),
      subscriptionExpiresAt: futureIso(28 * 86400_000),
      dailyQuotaUsd: 30,
      quotaNextResetAt: futureIso(12 * 3600_000),
    });

    const result = await runQuotaSweep();
    expect(result.reset).toBe(1);
    expect(result.expired).toBe(0);
    expect(updateUserMock).toHaveBeenCalledTimes(1);
    expect(updateUserMock).toHaveBeenCalledWith({
      id: 11,
      username: 'due',
      quota: 15_000_000,
      group: 'plus',
    });

    // After successful reset, nextResetAt should advance ~24h forward
    const u = await getUser('u_due');
    const newNext = new Date(u!.quotaNextResetAt!).getTime();
    const expectedNext = Date.now() - 60_000 + 86_400_000;
    // Allow ~5s slop for test execution time
    expect(Math.abs(newNext - expectedNext)).toBeLessThan(5_000);
  });

  it('zeroes quota and downgrades expired paid users', async () => {
    makeUser({ userId: 'u_expired', newapiUserId: 7 });
    setUserPlan('u_expired', {
      plan: 'super',
      subscriptionStartedAt: pastIso(40 * 86400_000),
      subscriptionExpiresAt: pastIso(2 * 86400_000),
      dailyQuotaUsd: 80,
      quotaNextResetAt: pastIso(86400_000),
    });

    const result = await runQuotaSweep();
    expect(result.expired).toBe(1);
    expect(updateUserMock).toHaveBeenCalledWith({
      id: 7,
      username: 'expired',
      quota: 0,
      group: 'free',
    });
    const u = await getUser('u_expired');
    expect(u?.plan).toBe('free');
    expect(u?.subscriptionExpiresAt).toBeUndefined();
    expect(u?.quotaNextResetAt).toBeUndefined();
    expect(u?.dailyQuotaUsd).toBeUndefined();
  });

  it('skips users without a newapi link (graceful)', async () => {
    putUser({
      userId: 'u_unlinked',
      email: 'u@x.com',
      createdAt: new Date().toISOString(),
      plan: 'plus',
      subscriptionExpiresAt: futureIso(20 * 86400_000),
      dailyQuotaUsd: 30,
      quotaNextResetAt: pastIso(60_000),
    });

    const result = await runQuotaSweep();
    expect(result.reset).toBe(0);
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it('counts failures separately, lets batch continue', async () => {
    makeUser({ userId: 'u_p1', newapiUserId: 1 });
    setUserPlan('u_p1', {
      plan: 'plus',
      subscriptionExpiresAt: futureIso(10 * 86400_000),
      dailyQuotaUsd: 30,
      quotaNextResetAt: pastIso(60_000),
    });
    makeUser({ userId: 'u_p2', newapiUserId: 2 });
    setUserPlan('u_p2', {
      plan: 'plus',
      subscriptionExpiresAt: futureIso(10 * 86400_000),
      dailyQuotaUsd: 30,
      quotaNextResetAt: pastIso(60_000),
    });

    updateUserMock
      .mockRejectedValueOnce(new Error('newapi 502'))
      .mockResolvedValueOnce({ id: 2, username: 'p2', quota: 0, group: 'plus' });

    const result = await runQuotaSweep();
    expect(result.reset).toBe(1);
    expect(result.failed).toBe(1);
  });

  it('does not touch free users', async () => {
    makeUser({ userId: 'u_free', newapiUserId: 99 });
    const result = await runQuotaSweep();
    expect(result.reset).toBe(0);
    expect(result.expired).toBe(0);
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it('does not reset paid users whose nextResetAt is null (newly migrated)', async () => {
    putUser({
      userId: 'u_legacy',
      email: 'l@x.com',
      createdAt: new Date().toISOString(),
      plan: 'plus',
      subscriptionExpiresAt: futureIso(20 * 86400_000),
      dailyQuotaUsd: 30,
      newapiUserId: 50,
      // quotaNextResetAt intentionally undefined
    });
    const result = await runQuotaSweep();
    expect(result.reset).toBe(0);
    expect(updateUserMock).not.toHaveBeenCalled();
  });
});
