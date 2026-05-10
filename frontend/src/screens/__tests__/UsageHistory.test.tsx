import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import * as apiModule from '../../lib/api';
import * as authModule from '../../lib/auth';
import UsageHistory from '../UsageHistory';

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

const renderHistory = () =>
  render(
    <MemoryRouter>
      <UsageHistory />
    </MemoryRouter>,
  );

describe('UsageHistory loading state', () => {
  it('renders MonoLogLoader while loading (fetches not yet resolved)', () => {
    const never = new Promise<never>(() => {});
    vi.spyOn(apiModule.api, 'getBuckets').mockReturnValue(never as any);
    vi.spyOn(apiModule.api, 'getUsage').mockReturnValue(never as any);

    renderHistory();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('tokenboss · syncing')).toBeInTheDocument();
    // Endpoints appear twice — visible spinner row + sr-only announcement.
    expect(screen.getAllByText(/subscription state/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/usage 7d window/).length).toBeGreaterThanOrEqual(1);
    // 旧的"加载中…"裸文字不应再出现
    expect(screen.queryByText('加载中…')).toBeNull();
  });
});
