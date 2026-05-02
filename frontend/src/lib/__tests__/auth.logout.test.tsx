import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from '../auth';
import { setCachedKey, getCachedKey } from '../keyCache';
import * as apiModule from '../api';
import { ApiError } from '../api';

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

  it('mount-time 401 (expired stored token) clears tb_key_v1 cache via tb_last_email', async () => {
    // Simulate the user returning after their JWT expired. /v1/me will
    // 401 immediately, BEFORE state.user has been hydrated. The mount
    // path must read tb_last_email to know whose cache to nuke.
    vi.spyOn(apiModule.api, 'me').mockRejectedValue(
      new ApiError(401, undefined, 'Unauthorized'),
    );

    // Stored session + last email + cache entries (the persistent state
    // a real returning user would have on disk after a previous login).
    localStorage.setItem('tb_session', 'expired-token');
    localStorage.setItem('tb_last_email', 'alice@x.com');
    setCachedKey('alice@x.com', 'k-alice-1', 'sk-A1');
    setCachedKey('alice@x.com', 'k-alice-2', 'sk-A2');
    setCachedKey('bob@x.com', 'k-bob', 'sk-B');

    const captured: any = {};
    render(harness(captured));

    // Mount runs /v1/me which 401s — the catch block should wipe the
    // cache for tb_last_email's user, then clear the session + email keys.
    await waitFor(() => {
      expect(localStorage.getItem('tb_session')).toBeNull();
    });

    expect(getCachedKey('alice@x.com', 'k-alice-1')).toBeNull();
    expect(getCachedKey('alice@x.com', 'k-alice-2')).toBeNull();
    expect(getCachedKey('bob@x.com', 'k-bob')).toBe('sk-B');
    expect(localStorage.getItem('tb_last_email')).toBeNull();
  });
});
