import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import * as apiModule from '../../lib/api';
import * as keyCache from '../../lib/keyCache';
import * as authModule from '../../lib/auth';
import Dashboard from '../Dashboard';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();

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

describe('Dashboard install spell — cache hit / miss', () => {
  it('renders plaintext when cache has the default key', async () => {
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
    keyCache.setCachedKey('alice@x.com', 'k-default', 'sk-PLAINTEXT-XYZ');

    renderDashboard();

    // Plaintext appears in TWO places now: the install spell (`TOKENBOSS_API_KEY=sk-...`)
    // AND the list row's value box (cached rows render plaintext + Copy).
    await waitFor(() => {
      expect(
        screen.getByText(/TOKENBOSS_API_KEY=sk-PLAINTEXT-XYZ/),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/本地缓存 · 退出登录后将消失/)).toBeInTheDocument();
    // The list row also shows the bare plaintext + a 复制 button.
    expect(screen.getAllByText(/sk-PLAINTEXT-XYZ/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByLabelText('复制 default')).toBeInTheDocument();
  });

  it('cache miss shows the placeholder, no CTA (the bottom + 创建 button is the action)', async () => {
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

    // Spell shows the placeholder line, not a real plaintext.
    await waitFor(() => {
      expect(
        screen.getByText(/TOKENBOSS_API_KEY="<your-api-key>"/),
      ).toBeInTheDocument();
    });
    // No "缓存 miss" amber CTA — that block was removed; the existing
    // "+ 创建 API Key" button below covers the same action.
    expect(screen.queryByText(/这台设备没有该 Key 的本地缓存/)).toBeNull();
    expect(screen.queryByText('为这台设备创建一个新 Key')).toBeNull();
    // No sk- shaped value in the spell line.
    expect(screen.queryByText(/TOKENBOSS_API_KEY=sk-/)).toBeNull();
    // Row shows masked, no Copy button on the key row itself.
    expect(screen.getByText('sk-•••a4c2')).toBeInTheDocument();
    expect(screen.queryByLabelText('复制 default')).toBeNull();
  });

  it('skips disabled and expired keys when picking the default', async () => {
    vi.spyOn(apiModule.api, 'listKeys').mockResolvedValue({
      keys: [
        {
          keyId: 'k-disabled',
          key: 'sk-•••dead',
          label: 'default',
          createdAt: '2026-04-15T00:00:00Z',
          disabled: true,
          expiresAt: null,
        },
        {
          keyId: 'k-expired',
          key: 'sk-•••0aab',
          label: 'old',
          createdAt: '2026-03-01T00:00:00Z',
          disabled: false,
          expiresAt: '2026-04-01T00:00:00Z',
        },
        {
          keyId: 'k-good',
          key: 'sk-•••f00d',
          label: 'good',
          createdAt: '2026-04-20T00:00:00Z',
          disabled: false,
          expiresAt: null,
        },
      ],
    });
    keyCache.setCachedKey('alice@x.com', 'k-good', 'sk-PLAINTEXT-GOOD');

    renderDashboard();

    await waitFor(() => {
      expect(
        screen.getByText(/TOKENBOSS_API_KEY=sk-PLAINTEXT-GOOD/),
      ).toBeInTheDocument();
    });
  });

  it('sweeps cache entries for keys no longer in the list', async () => {
    vi.spyOn(apiModule.api, 'listKeys').mockResolvedValue({
      keys: [
        {
          keyId: 'k-survive',
          key: 'sk-•••f00d',
          label: 'default',
          createdAt: '2026-04-15T00:00:00Z',
          disabled: false,
          expiresAt: null,
        },
      ],
    });
    keyCache.setCachedKey('alice@x.com', 'k-survive', 'sk-A');
    keyCache.setCachedKey('alice@x.com', 'k-orphan', 'sk-B');

    renderDashboard();

    await waitFor(() => {
      expect(keyCache.getCachedKey('alice@x.com', 'k-orphan')).toBeNull();
    });
    expect(keyCache.getCachedKey('alice@x.com', 'k-survive')).toBe('sk-A');
  });

  it('prefers a cached non-default key over an uncached default (post-rebuild scenario)', async () => {
    // The user has an old `default` whose plaintext was lost on this
    // browser, AND a freshly-created replacement (cached). The spell
    // should render the FRESH key — not block on the stale default.
    vi.spyOn(apiModule.api, 'listKeys').mockResolvedValue({
      keys: [
        {
          keyId: 'k-old-default',
          key: 'sk-•••oldd',
          label: 'default',
          createdAt: '2026-04-01T00:00:00Z',
          disabled: false,
          expiresAt: null,
        },
        {
          keyId: 'k-fresh',
          key: 'sk-•••newx',
          label: 'this-device',
          createdAt: '2026-05-02T00:00:00Z',
          disabled: false,
          expiresAt: null,
        },
      ],
    });
    keyCache.setCachedKey('alice@x.com', 'k-fresh', 'sk-PLAINTEXT-FRESH');
    // Note: NO cache for k-old-default — that's the pre-fix bug scenario.

    renderDashboard();

    await waitFor(() => {
      expect(
        screen.getByText(/TOKENBOSS_API_KEY=sk-PLAINTEXT-FRESH/),
      ).toBeInTheDocument();
    });
    // The cache-miss CTA was removed entirely — the bottom + 创建 button
    // is the action. So this assertion is for "no CTA at all".
    expect(screen.queryByText(/这台设备没有该 Key 的本地缓存/)).toBeNull();
  });
});
