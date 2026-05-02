import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import * as apiModule from '../../lib/api';
import * as authModule from '../../lib/auth';
import OnboardInstall from '../OnboardInstall';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
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
});

const renderIt = () =>
  render(
    <MemoryRouter>
      <OnboardInstall />
    </MemoryRouter>,
  );

describe('OnboardInstall — show-once flow', () => {
  it('new user (0 keys) creates default + renders the plaintext inline', async () => {
    vi.spyOn(apiModule.api, 'listKeys').mockResolvedValue({ keys: [] });
    vi.spyOn(apiModule.api, 'createKey').mockResolvedValue({
      keyId: 'k-new',
      key: 'sk-NEW-PLAINTEXT',
      label: 'default',
      createdAt: '2026-05-02T00:00:00Z',
      expiresAt: null,
    });

    renderIt();

    await waitFor(() => {
      expect(screen.getByText(/sk-NEW-PLAINTEXT/)).toBeInTheDocument();
    });
  });

  it('any existing default = rebuild prompt (no cache to hit, plaintext unrecoverable)', async () => {
    vi.spyOn(apiModule.api, 'listKeys').mockResolvedValue({
      keys: [
        {
          keyId: 'k-existing',
          key: 'sk-•••abcd',
          label: 'default',
          createdAt: '2026-04-15T00:00:00Z',
          disabled: false,
          expiresAt: null,
        },
      ],
    });
    const createSpy = vi.spyOn(apiModule.api, 'createKey');

    renderIt();

    // The rebuild confirm prompt fires even though the existing default
    // is "usable" — we have no way to surface its plaintext.
    await waitFor(() => {
      expect(screen.getByText(/旧 Key 将被吊销/)).toBeInTheDocument();
    });
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('confirm rebuild → delete old + create new + render plaintext', async () => {
    vi.spyOn(apiModule.api, 'listKeys').mockResolvedValue({
      keys: [
        {
          keyId: 'k-stale',
          key: 'sk-•••abcd',
          label: 'default',
          createdAt: '2026-04-15T00:00:00Z',
          disabled: false,
          expiresAt: null,
        },
      ],
    });
    const deleteSpy = vi.spyOn(apiModule.api, 'deleteKey').mockResolvedValue({ ok: true });
    const createSpy = vi.spyOn(apiModule.api, 'createKey').mockResolvedValue({
      keyId: 'k-fresh',
      key: 'sk-FRESH-PLAINTEXT',
      label: 'default',
      createdAt: '2026-05-02T00:00:00Z',
      expiresAt: null,
    });

    renderIt();

    await waitFor(() => {
      expect(screen.getByText(/旧 Key 将被吊销/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('吊销旧 Key 并生成新的'));
    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith('k-stale');
      expect(createSpy).toHaveBeenCalled();
      expect(screen.getByText(/sk-FRESH-PLAINTEXT/)).toBeInTheDocument();
    });
  });
});
