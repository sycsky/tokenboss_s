/**
 * Local development server.
 *
 * Spins up a plain Node HTTP server that adapts incoming requests into the
 * APIGatewayProxyEventV2 shape, routes them to the matching Lambda handler,
 * and translates the handler's response back to HTTP. This lets us iterate
 * without SAM CLI / Docker / deploying to AWS.
 *
 * Usage:
 *   npm run dev
 *   # or with mock upstream so no real aggregator is needed:
 *   MOCK_UPSTREAM=1 npm run dev
 *
 * Routes registered here must mirror those in `template.yaml`.
 */

// Load .env.local before any other imports so env vars are visible to
// modules that read them at import time (e.g. upstream config). This uses
// Node 20.6+'s built-in loader — no dotenv package needed. Missing file is
// not an error; we just fall back to whatever is already in process.env.
try {
  process.loadEnvFile(".env.local");
} catch {
  /* no .env.local — fine */
}

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, readFileSync, statSync } from "node:fs";
import { join, normalize, resolve as pathResolve, sep } from "node:path";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";

import { handler as helloHandler } from "./handlers/hello.js";
import {
  meHandler,
  sendCodeHandler,
  verifyCodeHandler,
} from "./handlers/authHandlers.js";
import {
  createKeyHandler,
  deleteKeyHandler,
  listKeysHandler,
  revealKeyHandler,
} from "./handlers/keysHandlers.js";
import { modelsHandler } from "./handlers/modelsHandler.js";
import { routerTiersHandler } from "./handlers/routerConfigHandler.js";
import { skillMdHandler } from "./handlers/skillMd.js";
import { usageHandler } from "./handlers/usageHandlers.js";
import { streamChatCore, type StreamWriter } from "./lib/chatProxyCore.js";
import { putUser } from "./lib/store.js";
import { runDailyExpireAndReset } from './lib/dailyCron.js';

type LambdaHandler = (
  event: APIGatewayProxyEventV2,
) => Promise<APIGatewayProxyResultV2>;

interface Route {
  method: string;
  /**
   * HTTP API-style path. Path parameters use `{name}` placeholders
   * (e.g. `/v1/keys/{keyId}`) which are extracted into
   * `event.pathParameters`.
   */
  path: string;
  handler: LambdaHandler;
}

const routes: Route[] = [
  { method: "GET", path: "/hello", handler: helloHandler as LambdaHandler },
  { method: "POST", path: "/v1/auth/send-code", handler: sendCodeHandler },
  { method: "POST", path: "/v1/auth/verify-code", handler: verifyCodeHandler },
  { method: "GET", path: "/v1/me", handler: meHandler },
  { method: "GET", path: "/v1/keys", handler: listKeysHandler },
  { method: "POST", path: "/v1/keys", handler: createKeyHandler },
  { method: "GET", path: "/v1/keys/{keyId}/reveal", handler: revealKeyHandler },
  { method: "DELETE", path: "/v1/keys/{keyId}", handler: deleteKeyHandler },
  { method: "GET", path: "/v1/usage", handler: usageHandler },
  { method: "GET", path: "/v1/models", handler: modelsHandler },
  { method: "GET", path: "/v1/router/tiers", handler: routerTiersHandler },
  { method: "GET", path: "/skill.md", handler: skillMdHandler as LambdaHandler },
];

/** Routes that bypass the buffered Lambda adapter and stream directly. */
const STREAM_ROUTES: { method: string; path: string }[] = [
  { method: "POST", path: "/v1/chat/completions" },
];

const PORT = Number(process.env.PORT ?? 3000);

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function buildEvent(
  req: IncomingMessage,
  rawBody: string,
  pathname: string,
  rawQueryString: string,
  queryStringParameters: Record<string, string> | undefined,
  pathParameters: Record<string, string> | undefined,
): APIGatewayProxyEventV2 {
  const method = (req.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers[k.toLowerCase()] = v;
    else if (Array.isArray(v)) headers[k.toLowerCase()] = v.join(",");
  }

  return {
    version: "2.0",
    routeKey: `${method} ${pathname}`,
    rawPath: pathname,
    rawQueryString,
    headers,
    queryStringParameters,
    pathParameters,
    requestContext: {
      accountId: "local",
      apiId: "local",
      domainName: "localhost",
      domainPrefix: "local",
      http: {
        method,
        path: pathname,
        protocol: "HTTP/1.1",
        sourceIp: req.socket.remoteAddress ?? "127.0.0.1",
        userAgent: headers["user-agent"] ?? "local",
      },
      requestId: `local-${Date.now()}`,
      routeKey: `${method} ${pathname}`,
      stage: "local",
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
    },
    body: rawBody || undefined,
    isBase64Encoded: false,
  };
}

interface RouteMatch {
  route: Route;
  pathParameters: Record<string, string>;
}

/**
 * Match a concrete path against a template path with `{name}` placeholders.
 * Returns the extracted path parameters or null if the template doesn't fit.
 */
