import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api, ApiError } from '../api';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('api.getDeepLink', () => {
  it('POSTs to /v1/deep-link with the stored session token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          user_id: 'u1',
          key_name: 'CC Switch',
          key_id: 99,
          deep_links: [
            { app: 'openclaw', display_name: 'OpenClaw', url: 'ccswitch://import?app=openclaw&token=xxx' },
          ],
          issued_at: '2026-05-13T00:00:00.000Z',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    localStorage.setItem('tb_session', 'fake-jwt');

    const r = await api.getDeepLink();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/v1/deep-link');
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer fake-jwt');

    expect(r.key_name).toBe('CC Switch');
    expect(r.key_id).toBe(99);
    expect(r.deep_links).toHaveLength(1);
    expect(r.deep_links[0].app).toBe('openclaw');
  });

  it('throws ApiError with status 401 and code on missing session', async () => {
    // Factory: every call returns a fresh Response since each consumes
    // the body once. Sharing one instance across two awaited rejects
    // would error with "Body has already been read".
    const make401 = () =>
      new Response(
        JSON.stringify({
          error: { type: 'authentication_error', message: 'no session', code: 'missing_session' },
        }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      );
    globalThis.fetch = vi.fn().mockImplementation(async () => make401()) as unknown as typeof fetch;

    await expect(api.getDeepLink()).rejects.toMatchObject({
      status: 401,
      code: 'missing_session',
    });
    await expect(api.getDeepLink()).rejects.toBeInstanceOf(ApiError);
  });
});
