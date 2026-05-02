import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth';
import * as apiModule from '../api';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('AuthProvider — legacy tb_key_v1 cache purge on mount', () => {
  it('drops every tb_key_v1:* entry on first mount (one-shot migration)', async () => {
    // Stub api.me — irrelevant to the purge, but AuthProvider mount
    // calls it if a session token exists. With no token planted, the
    // happy path runs without hitting api.me.
    vi.spyOn(apiModule.api, 'me').mockResolvedValue({} as any);

    // Plant the legacy cache + companion last-email entry the previous
    // release used to write.
    localStorage.setItem('tb_key_v1:alice@x.com:k1', 'sk-LEAKED-PLAINTEXT-1');
    localStorage.setItem('tb_key_v1:alice@x.com:k2', 'sk-LEAKED-PLAINTEXT-2');
    localStorage.setItem('tb_key_v1:bob@x.com:k3', 'sk-LEAKED-PLAINTEXT-3');
    localStorage.setItem('tb_last_email', 'alice@x.com');
    // Plant something unrelated to verify we don't over-purge.
    localStorage.setItem('tb_session', 'unrelated-token-stays');
    localStorage.setItem('some_other_app:k', 'should-stay');

    render(
      <MemoryRouter>
        <AuthProvider>{null}</AuthProvider>
      </MemoryRouter>,
    );

    // Purge runs synchronously inside the mount useEffect. Wait for the
    // first effect to flush, then assert.
    await waitFor(() => {
      expect(localStorage.getItem('tb_key_v1:alice@x.com:k1')).toBeNull();
    });
    expect(localStorage.getItem('tb_key_v1:alice@x.com:k2')).toBeNull();
    expect(localStorage.getItem('tb_key_v1:bob@x.com:k3')).toBeNull();
    expect(localStorage.getItem('tb_last_email')).toBeNull();
    // Untouched: session token + unrelated app entries.
    expect(localStorage.getItem('tb_session')).toBe('unrelated-token-stays');
    expect(localStorage.getItem('some_other_app:k')).toBe('should-stay');
  });

  it('is a no-op when no legacy entries exist', async () => {
    vi.spyOn(apiModule.api, 'me').mockResolvedValue({} as any);
    localStorage.setItem('tb_session', 'just-a-token');

    render(
      <MemoryRouter>
        <AuthProvider>{null}</AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(localStorage.getItem('tb_session')).toBe('just-a-token');
    });
    // Nothing else got created or removed.
    expect(localStorage.length).toBe(1);
  });
});