function matchTemplate(
  template: string,
  pathname: string,
): Record<string, string> | null {
  const t = template.split("/");
  const p = pathname.split("/");
  if (t.length !== p.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < t.length; i++) {
    const seg = t[i];
    if (seg.startsWith("{") && seg.endsWith("}")) {
      params[seg.slice(1, -1)] = decodeURIComponent(p[i]);
    } else if (seg !== p[i]) {
      return null;
    }
  }
  return params;
}

function findRoute(method: string, pathname: string): RouteMatch | undefined {
  const m = method.toUpperCase();
  for (const r of routes) {
    if (r.method !== m) continue;
    // Fast path: exact match, no placeholders.
    if (r.path === pathname) return { route: r, pathParameters: {} };
    if (r.path.includes("{")) {
      const params = matchTemplate(r.path, pathname);
      if (params) return { route: r, pathParameters: params };
    }
  }
  return undefined;
}

/** Permissive CORS headers to mirror the deployed HttpApi CorsConfiguration. */
const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-max-age": "86400",
};

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const pathname = url.pathname;
  const rawQueryString = url.search.startsWith("?") ? url.search.slice(1) : url.search;
  const method = (req.method ?? "GET").toUpperCase();

  // CORS preflight — answered locally, just like API Gateway would.
  if (method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  // Install endpoints: dynamic script generation + static tarball.
  if (method === "GET" && pathname === "/install/install.ps1") {
    serveInstallScript(req, url, res);
    return;
  }
  if (method === "GET" && pathname.startsWith("/install/")) {
    if (serveStatic(pathname, res)) return;
  }

  // Streamed routes bypass the buffered Lambda adapter so every write() from
  // the handler is flushed to the client immediately — this mirrors the
  // behavior of a Lambda Function URL with InvokeMode=RESPONSE_STREAM.
  if (STREAM_ROUTES.some((r) => r.method === method && r.path === pathname)) {
    await handleChatStream(req, res, pathname);
    return;
  }

  const match = findRoute(method, pathname);
  if (!match) {
    res.writeHead(404, { "content-type": "application/json", ...CORS_HEADERS });
    res.end(JSON.stringify({ error: { type: "not_found", message: `${method} ${pathname}` } }));
    return;
  }

  const rawBody = await readBody(req);
  const queryStringParameters: Record<string, string> = {};
  for (const [k, v] of url.searchParams.entries()) queryStringParameters[k] = v;
  const event = buildEvent(
    req,
    rawBody,
    pathname,
    rawQueryString,
    Object.keys(queryStringParameters).length > 0 ? queryStringParameters : undefined,
    Object.keys(match.pathParameters).length > 0 ? match.pathParameters : undefined,
  );

  try {
    const result = await match.route.handler(event);
    // APIGatewayProxyResultV2 can be a string OR a structured object.
    if (typeof result === "string") {
      res.writeHead(200, { "content-type": "application/json", ...CORS_HEADERS });
      res.end(result);
      return;
    }
    const statusCode = result.statusCode ?? 200;
    const headers = { ...(result.headers ?? {}), ...CORS_HEADERS };
    res.writeHead(statusCode, headers as Record<string, string>);
    const body = result.body ?? "";
    res.end(
      result.isBase64Encoded ? Buffer.from(body, "base64") : body,
    );
  } catch (err) {
    console.error(`[local] handler error on ${method} ${pathname}:`, err);
    res.writeHead(500, { "content-type": "application/json", ...CORS_HEADERS });
    res.end(
      JSON.stringify({
        error: { type: "server_error", message: (err as Error).message },
      }),
    );
  }
}

const PUBLIC_DIR = pathResolve(process.cwd(), "public");

const STATIC_CONTENT_TYPES: Record<string, string> = {
  ".tgz": "application/gzip",
  ".ps1": "text/plain; charset=utf-8",
  ".sh": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json",
};

/**
 * Render install.ps1 with the caller-supplied API key and the backend URL
 * inferred from the request. Lets the user do:
 *   iwr "http://host:3000/install/install.ps1?key=sk-xxx" | iex
 * without ever needing to pass flags or edit the script.
 */
function serveInstallScript(
  req: IncomingMessage,
  url: URL,
  res: ServerResponse,
): void {
  const key = url.searchParams.get("key") ?? "";
  const portParam = url.searchParams.get("port");

  const host = req.headers.host ?? `127.0.0.1:${PORT}`;
  const scheme =
    (req.headers["x-forwarded-proto"] as string | undefined) ?? "http";
  const backendUrl = `${scheme}://${host}`;

  const templatePath = join(PUBLIC_DIR, "install", "install.ps1");
  let body: string;
  try {
    body = readFileSync(templatePath, "utf8");
  } catch {
    res.writeHead(500, { "content-type": "text/plain", ...CORS_HEADERS });
    res.end("install.ps1 template missing");
    return;
  }

  const escapePs = (s: string): string => s.replace(/"/g, '`"');
  body = body.replace(
    /\[string\]\$BackendUrl\s*=\s*"[^"]*"/,
    `[string]\$BackendUrl = "${escapePs(backendUrl)}"`,
  );
  if (key) {
    body = body.replace(
      /\[string\]\$ApiKey\s*=\s*"[^"]*"/,
      `[string]\$ApiKey = "${escapePs(key)}"`,
    );
  }
  if (portParam && /^\d+$/.test(portParam)) {
    body = body.replace(/\[int\]\$Port\s*=\s*\d+/, `[int]\$Port = ${portParam}`);
  }

  res.writeHead(200, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
    ...CORS_HEADERS,
  });
  res.end(body);
}

