import { describe, it, expect, beforeEach, vi } from "vitest";
import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";

process.env.SQLITE_PATH = ":memory:";
process.env.JWT_SECRET = "test-secret";
process.env.NEWAPI_BASE_URL = "http://newapi.test";
process.env.NEWAPI_ADMIN_TOKEN = "admin-token";

vi.mock("../../lib/newapi.js", async (orig) => {
  const real = await orig<typeof import("../../lib/newapi.js")>();
  return {
    ...real,
    newapi: {
      ...real.newapi,
      loginUser: vi.fn(),
      listUserTokens: vi.fn(),
      deleteUserToken: vi.fn(),
      createAndRevealToken: vi.fn(),
    },
  };
});

import { deepLinkHandler } from "../deepLinkHandler.js";
import { init, putUser } from "../../lib/store.js";
import { signSession } from "../../lib/authTokens.js";
import { newapi, NewapiError } from "../../lib/newapi.js";

const loginUserMock = newapi.loginUser as unknown as ReturnType<typeof vi.fn>;
const listUserTokensMock = newapi.listUserTokens as unknown as ReturnType<typeof vi.fn>;
const deleteUserTokenMock = newapi.deleteUserToken as unknown as ReturnType<typeof vi.fn>;
const createAndRevealTokenMock = newapi.createAndRevealToken as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  init();
  loginUserMock.mockReset();
  listUserTokensMock.mockReset();
  deleteUserTokenMock.mockReset();
  createAndRevealTokenMock.mockReset();
  loginUserMock.mockResolvedValue({ cookie: "sid=x", userId: 42 });
});

function makeAuthedEvent(userId: string): any {
  return {
    headers: { authorization: `Bearer ${signSession(userId)}` },
    body: null,
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
    newapiPassword: "np-password",
  });
}

describe("deepLinkHandler POST /v1/deep-link", () => {
  it("returns 401 without session", async () => {
    const event = { headers: {}, body: null } as any;
    const result = (await deepLinkHandler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(401);
    const body = JSON.parse(result.body!);
    expect(body.error.type).toBe("authentication_error");
  });

  it("deletes existing 'CC Switch' token before creating new one (D7 删旧建新)", async () => {
    seedUser("u_alice");
    listUserTokensMock.mockResolvedValue([
      { id: 42, name: "CC Switch", key: "sk-...", status: 1, created_time: 1700000000, expired_time: -1 },
      { id: 7, name: "other", key: "sk-...", status: 1, created_time: 1700000000, expired_time: -1 },
    ]);
    deleteUserTokenMock.mockResolvedValue(undefined);
    createAndRevealTokenMock.mockResolvedValue({ tokenId: 99, apiKey: "sk-newkey" });

    const res = (await deepLinkHandler(makeAuthedEvent("u_alice"))) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(200);

    // D7: delete must precede create
    expect(deleteUserTokenMock).toHaveBeenCalledTimes(1);
    expect(deleteUserTokenMock.mock.calls[0][1]).toBe(42);
    expect(createAndRevealTokenMock).toHaveBeenCalledTimes(1);
    const deleteOrder = deleteUserTokenMock.mock.invocationCallOrder[0];
    const createOrder = createAndRevealTokenMock.mock.invocationCallOrder[0];
    expect(deleteOrder).toBeLessThan(createOrder);
  });

  it("creates new token if no existing 'CC Switch' token", async () => {
    seedUser("u_bob");
    listUserTokensMock.mockResolvedValue([
      { id: 7, name: "other", key: "sk-...", status: 1, created_time: 1700000000, expired_time: -1 },
    ]);
    createAndRevealTokenMock.mockResolvedValue({ tokenId: 100, apiKey: "sk-fresh" });

    const res = (await deepLinkHandler(makeAuthedEvent("u_bob"))) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(200);
    expect(deleteUserTokenMock).not.toHaveBeenCalled();
    expect(createAndRevealTokenMock).toHaveBeenCalledTimes(1);
    expect(createAndRevealTokenMock.mock.calls[0][0]).toMatchObject({
      name: "CC Switch",
      unlimited_quota: true,
      expired_time: -1,
    });
  });

  it("returns 5 deep_links with the new plaintext key", async () => {
    seedUser("u_carol");
    listUserTokensMock.mockResolvedValue([]);
    createAndRevealTokenMock.mockResolvedValue({ tokenId: 99, apiKey: "sk-newkey-secret" });

    const res = (await deepLinkHandler(makeAuthedEvent("u_carol"))) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.key_name).toBe("CC Switch");
    expect(body.key_id).toBe(99);
    expect(body.user_id).toBe("u_carol");
    expect(body.deep_links).toHaveLength(5);

    const apps = body.deep_links.map((l: { app: string }) => l.app);
    expect(apps).toEqual(["openclaw", "hermes", "codex", "opencode", "claude"]);

    for (const link of body.deep_links) {
      expect(link.url).toMatch(/^ccswitch:\/\/v1\/import\?/);
      // For simple-schema apps the key shows up url-encoded in the query
      // string; for full-schema (codex/claude) it's inside a base64 config.
      if (["openclaw", "hermes", "opencode"].includes(link.app)) {
        expect(link.url).toContain(encodeURIComponent("sk-newkey-secret"));
      } else {
        const m = link.url.match(/config=([^&]+)/);
        expect(m).toBeTruthy();
        const decoded = Buffer.from(decodeURIComponent(m![1]), "base64").toString("utf8");
        expect(decoded).toContain("sk-newkey-secret");
      }
    }
  });

  it("propagates newapi 429 as 503 newapi_rate_limited", async () => {
    seedUser("u_dave");
    listUserTokensMock.mockRejectedValue(new NewapiError(429, "rate limited"));

    const res = (await deepLinkHandler(makeAuthedEvent("u_dave"))) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(503);
    const body = JSON.parse(res.body!);
    expect(body.error.code).toBe("newapi_rate_limited");
  });
});
