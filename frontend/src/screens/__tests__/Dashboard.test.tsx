import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import * as apiModule from '../../lib/api';
import * as authModule from '../../lib/auth';
import { clearBucketsCache } from '../../lib/bucketsCache';
import Dashboard from '../Dashboard';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  // Clear module-level caches so never-resolving promise tests don't
  // bleed in-flight state into subsequent tests.
  clearBucketsCache();

  // Stub auth so Dashboard renders.
  vi.spyOn(authModule, 'useAuth').mockReturnValue({
    user: {
      userId: 'u_1',
      email: 'alice@x.com',
      emailVerified: true,
      balance: 0,
      createdAt: '2026-04-01T00:00:00Z',
    },
    session: { token: 't' } as any,
    loading: false,
    setSession: () => {},
    logout: () => {},
    refreshUser: async () => {},
  } as any);

  // Stub minimal API surface.
  vi.spyOn(apiModule.api, 'getBuckets').mockResolvedValue({ buckets: [] });
  vi.spyOn(apiModule.api, 'getUsage').mockResolvedValue({ records: [], totals: { consumed: 0, calls: 0 }, hourly24h: [] } as any);
  vi.spyOn(apiModule.api, 'getUsageAggregate').mockResolvedValue({ groups: [] } as any);
});

const renderDashboard = () =>
  render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  );

describe('Dashboard loading state', () => {
  it('renders MonoLogLoader while hydrating (fetches not yet resolved)', () => {
    // Never-resolving promises lock Dashboard in hydrating state.
    const never = new Promise<never>(() => {});
    vi.spyOn(apiModule.api, 'getBuckets').mockReturnValue(never as any);
    vi.spyOn(apiModule.api, 'getUsage').mockReturnValue(never as any);
    vi.spyOn(apiModule.api, 'getUsageAggregate').mockReturnValue(never as any);
    vi.spyOn(apiModule.api, 'listKeys').mockReturnValue(never as any);

    renderDashboard();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('tokenboss · syncing')).toBeInTheDocument();
    expect(screen.getByText(/subscription state/)).toBeInTheDocument();
    expect(screen.getByText(/usage 30d/)).toBeInTheDocument();
    expect(screen.getByText(/api keys/)).toBeInTheDocument();
    // No real hero content visible during loading.
    expect(screen.queryByText(/本期剩|Agent 余额/)).toBeNull();
  });

  it('hides MonoLogLoader and renders content after fetches resolve', async () => {
    vi.spyOn(apiModule.api, 'listKeys').mockResolvedValue({ keys: [] });

    renderDashboard();
    // Eventually the loader is gone — content takes over.
    await waitFor(() => {
      expect(screen.queryByText('tokenboss · syncing')).toBeNull();
    });
  });
});

