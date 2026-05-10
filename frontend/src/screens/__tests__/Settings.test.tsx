import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import * as apiModule from '../../lib/api';
import * as authModule from '../../lib/auth';
import Settings from '../Settings';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.spyOn(authModule, 'useAuth').mockReturnValue({
    user: { userId: 'u_1', email: 'a@x.com', emailVerified: true, balance: 0, createdAt: '2026-04-01T00:00:00Z' },
    session: { token: 't' } as any,
    loading: false,
    setSession: () => {}, logout: () => {}, refreshUser: async () => {},
  } as any);
});

const renderSettings = () =>
  render(
    <MemoryRouter>
      <Settings />
    </MemoryRouter>,
  );

describe('Settings loading state', () => {
  it('renders MonoLogLoader while fetches are pending', () => {
    const never = new Promise<never>(() => {});
    vi.spyOn(apiModule.api, 'getUsage').mockReturnValue(never as any);
    vi.spyOn(apiModule.api, 'getBuckets').mockReturnValue(never as any);
    vi.spyOn(apiModule.api, 'me').mockReturnValue(never as any);

    renderSettings();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/account/)).toBeInTheDocument();
    expect(screen.getByText(/subscription/)).toBeInTheDocument();
    expect(screen.getByText(/usage stats/)).toBeInTheDocument();
  });

  it('flips loading off even if one fetch rejects', async () => {
    vi.spyOn(apiModule.api, 'getUsage').mockResolvedValue({
      records: [], totals: { consumed: 0, calls: 0 }, hourly24h: [],
    } as any);
    vi.spyOn(apiModule.api, 'getBuckets').mockRejectedValue(new Error('boom'));
    vi.spyOn(apiModule.api, 'me').mockResolvedValue({
      user: { userId: 'u_1', createdAt: '2026-04-01T00:00:00Z' } as any,
    });

    renderSettings();
    await waitFor(() => {
      expect(screen.queryByText('tokenboss · syncing')).toBeNull();
    });
  });
});
