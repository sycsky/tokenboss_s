import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.NEWAPI_BASE_URL = 'http://newapi.test.local';
process.env.NEWAPI_ADMIN_TOKEN = 'admin-token-test';

import { newapi } from '../newapi.js';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

beforeEach(() => {
  fetchMock.mockReset();
});

describe('newapi.createRedemption', () => {
  it('POSTs the right body and returns the freshly minted code', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () =>
        JSON.stringify({
          success: true,
          message: '',
          data: ['11111111-2222-3333-4444-555555555555'],
        }),
    } as unknown as Response);

    const code = await newapi.createRedemption({
      name: 'tb_topup_ord_abc',
      quotaUsd: 100,
    });

    expect(code).toBe('11111111-2222-3333-4444-555555555555');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://newapi.test.local/api/redemption');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.name).toBe('tb_topup_ord_abc');
    expect(body.count).toBe(1);
    expect(body.quota).toBe(100 * 500_000); // $1 = 500_000 quota units
    expect(body.expired_time).toBe(0); // never expire
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('admin-token-test');
  });

  it('throws NewapiError when newapi returns success=false', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () =>
        JSON.stringify({ success: false, message: 'redemption count too large', data: [] }),
    } as unknown as Response);

    await expect(
      newapi.createRedemption({ name: 'tb_t', quotaUsd: 1 }),
    ).rejects.toThrow(/redemption count too large/);
  });

  it('truncates name to 20 chars (newapi limit)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () =>
        JSON.stringify({ success: true, message: '', data: ['code-x'] }),
    } as unknown as Response);

    await newapi.createRedemption({
      name: 'a'.repeat(40),
      quotaUsd: 1,
    });
    const init = fetchMock.mock.calls[0][1];
    const body = JSON.parse(init.body);
    expect(body.name.length).toBe(20);
  });

  it('truncates by rune for CJK names (not by UTF-16 unit)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () =>
        JSON.stringify({ success: true, message: '', data: ['code-cjk'] }),
    } as unknown as Response);

    await newapi.createRedemption({
      name: '中'.repeat(40),
      quotaUsd: 1,
    });
    const init = fetchMock.mock.calls[0][1];
    const body = JSON.parse(init.body);
    // 20 runes, not 60 — rune-correct truncation matches Go's cap
    expect([...body.name].length).toBe(20);
  });
});
