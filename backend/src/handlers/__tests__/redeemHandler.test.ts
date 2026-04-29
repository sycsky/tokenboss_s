/**
 * redeemHandler — verifies request validation and the newapi-error →
 * HTTP-status mapping. The newapi side is mocked since it would require
 * a running newapi instance + a real redemption code to exercise.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

process.env.SESSION_SECRET = 'test-secret-32bytes-min-aaaaaaaaaaa';
process.env.NEWAPI_BASE_URL = 'https://newapi.test.local';
process.env.NEWAPI_ADMIN_TOKEN = 'admin-test-token';

vi.mock('../../lib/newapi.js', async (orig) => {
  const real = await orig<typeof import('../../lib/newapi.js')>();
  return {
    ...real,
    newapi: {
      loginUser: vi.fn(),
      redeemCode: vi.fn(),
    },
  };
});

import { init, putUser } from '../../lib/store.js';
import { signSession } from '../../lib/authTokens.js';
import { redeemHandler } from '../redeemHandler.js';
import { newapi, NewapiError } from '../../lib/newapi.js';

const loginUserMock = newapi.loginUser as unknown as ReturnType<typeof vi.fn>;
const redeemCodeMock = newapi.redeemCode as unknown as ReturnType<typeof vi.fn>;

const userId = 'u_test_redeem';
let token: string;

beforeAll(() => {
  process.env.SQLITE_PATH = ':memory:';
  init();
  putUser({
    userId,
    email: 'redeem@test.local',
    createdAt: new Date().toISOString(),
    newapiUserId: 99,
    newapiPassword: 'test-newapi-pw',
  });
  token = signSession(userId);
});

beforeEach(() => {
  loginUserMock.mockReset();
  redeemCodeMock.mockReset();
  // Default: loginUser succeeds — most tests don't care about the cookie value
  loginUserMock.mockResolvedValue({ cookie: 'cookie-x', userId: 99 });
});

function makeEvent(body: unknown) {
  return {
    headers: { authorization: `Bearer ${token}` },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    isBase64Encoded: false,
  } as unknown as Parameters<typeof redeemHandler>[0];
}

async function run(body: unknown) {
  return (await redeemHandler(makeEvent(body))) as APIGatewayProxyStructuredResultV2;
}

describe('redeemHandler', () => {
  it('returns 200 + USD value when newapi accepts the code', async () => {
    // newapi quota → USD divides by 500_000 (per usdToNewapiQuota)
    redeemCodeMock.mockResolvedValue({ quotaAdded: 500_000 });
    const res = await run({ code: 'TBOSS-VALID-CODE' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.quotaAdded).toBe(500_000);
    expect(body.usdAdded).toBeCloseTo(1.0, 4);
    expect(redeemCodeMock).toHaveBeenCalledWith(
      expect.objectContaining({ cookie: 'cookie-x', userId: 99 }),
      'TBOSS-VALID-CODE',
    );
  });

  it('trims whitespace around the code before forwarding', async () => {
    redeemCodeMock.mockResolvedValue({ quotaAdded: 100 });
    await run({ code: '   ABC-123   ' });
    expect(redeemCodeMock).toHaveBeenCalledWith(expect.anything(), 'ABC-123');
  });

  it('400 invalid_request_error when code is missing', async () => {
    const res = await run({});
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body as string).error.code).toBe('code_required');
  });

  it('400 invalid_request_error when code is empty / whitespace', async () => {
    const res = await run({ code: '   ' });
    expect(res.statusCode).toBe(400);
  });

  it('400 invalid_request_error when code is not a string', async () => {
    const res = await run({ code: 12345 });
    expect(res.statusCode).toBe(400);
  });

  it('422 invalid_code when newapi rejects with a redeem-failure message', async () => {
    redeemCodeMock.mockRejectedValue(
      new NewapiError(200, '兑换码不存在或已被使用'),
    );
    const res = await run({ code: 'BAD-CODE' });
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body as string);
    expect(body.error.type).toBe('invalid_code');
    expect(body.error.message).toContain('兑换码');
  });

  it('422 also fires for English "invalid"/"expired"/"used" newapi messages', async () => {
    for (const msg of ['code expired', 'invalid redeem code', 'already used']) {
      redeemCodeMock.mockRejectedValueOnce(new NewapiError(200, msg));
      const res = await run({ code: 'X' });
      expect(res.statusCode).toBe(422);
    }
  });

  it('502 upstream_error for non-redeem newapi errors (e.g., 500)', async () => {
    redeemCodeMock.mockRejectedValue(
      new NewapiError(500, 'database connection lost'),
    );
    const res = await run({ code: 'ANY' });
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body as string).error.type).toBe('upstream_error');
  });

  it('401 when Authorization header is missing', async () => {
    const evt = {
      headers: {},
      body: JSON.stringify({ code: 'X' }),
      isBase64Encoded: false,
    } as unknown as Parameters<typeof redeemHandler>[0];
    const res = (await redeemHandler(evt)) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(401);
  });
});