describe('Dashboard cycle countdown', () => {
  // Regression: hero status used to read "本月还 X 天" (subscription end),
  // which lied about the actual quota cycle. Newapi resets amount_used
  // at next_reset_time (e.g. 4pm if user subscribed at 4pm), and the
  // backend ships that boundary as `nextResetAt`. The hero must consume
  // that, not `expiresAt`.
  it('shows cycle reset countdown derived from nextResetAt, not subscription end', async () => {
    const future = new Date(Date.now() + 5 * 3600 * 1000 + 32 * 60 * 1000); // 5h 32m from now
    const farFuture = new Date(Date.now() + 30 * 86400 * 1000); // 30d from now (subscription end)
    vi.spyOn(apiModule.api, 'getBuckets').mockResolvedValue({
      buckets: [
        {
          id: 'bk_plus_1',
          userId: 'u_1',
          skuType: 'plan_plus',
          amountUsd: 30,
          dailyCapUsd: 30,
          dailyRemainingUsd: 18.5,
          totalRemainingUsd: 18.5,
          startedAt: '2026-04-01T16:00:00Z',
          expiresAt: farFuture.toISOString(),
          nextResetAt: future.toISOString(),
          modeLock: 'none',
          modelPool: 'all',
          createdAt: '2026-04-01T16:00:00Z',
        },
      ],
    } as any);
    vi.spyOn(apiModule.api, 'listKeys').mockResolvedValue({ keys: [] });

    renderDashboard();

    // Cycle countdown should show hours+minutes ("Xh Ym 后刷新"), NOT
    // subscription-end "本月还 X 天".
    await waitFor(() => {
      expect(screen.getByText(/\d+h \d+m 后刷新/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/本月还 \d+ 天/)).toBeNull();
    // Label switched from "今日剩" to "本期剩".
    expect(screen.getByText('本期剩')).toBeInTheDocument();
    expect(screen.queryByText('今日剩')).toBeNull();
  });

  // Regression (codex P2): without an auto-refetch on the cycle boundary,
  // a user who keeps /console open across nextResetAt sees the countdown
  // disappear but the depleted pre-reset value linger because bucketsCache
  // (60s TTL) is never invalidated by elapsed time alone.
  it('refetches buckets when the cycle reset boundary passes', async () => {
    const soon = new Date(Date.now() + 80); // boundary fires in 80ms
    const far = new Date(Date.now() + 30 * 86400 * 1000);
    const next = new Date(Date.now() + 24 * 3600 * 1000); // post-reset boundary
    const getBucketsMock = vi.spyOn(apiModule.api, 'getBuckets')
      .mockResolvedValueOnce({
        buckets: [
          {
            id: 'bk_plus_1',
            userId: 'u_1',
            skuType: 'plan_plus',
            amountUsd: 30,
            dailyCapUsd: 30,
            dailyRemainingUsd: 0.5, // depleted pre-reset
            totalRemainingUsd: 0.5,
            startedAt: '2026-04-01T16:00:00Z',
            expiresAt: far.toISOString(),
            nextResetAt: soon.toISOString(),
            modeLock: 'none',
            modelPool: 'all',
            createdAt: '2026-04-01T16:00:00Z',
          },
        ],
      } as any)
      .mockResolvedValueOnce({
        buckets: [
          {
            id: 'bk_plus_1',
            userId: 'u_1',
            skuType: 'plan_plus',
            amountUsd: 30,
            dailyCapUsd: 30,
            dailyRemainingUsd: 30, // full post-reset
            totalRemainingUsd: 30,
            startedAt: '2026-04-01T16:00:00Z',
            expiresAt: far.toISOString(),
            nextResetAt: next.toISOString(),
            modeLock: 'none',
            modelPool: 'all',
            createdAt: '2026-04-01T16:00:00Z',
          },
        ],
      } as any);
    vi.spyOn(apiModule.api, 'listKeys').mockResolvedValue({ keys: [] });

    renderDashboard();

    // First render: pre-reset value visible. The hero renders the `$`
    // sign in a sibling <span>, so match the bare number.
    await waitFor(() => {
      expect(screen.getByText('0.5000')).toBeInTheDocument();
    });

    // After the boundary + 2s buffer + a render tick, getBuckets must
    // have been called a second time AND the hero should show the new
    // full quota.
    await waitFor(
      () => {
        expect(getBucketsMock).toHaveBeenCalledTimes(2);
      },
      { timeout: 4000 },
    );
    await waitFor(() => {
      expect(screen.getByText('30.0000')).toBeInTheDocument();
    });
  }, 6000);

  // When newapi doesn't return a reset boundary (trial / non-resetting
  // plan), the countdown is suppressed rather than falling back to a
  // misleading subscription-end day count.
  it('omits the cycle countdown when nextResetAt is null', async () => {
    vi.spyOn(apiModule.api, 'getBuckets').mockResolvedValue({
      buckets: [
        {
          id: 'bk_plus_1',
          userId: 'u_1',
          skuType: 'plan_plus',
          amountUsd: 30,
          dailyCapUsd: 30,
          dailyRemainingUsd: 30,
          totalRemainingUsd: 30,
          startedAt: '2026-04-01T16:00:00Z',
          expiresAt: '2026-06-01T16:00:00Z',
          nextResetAt: null,
          modeLock: 'none',
          modelPool: 'all',
          createdAt: '2026-04-01T16:00:00Z',
        },
      ],
    } as any);
    vi.spyOn(apiModule.api, 'listKeys').mockResolvedValue({ keys: [] });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('本期剩')).toBeInTheDocument();
    });
    expect(screen.queryByText(/\d+h \d+m 后刷新/)).toBeNull();
    expect(screen.queryByText(/本月还 \d+ 天/)).toBeNull();
  });
});

describe('Dashboard install spell — always-placeholder', () => {
  it('renders the placeholder env line regardless of which keys exist', async () => {
    // The platform never persists plaintext, so the spell always shows
    // a quoted placeholder. Users paste their saved key in themselves.
    vi.spyOn(apiModule.api, 'listKeys').mockResolvedValue({
      keys: [
        {
          keyId: 'k-default',
          key: 'sk-•••a4c2',
          label: 'default',
          createdAt: '2026-04-15T00:00:00Z',
          disabled: false,
          expiresAt: null,
        },
      ],
    });

    renderDashboard();

    await waitFor(() => {
      expect(
        screen.getByText(/TOKENBOSS_API_KEY="<your-api-key>"/),
      ).toBeInTheDocument();
    });
    // No real plaintext shape ever shows up in the spell line.
    expect(screen.queryByText(/TOKENBOSS_API_KEY=sk-/)).toBeNull();
    // Row shows masked, no Copy button anywhere.
    expect(screen.getByText('sk-•••a4c2')).toBeInTheDocument();
    expect(screen.queryByLabelText(/复制 default/)).toBeNull();
  });

  it('with zero keys, still renders the placeholder spell + the empty-state hint', async () => {
    vi.spyOn(apiModule.api, 'listKeys').mockResolvedValue({ keys: [] });

    renderDashboard();

    await waitFor(() => {
      expect(
        screen.getByText(/TOKENBOSS_API_KEY="<your-api-key>"/),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/还没有 Key/)).toBeInTheDocument();
  });
});
