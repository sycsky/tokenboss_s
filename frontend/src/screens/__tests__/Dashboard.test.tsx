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

    await waitFor(() => {
      expect(screen.getByText(/sk-PLAINTEXT-XYZ/)).toBeInTheDocument();
    });
    expect(screen.getByText(/本地缓存 · 退出登录后将消失/)).toBeInTheDocument();
  });

  it('renders masked + CTA when cache miss for the default key', async () => {
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
      expect(screen.getByText(/这台设备没有该 Key 的本地缓存/)).toBeInTheDocument();
    });
    expect(screen.getByText('为这台设备创建一个新 Key')).toBeInTheDocument();
    expect(screen.queryByText(/sk-PLAINTEXT/)).toBeNull();
    // The install spell stays two-line shape: line 2 is a quoted
    // placeholder, NOT the masked plaintext. Placeholder is obvious
    // enough that no one will skim-paste it into a config and 401.
    expect(screen.getByText(/TOKENBOSS_API_KEY="<your-api-key>"/)).toBeInTheDocument();
    // And no masked-but-real-looking sk-... should appear in the spell.
    expect(screen.queryByText(/TOKENBOSS_API_KEY=sk-/)).toBeNull();
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
      expect(screen.getByText(/sk-PLAINTEXT-GOOD/)).toBeInTheDocument();
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
      expect(screen.getByText(/sk-PLAINTEXT-FRESH/)).toBeInTheDocument();
    });
    // Cache-miss CTA should NOT be visible — we have a usable cached key.
    expect(screen.queryByText(/这台设备没有该 Key 的本地缓存/)).toBeNull();
  });
});
