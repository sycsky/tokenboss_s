import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

process.env.SESSION_SECRET = 'test-secret-32bytes-min-aaaaaaaaaaa';
process.env.SQLITE_PATH = ':memory:';
process.env.NEWAPI_BASE_URL = 'http://newapi.test.local';
process.env.NEWAPI_ADMIN_TOKEN = 'admin-token-test';
process.env.GITHUB_CLIENT_ID = 'iv_test_client';
process.env.GITHUB_CLIENT_SECRET = 'test_client_secret';
process.env.APP_URL = 'https://app.test.local';

import { init, putUser, getUser, getOauthUserId, getUserIdByEmail } from '../../lib/store.js';
import { newapi } from '../../lib/newapi.js';
import { verifySession } from '../../lib/authTokens.js';
import { oauthStartHandler, oauthCallbackHandler } from '../oauthHandlers.js';

beforeAll(() => {
  init();
});

// ---------- helpers ----------

function event(over: {
  provider?: string;
  query?: Record<string, string>;
  cookie?: string;
} = {}): APIGatewayProxyEventV2 {
  return {
    headers: over.cookie !== undefined ? { cookie: over.cookie } : {},
    pathParameters: { provider: over.provider ?? 'github' },
    queryStringParameters: over.query,
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

type GhUser = { id?: number; login?: string; name?: string | null };
type GhEmail = { email: string; primary: boolean; verified: boolean };

/** Stub the three GitHub endpoints the callback hits. */
function mockGithub(opts: {
  user?: GhUser;
  emails?: GhEmail[];
  tokenError?: boolean;
} = {}) {
  const fetchMock = vi.fn(async (url: string | URL) => {
    const u = String(url);
    const json = (body: unknown, ok = true, status = 200) =>
      ({ ok, status, json: async () => body }) as unknown as Response;
    if (u.includes('github.com/login/oauth/access_token')) {
      return opts.tokenError
        ? json({ error: 'bad_verification_code' }, true, 200)
        : json({ access_token: 'gho_test' });
    }
    if (u.includes('api.github.com/user/emails')) {
      return json(opts.emails ?? [{ email: 'octo@test.local', primary: true, verified: true }]);
    }
    if (u.includes('api.github.com/user')) {
      return json(opts.user ?? { id: 424242, login: 'octo', name: 'Octo Cat' });
    }
    throw new Error(`unexpected fetch: ${u}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function headersOf(res: APIGatewayProxyStructuredResultV2): Record<string, string> {
  return (res.headers ?? {}) as Record<string, string>;
}

/** Run start, return the state that landed in cookie + authorize URL. */
async function startAndGetState(): Promise<{ state: string; cookie: string }> {
  const res = (await oauthStartHandler(event())) as APIGatewayProxyStructuredResultV2;
  const h = headersOf(res);
  const state = new URL(h.location).searchParams.get('state')!;
  const cookie = h['set-cookie'].split(';')[0]; // "tb_oauth_state=<hex>"
  return { state, cookie };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.spyOn(newapi, 'provisionUser').mockResolvedValue({ newapiUserId: 88 } as never);
});

// ---------- /start ----------

describe('oauthStartHandler', () => {
  it('302s to GitHub authorize with a state pinned in an HttpOnly cookie', async () => {
    const res = (await oauthStartHandler(event())) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(302);
    const h = headersOf(res);
    const loc = new URL(h.location);
    expect(loc.origin + loc.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(loc.searchParams.get('client_id')).toBe('iv_test_client');
    expect(loc.searchParams.get('scope')).toBe('user:email');
    const state = loc.searchParams.get('state')!;
    expect(state).toMatch(/^[0-9a-f]{32}$/);
    expect(h['set-cookie']).toContain(`tb_oauth_state=${state}`);
    expect(h['set-cookie']).toContain('HttpOnly');
    expect(h['set-cookie']).toContain('SameSite=Lax');
  });

  it('redirects to login with not_configured for unknown providers', async () => {
    const res = (await oauthStartHandler(
      event({ provider: 'gitlab' }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(302);
    expect(headersOf(res).location).toBe(
      'https://app.test.local/login?oauth_error=not_configured',
    );
  });
});

// ---------- /callback ----------

describe('oauthCallbackHandler', () => {
  it('creates a new user + identity and hands the JWT over in the fragment', async () => {
    mockGithub();
    const { state, cookie } = await startAndGetState();

    const res = (await oauthCallbackHandler(
      event({ query: { code: 'c0de', state }, cookie }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(302);
    const loc = headersOf(res).location;
    expect(loc.startsWith('https://app.test.local/oauth/callback#')).toBe(true);

    const frag = new URLSearchParams(loc.split('#')[1]);
    expect(frag.get('isNew')).toBe('1');
    const claims = verifySession(frag.get('token')!);
    expect(claims).not.toBeNull();

    const userId = getOauthUserId('github', '424242');
    expect(userId).toBe(claims!.sub);
    const user = await getUser(userId!);
    expect(user?.email).toBe('octo@test.local');
    expect(user?.emailVerified).toBe(true);
    expect(user?.newapiUserId).toBe(88);
    // State cookie must be cleared after use.
    expect(headersOf(res)['set-cookie']).toContain('Max-Age=0');
  });

  it('logs an existing identity straight in (isNew=0), no re-provisioning', async () => {
    mockGithub();
    const provisionSpy = vi.spyOn(newapi, 'provisionUser');
    const existingUserId = getOauthUserId('github', '424242');
    expect(existingUserId).not.toBeNull(); // from the previous test's signup

    const { state, cookie } = await startAndGetState();
    const res = (await oauthCallbackHandler(
      event({ query: { code: 'c0de', state }, cookie }),
    )) as APIGatewayProxyStructuredResultV2;

    const frag = new URLSearchParams(headersOf(res).location.split('#')[1]);
    expect(frag.get('isNew')).toBe('0');
    expect(verifySession(frag.get('token')!)?.sub).toBe(existingUserId);
    expect(provisionSpy).not.toHaveBeenCalled();
  });

  it('merges into an existing account when the verified email matches', async () => {
    putUser({
      userId: 'u_email_first',
      email: 'linked@test.local',
      createdAt: new Date().toISOString(),
      emailVerified: false,
    });
    mockGithub({
      user: { id: 777, login: 'linker', name: 'Linker' },
      emails: [{ email: 'linked@test.local', primary: true, verified: true }],
    });

    const { state, cookie } = await startAndGetState();
    const res = (await oauthCallbackHandler(
      event({ query: { code: 'c0de', state }, cookie }),
    )) as APIGatewayProxyStructuredResultV2;

    const frag = new URLSearchParams(headersOf(res).location.split('#')[1]);
    expect(frag.get('isNew')).toBe('0');
    expect(verifySession(frag.get('token')!)?.sub).toBe('u_email_first');
    expect(getOauthUserId('github', '777')).toBe('u_email_first');
    // GitHub's verified email is inbox proof — the account gets verified.
    expect((await getUser('u_email_first'))?.emailVerified).toBe(true);
  });

  it('rejects when the state cookie is missing or does not match', async () => {
    mockGithub();
    const { state } = await startAndGetState();

    const noCookie = (await oauthCallbackHandler(
      event({ query: { code: 'c0de', state } }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(headersOf(noCookie).location).toContain('oauth_error=state_mismatch');

    const wrongCookie = (await oauthCallbackHandler(
      event({ query: { code: 'c0de', state }, cookie: 'tb_oauth_state=deadbeef' }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(headersOf(wrongCookie).location).toContain('oauth_error=state_mismatch');
  });

  it('refuses accounts without any verified email', async () => {
    mockGithub({
      user: { id: 999, login: 'unverified' },
      emails: [{ email: 'shady@test.local', primary: true, verified: false }],
    });
    const { state, cookie } = await startAndGetState();
    const res = (await oauthCallbackHandler(
      event({ query: { code: 'c0de', state }, cookie }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(headersOf(res).location).toContain('oauth_error=no_verified_email');
    expect(getOauthUserId('github', '999')).toBeNull();
    expect(getUserIdByEmail('shady@test.local')).toBeNull();
  });

  it('maps a provider consent-cancel to oauth_error=denied', async () => {
    const res = (await oauthCallbackHandler(
      event({ query: { error: 'access_denied' } }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(headersOf(res).location).toContain('oauth_error=denied');
  });

  it('surfaces a failed code exchange as oauth_error=exchange_failed', async () => {
    mockGithub({ tokenError: true });
    const { state, cookie } = await startAndGetState();
    const res = (await oauthCallbackHandler(
      event({ query: { code: 'expired', state }, cookie }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(headersOf(res).location).toContain('oauth_error=exchange_failed');
  });
});
