import { describe, it, expect, beforeEach, vi } from 'vitest';

// Set up session mode (USERNAME/PASSWORD) BEFORE importing newapi.
process.env.NEWAPI_BASE_URL = 'http://newapi.test.local';
delete process.env.NEWAPI_ADMIN_TOKEN;
process.env.NEWAPI_ADMIN_USERNAME = 'admin';
process.env.NEWAPI_ADMIN_PASSWORD = 'admin-pw-test';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function loginResponse(role = 100, id = 1) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'set-cookie': 'session=abc; Path=/; HttpOnly' }),
    text: async () => JSON.stringify({ success: true, message: '', data: { id, role } }),
  } as unknown as Response;
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

// vi.resetModules() each test so newapi's in-module sessionCache starts
// empty — otherwise a session cached by an earlier test leaks in and
// the assertions about "first call triggers login" become flaky.
let newapi: typeof import('../newapi.js').newapi;

beforeEach(async () => {
  fetchMock.mockReset();
  vi.resetModules();
  ({ newapi } = await import('../newapi.js'));
});

describe('newapi admin session mode (login → 401 → re-login)', () => {
  it('logs in once and reuses the cookie for subsequent admin calls', async () => {
    fetchMock
      .mockResolvedValueOnce(loginResponse())                                                       // /api/user/login
      .mockResolvedValueOnce(jsonResponse(200, { success: true, data: { id: 99, username: 'x' } })) // call A
      .mockResolvedValueOnce(jsonResponse(200, { success: true, data: { id: 99, username: 'x' } })); // call B

    await newapi.getUser(99);
    await newapi.getUser(99);

    const calls = fetchMock.mock.calls.map(([u]) => String(u));
    expect(calls.filter((u) => u.endsWith('/api/user/login'))).toHaveLength(1);
    expect(calls.filter((u) => u.endsWith('/api/user/99'))).toHaveLength(2);
    // Both downstream calls carry the same cookie + admin's new-api-user header.
    const callA = fetchMock.mock.calls[1][1];
    expect(callA.headers.cookie).toBe('session=abc');
    expect(callA.headers['new-api-user']).toBe('1');
  });

  it('on 401, invalidates cache and re-logs in once before retrying', async () => {
    fetchMock
      .mockResolvedValueOnce(loginResponse())                                       // initial login
      .mockResolvedValueOnce(jsonResponse(401, { success: false, message: 'expired' })) // first try → 401
      .mockResolvedValueOnce(loginResponse())                                       // forced re-login
      .mockResolvedValueOnce(jsonResponse(200, { success: true, data: { id: 5 } })); // retry succeeds

    const user = await newapi.getUser(5);
    expect(user).toEqual({ id: 5 });

    const urls = fetchMock.mock.calls.map(([u]) => String(u));
    expect(urls).toEqual([
      'http://newapi.test.local/api/user/login',
      'http://newapi.test.local/api/user/5',
      'http://newapi.test.local/api/user/login',
      'http://newapi.test.local/api/user/5',
    ]);
  });

  it('refuses to use a non-admin account (role < 10) so silent 403s on later calls are impossible', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'set-cookie': 'session=xyz; Path=/' }),
      text: async () => JSON.stringify({ success: true, data: { id: 42, role: 1 } }),
    } as unknown as Response);

    await expect(newapi.getUser(1)).rejects.toThrow(/not an admin/);
  });
});
