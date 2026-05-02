import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

process.env.SQLITE_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret';
process.env.NEWAPI_BASE_URL = 'http://newapi.test';
process.env.NEWAPI_ADMIN_TOKEN = 'admin-token';

vi.mock('../../lib/newapi.js', async (orig) => {
  const real = await orig<typeof import('../../lib/newapi.js')>();
  return {
    ...real,
    newapi: {
      ...real.newapi,
      loginUser: vi.fn(),
      createAndRevealToken: vi.fn(),
      listUserTokens: vi.fn(),
    },
  };
});

import { createKeyHandler, listKeysHandler } from '../keysHandlers.js';
import { init, putUser } from '../../lib/store.js';
import { signSession } from '../../lib/authTokens.js';
import { newapi } from '../../lib/newapi.js';

const loginUserMock = newapi.loginUser as unknown as ReturnType<typeof vi.fn>;
const createAndRevealTokenMock = newapi.createAndRevealToken as unknown as ReturnType<typeof vi.fn>;
const listUserTokensMock = newapi.listUserTokens as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  init();
  loginUserMock.mockReset();
  createAndRevealTokenMock.mockReset();
  listUserTokensMock.mockReset();
  loginUserMock.mockResolvedValue({ cookie: 'sid=x' });
});

function makeAuthedEvent(userId: string, body?: unknown): any {
  return {
    headers: { authorization: `Bearer ${signSession(userId)}` },
    body: body ? JSON.stringify(body) : undefined,
    pathParameters: {},
  };
}

function seedUser(userId: string) {
  putUser({
    userId,
    email: `${userId}@x.com`,
    createdAt: new Date().toISOString(),
    emailVerified: true,
    newapiUserId: 42,
    newapiPassword: 'np-password',
  });
}

describe('POST /v1/keys', () => {
  it('passes expiresInDays through to newapi as expired_time = now + days*86400', async () => {
    seedUser('u_alice');
    createAndRevealTokenMock.mockResolvedValue({ tokenId: 7, apiKey: 'sk-plain' });

    const before = Math.floor(Date.now() / 1000);
    const res = await createKeyHandler(
      makeAuthedEvent('u_alice', { label: 'work', expiresInDays: 30 }),
    ) as APIGatewayProxyStructuredResultV2;

    expect(res.statusCode).toBe(201);
    expect(createAndRevealTokenMock).toHaveBeenCalledTimes(1);
    const callArg = createAndRevealTokenMock.mock.calls[0][0];
    expect(callArg.name).toBe('work');
    expect(callArg.expired_time).toBeGreaterThanOrEqual(before + 30 * 86400);
    expect(callArg.expired_time).toBeLessThanOrEqual(before + 30 * 86400 + 5);

    const body = JSON.parse(res.body!);
    expect(body.expiresAt).toBeTruthy();
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('omitting expiresInDays sends expired_time = -1 and returns expiresAt: null', async () => {
    seedUser('u_bob');
    createAndRevealTokenMock.mockResolvedValue({ tokenId: 8, apiKey: 'sk-plain' });

    const res = await createKeyHandler(
      makeAuthedEvent('u_bob', { label: 'forever' }),
    ) as APIGatewayProxyStructuredResultV2;

    expect(res.statusCode).toBe(201);
    expect(createAndRevealTokenMock.mock.calls[0][0].expired_time).toBe(-1);
    expect(JSON.parse(res.body!).expiresAt).toBeNull();
  });

  it('rejects expiresInDays = 0 with 400', async () => {
    seedUser('u_carol');
    const res = await createKeyHandler(
      makeAuthedEvent('u_carol', { label: 'bad', expiresInDays: 0 }),
    ) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(400);
  });

  it('rejects negative expiresInDays with 400', async () => {
    seedUser('u_dave');
    const res = await createKeyHandler(
      makeAuthedEvent('u_dave', { label: 'bad', expiresInDays: -3 }),
    ) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /v1/keys', () => {
  it('returns expiresAt: null for permanent tokens (expired_time = -1)', async () => {
    seedUser('u_eve');
    listUserTokensMock.mockResolvedValue([
      {
        id: 1,
        name: 'default',
        key: 'sk-...abcd',
        status: 1,
        created_time: 1700000000,
        expired_time: -1,
      },
    ]);

    const res = await listKeysHandler(makeAuthedEvent('u_eve')) as APIGatewayProxyStructuredResultV2;
    const body = JSON.parse(res.body!);
    expect(body.keys).toHaveLength(1);
    expect(body.keys[0].expiresAt).toBeNull();
  });

  it('returns expiresAt as ISO string for tokens with expired_time set', async () => {
    seedUser('u_frank');
    listUserTokensMock.mockResolvedValue([
      {
        id: 2,
        name: 'temp',
        key: 'sk-...efgh',
        status: 1,
        created_time: 1700000000,
        expired_time: 1900000000,
      },
    ]);

    const res = await listKeysHandler(makeAuthedEvent('u_frank')) as APIGatewayProxyStructuredResultV2;
    const body = JSON.parse(res.body!);
    expect(body.keys[0].expiresAt).toBe(new Date(1900000000 * 1000).toISOString());
  });
});
