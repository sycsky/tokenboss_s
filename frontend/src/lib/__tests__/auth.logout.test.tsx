import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from '../auth';
import { setCachedKey, getCachedKey } from '../keyCache';
import * as apiModule from '../api';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

/**
 * Pulls the AuthContext out into a ref so the test can call `logout()`
 * after the provider has hydrated.
 */
function harness(captured: { logout: () => void; setSession: (t: string) => void }) {
  const Probe = () => {
    const auth = useAuth();
    captured.logout = auth.logout;
    captured.setSession = (t: string) => auth.loginWithCode('alice@x.com', '000000').catch(() => {});
    return null;
  };
  return (
    <MemoryRouter>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('auth logout — clears tb_key_v1 cache for the current user', () => {
  it('logout() invokes clearAllCachedKeys for the current user email', async () => {
    // Stub api.me so AuthProvider hydrates with a real user from a stored
    // session token. Without this, state.user is undefined and logout()
    // would no-op the cache clear.
    vi.spyOn(apiModule.api, 'me').mockResolvedValue({
      user: {
        userId: 'u_1',
        email: 'alice@x.com',
        emailVerified: true,
        balance: 0,
        createdAt: '2026-04-01T00:00:00Z',
      },
    } as any);

    // Plant a stored session token so AuthProvider picks it up at mount.
    localStorage.setItem('tb_session', 'fake-token');
    // Plant cache entries for two users.
    setCachedKey('alice@x.com', 'k-alice', 'sk-A');
    setCachedKey('bob@x.com', 'k-bob', 'sk-B');

    const captured: any = {};
    render(harness(captured));

    // Wait for AuthProvider to hydrate the user (calls api.me on mount).
    await waitFor(() => expect(captured.logout).toBeTypeOf('function'));
    // The hydration is async — wait for it to actually populate state.user.
    await waitFor(() =>
      expect(getCachedKey('alice@x.com', 'k-alice')).toBe('sk-A'),
    );

    act(() => captured.logout());

    // Alice's entry is gone; Bob's untouched.
    await waitFor(() => {
      expect(getCachedKey('alice@x.com', 'k-alice')).toBeNull();
    });
    expect(getCachedKey('bob@x.com', 'k-bob')).toBe('sk-B');
    // Session token also cleared.
    expect(localStorage.getItem('tb_session')).toBeNull();
  });
});
