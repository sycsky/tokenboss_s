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
    expect(screen.queryByText(/今日剩|Agent 余额/)).toBeNull();
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
