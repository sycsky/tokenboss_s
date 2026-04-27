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
import { runDailyExpireAndReset } from '../dailyCron.js';
import { newapi } from '../newapi.js';

const updateUserMock = newapi.updateUser as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.SQLITE_PATH = ':memory:';
  init();
  updateUserMock.mockReset();
  updateUserMock.mockResolvedValue({ id: 1, username: 'x', quota: 0, group: 'default' });
});

const futureIso = (days = 7) =>
  new Date(Date.now() + days * 86400_000).toISOString();
const pastIso = (days = 1) =>
  new Date(Date.now() - days * 86400_000).toISOString();

function makeUser(over: Partial<{ userId: string; newapiUserId: number | null }> = {}) {
  putUser({
    userId: over.userId ?? 'u_a',
    email: `${over.userId ?? 'u_a'}@x.com`,
    createdAt: new Date().toISOString(),
    plan: 'free',
    newapiUserId: over.newapiUserId ?? 100,
  });
}

describe('runDailyExpireAndReset', () => {
  it('resets quota to dailyQuotaUsd × 500_000 for active paid users', async () => {
    makeUser({ userId: 'u_paid', newapiUserId: 42 });
    setUserPlan('u_paid', {
      plan: 'plus',
      subscriptionStartedAt: pastIso(2),
      subscriptionExpiresAt: futureIso(28),
      dailyQuotaUsd: 30,
    });

    const result = await runDailyExpireAndReset();
    expect(result.reset).toBe(1);
    expect(result.expired).toBe(0);
    expect(updateUserMock).toHaveBeenCalledWith({
      id: 42,
      username: 'paid',
      quota: 15_000_000, // $30 × 500_000
      group: 'plus',
    });
  });

  it('zeroes quota and downgrades plan for expired paid users', async () => {
    makeUser({ userId: 'u_expired', newapiUserId: 7 });
    setUserPlan('u_expired', {
      plan: 'super',
      subscriptionStartedAt: pastIso(40),
      subscriptionExpiresAt: pastIso(2),
      dailyQuotaUsd: 80,
    });

    const result = await runDailyExpireAndReset();
    expect(result.expired).toBe(1);
    expect(updateUserMock).toHaveBeenCalledWith({
      id: 7,
      username: 'expired',
      quota: 0,
      group: 'default',
    });
    const u = await getUser('u_expired');
    expect(u?.plan).toBe('free');
    expect(u?.subscriptionExpiresAt).toBeUndefined();
    expect(u?.dailyQuotaUsd).toBeUndefined();
  });

  it('skips users without a newapi link (graceful, no throw)', async () => {
    putUser({
      userId: 'u_unlinked',
      email: 'u@x.com',
      createdAt: new Date().toISOString(),
      plan: 'plus',
      subscriptionExpiresAt: futureIso(20),
      dailyQuotaUsd: 30,
      // newapiUserId NOT set
    });

    const result = await runDailyExpireAndReset();
    expect(result.reset).toBe(0);
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it('counts failures separately, lets batch continue', async () => {
    makeUser({ userId: 'u_p1', newapiUserId: 1 });
    setUserPlan('u_p1', {
      plan: 'plus',
      subscriptionExpiresAt: futureIso(10),
      dailyQuotaUsd: 30,
    });
    makeUser({ userId: 'u_p2', newapiUserId: 2 });
    setUserPlan('u_p2', {
      plan: 'plus',
      subscriptionExpiresAt: futureIso(10),
      dailyQuotaUsd: 30,
    });

    updateUserMock
      .mockRejectedValueOnce(new Error('newapi 502'))
      .mockResolvedValueOnce({ id: 2, username: 'p2', quota: 0, group: 'plus' });

    const result = await runDailyExpireAndReset();
    expect(result.reset).toBe(1);
    expect(result.failed).toBe(1);
  });

  it('does not touch free users', async () => {
    makeUser({ userId: 'u_free', newapiUserId: 99 });
    // plan='free' is the default from makeUser
    const result = await runDailyExpireAndReset();
    expect(result.reset).toBe(0);
    expect(result.expired).toBe(0);
    expect(updateUserMock).not.toHaveBeenCalled();
  });
});