function serveStatic(pathname: string, res: ServerResponse): boolean {
  const rel = pathname.replace(/^\/+/, "");
  const target = normalize(join(PUBLIC_DIR, rel));
  if (!target.startsWith(PUBLIC_DIR + sep) && target !== PUBLIC_DIR) {
    return false;
  }
  let stat;
  try {
    stat = statSync(target);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;
  const ext = target.slice(target.lastIndexOf(".")).toLowerCase();
  const contentType = STATIC_CONTENT_TYPES[ext] ?? "application/octet-stream";
  res.writeHead(200, {
    "content-type": contentType,
    "content-length": String(stat.size),
    ...CORS_HEADERS,
  });
  createReadStream(target).pipe(res);
  return true;
}

/**
 * Stream the chat-completions pipeline directly into the Node HTTP response.
 * No buffering — each `write()` from the core is flushed as soon as the
 * socket accepts it. This matches the Lambda Function URL streaming shape
 * so local behavior and deployed behavior stay in sync.
 */
async function handleChatStream(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<void> {
  const rawBody = await readBody(req);
  const event = buildEvent(req, rawBody, pathname, "", undefined, undefined);

  let headWritten = false;
  let ended = false;

  const writer: StreamWriter = {
    writeHead(statusCode, headers) {
      if (headWritten) return;
      res.writeHead(statusCode, headers);
      headWritten = true;
    },
    write(chunk) {
      if (!headWritten) {
        res.writeHead(200);
        headWritten = true;
      }
      res.write(chunk);
    },
    end() {
      if (ended) return;
      res.end();
      ended = true;
    },
  };

  try {
    await streamChatCore(event, writer);
  } catch (err) {
    console.error(`[local] streamChatCore error on ${pathname}:`, err);
    if (!headWritten) {
      res.writeHead(500, { "content-type": "application/json" });
      headWritten = true;
    }
    if (!ended) {
      res.end(
        JSON.stringify({
          error: { type: "server_error", message: (err as Error).message },
        }),
      );
      ended = true;
    }
  } finally {
    if (!ended) res.end();
  }
}

/**
 * Seed a demo user so the dashboard has something to load locally. Users mint
 * their own sk-xxx proxy keys via POST /v1/keys — no key is seeded here.
 */
async function seedLocalData(): Promise<void> {
  const now = new Date().toISOString();
  await putUser({
    userId: "u_local_demo",
    displayName: "Local Demo User",
    email: "demo@localhost",
    createdAt: now,
  });
  console.log(`[local] seeded demo user: u_local_demo`);
}

const server = createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error("[local] unexpected error:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { type: "server_error", message: String(err) } }));
    }
  });
});

if (process.env.NODE_ENV !== "production") {
  await seedLocalData();
}

function scheduleDailyCron() {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(16, 0, 0, 0); // 0:00 Beijing = 16:00 UTC prev day; adjust as needed
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  const delay = next.getTime() - now.getTime();
  setTimeout(() => {
    try {
      const result = runDailyExpireAndReset();
      console.log(`[cron] daily expire+reset: ${result.expired} expired, ${result.reset} reset`);
    } catch (e) { console.error('[cron] failed', e); }
    scheduleDailyCron();
  }, delay);
}

scheduleDailyCron();

server.listen(PORT, () => {
  console.log(`[local] TokenBoss backend listening on http://localhost:${PORT}`);
  console.log(`[local] routes:`);
  for (const r of routes) {
    console.log(`  ${r.method.padEnd(7)} ${r.path}`);
  }
  for (const r of STREAM_ROUTES) {
    console.log(`  ${r.method.padEnd(7)} ${r.path}  (streamed)`);
  }
  if (process.env.MOCK_UPSTREAM === "1") {
    console.log(`[local] MOCK_UPSTREAM=1 — chat proxy will echo requests without calling a real aggregator`);
  } else if (!process.env.NEWAPI_BASE_URL) {
    console.log(
      `[local] WARNING: NEWAPI_BASE_URL not set — chat proxy will 503. ` +
        `Set MOCK_UPSTREAM=1 to bypass.`,
    );
  } else {
    console.log(`[local] upstream: ${process.env.NEWAPI_BASE_URL}`);
  }
});
