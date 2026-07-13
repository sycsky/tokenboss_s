/**
 * OAuth login (authorization-code flow), GitHub first.
 *
 * GET /v1/auth/oauth/{provider}/start
 *   Mints a random `state`, pins it to the browser in an HttpOnly cookie,
 *   and 302s to the provider's authorize page. `redirect_uri` is omitted —
 *   the provider uses the callback URL registered on the OAuth app, so
 *   dev / prod are separate OAuth apps rather than env-juggling here.
 *
 * GET /v1/auth/oauth/{provider}/callback?code&state
 *   Verifies state (cookie must match the query param — this is the CSRF
 *   binding; a server-side-only check would still accept an attacker's own
 *   code+state pair), exchanges the code, fetches the provider profile and
 *   its VERIFIED email, then finds-or-creates the TokenBoss user:
 *     1. oauth_identities hit               → that user (explicit binding wins)
 *     2. verified email matches a user      → link identity to it
 *     3. otherwise                          → create user (newapi quota 0)
 *   and finally redirects to `${APP_URL}/oauth/callback#token=...&isNew=...`.
 *   The JWT rides the URL FRAGMENT, not the query string — fragments are
 *   never sent to servers, don't leak via Referer, and stay out of logs.
 *
 * Failures never 500 at the user: every callback error redirects to
 * `${APP_URL}/login?oauth_error=<code>` so the login page can explain.
 */

import { randomBytes } from "node:crypto";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";

import { createVerifiedUser, ProvisionError } from "../lib/accountProvisioning.js";
import { signSession } from "../lib/authTokens.js";
import {
  getOauthUserId,
  getUser,
  getUserIdByEmail,
  markEmailVerified,
  putOauthIdentity,
} from "../lib/store.js";

const STATE_COOKIE = "tb_oauth_state";
const STATE_TTL_SECONDS = 600;

/** What the callback needs to know about the signed-in provider account. */
interface OAuthProfile {
  /** Provider-side stable user id (GitHub numeric id, as string). */
  providerUserId: string;
  /** An email the PROVIDER has verified. Null when none exists. */
  email: string | null;
  displayName?: string;
}

interface OAuthProviderDef {
  clientIdEnv: string;
  clientSecretEnv: string;
  authorizeUrl: (clientId: string, state: string) => string;
  /** Exchange the code and fetch the profile. Throws on any upstream error. */
  fetchProfile: (
    clientId: string,
    clientSecret: string,
    code: string,
  ) => Promise<OAuthProfile>;
}

const PROVIDERS: Record<string, OAuthProviderDef> = {
  github: {
    clientIdEnv: "GITHUB_CLIENT_ID",
    clientSecretEnv: "GITHUB_CLIENT_SECRET",
    authorizeUrl: (clientId, state) => {
      const q = new URLSearchParams({
        client_id: clientId,
        // user:email lets us read private verified emails; profile basics
        // come with any token.
        scope: "user:email",
        state,
      });
      return `https://github.com/login/oauth/authorize?${q}`;
    },
    fetchProfile: async (clientId, clientSecret, code) => {
      const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
      });
      const tokenBody = (await tokenRes.json()) as {
        access_token?: string;
        error?: string;
      };
      if (!tokenRes.ok || !tokenBody.access_token) {
        throw new Error(`github token exchange failed: ${tokenBody.error ?? tokenRes.status}`);
      }

      const ghHeaders = {
        authorization: `Bearer ${tokenBody.access_token}`,
        accept: "application/vnd.github+json",
        // GitHub's API rejects requests without a User-Agent.
        "user-agent": "tokenboss-oauth",
      };
      const userRes = await fetch("https://api.github.com/user", { headers: ghHeaders });
      if (!userRes.ok) throw new Error(`github /user failed: ${userRes.status}`);
      const ghUser = (await userRes.json()) as {
        id?: number;
        login?: string;
        name?: string | null;
      };
      if (typeof ghUser.id !== "number") throw new Error("github /user returned no id");

      // /user.email hides private emails; /user/emails lists them all with
      // per-address verified flags. Only a verified address may drive
      // account linking — an unverified one could be someone else's inbox.
      const emailsRes = await fetch("https://api.github.com/user/emails", {
        headers: ghHeaders,
      });
      let email: string | null = null;
      if (emailsRes.ok) {
        const emails = (await emailsRes.json()) as {
          email: string;
          primary: boolean;
          verified: boolean;
        }[];
        const verified = emails.filter((e) => e.verified && typeof e.email === "string");
        email = (verified.find((e) => e.primary) ?? verified[0])?.email?.toLowerCase() ?? null;
      }

      return {
        providerUserId: String(ghUser.id),
        email,
        displayName: ghUser.name ?? ghUser.login ?? undefined,
      };
    },
  },
};

// ---------- helpers ----------

function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:5179").replace(/\/$/, "");
}

function redirect(location: string, extraHeaders: Record<string, string> = {}): APIGatewayProxyResultV2 {
  return { statusCode: 302, headers: { location, ...extraHeaders }, body: "" };
}

function loginError(code: string, clearState = true): APIGatewayProxyResultV2 {
  return redirect(
    `${appUrl()}/login?oauth_error=${encodeURIComponent(code)}`,
    clearState ? { "set-cookie": clearStateCookie() } : {},
  );
}

function isHttps(event: APIGatewayProxyEventV2): boolean {
  return (event.headers["x-forwarded-proto"] ?? "").toLowerCase() === "https";
}

function stateCookie(state: string, secure: boolean): string {
  return [
    `${STATE_COOKIE}=${state}`,
    `Max-Age=${STATE_TTL_SECONDS}`,
    "Path=/v1/auth/oauth",
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

function clearStateCookie(): string {
  return `${STATE_COOKIE}=; Max-Age=0; Path=/v1/auth/oauth; HttpOnly; SameSite=Lax`;
}

function readStateCookie(event: APIGatewayProxyEventV2): string | null {
  const raw = event.headers.cookie ?? event.headers.Cookie ?? "";
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === STATE_COOKIE) return rest.join("=") || null;
  }
  return null;
}

function resolveProvider(
  event: APIGatewayProxyEventV2,
): { def: OAuthProviderDef; clientId: string; clientSecret: string } | null {
  const name = event.pathParameters?.provider ?? "";
  const def = PROVIDERS[name];
  if (!def) return null;
  const clientId = process.env[def.clientIdEnv];
  const clientSecret = process.env[def.clientSecretEnv];
  if (!clientId || !clientSecret) return null;
  return { def, clientId, clientSecret };
}

// ---------- GET /v1/auth/oauth/{provider}/start ----------

export const oauthStartHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const provider = resolveProvider(event);
  if (!provider) {
    // Unknown provider or missing env — send the user somewhere sane
    // rather than a bare 4xx (this is a top-level browser navigation).
    return loginError("not_configured", false);
  }

  const state = randomBytes(16).toString("hex");
  return redirect(provider.def.authorizeUrl(provider.clientId, state), {
    "set-cookie": stateCookie(state, isHttps(event)),
  });
};

// ---------- GET /v1/auth/oauth/{provider}/callback ----------

export const oauthCallbackHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const providerName = event.pathParameters?.provider ?? "";
  const provider = resolveProvider(event);
  if (!provider) return loginError("not_configured", false);

  const q = event.queryStringParameters ?? {};
  // User clicked "cancel" on the provider's consent page.
  if (q.error) return loginError("denied");

  const code = q.code ?? "";
  const state = q.state ?? "";
  const cookieState = readStateCookie(event);
  if (!code || !state || !cookieState || state !== cookieState) {
    return loginError("state_mismatch");
  }

  let profile: OAuthProfile;
  try {
    profile = await provider.def.fetchProfile(
      provider.clientId,
      provider.clientSecret,
      code,
    );
  } catch (err) {
    console.error(`[oauth:${providerName}] profile fetch failed:`, (err as Error).message);
    return loginError("exchange_failed");
  }

  // Resolve to a TokenBoss user: explicit identity binding first, then
  // verified-email merge, then fresh signup.
  let userId = getOauthUserId(providerName, profile.providerUserId);
  let isNew = false;
  if (!userId) {
    if (!profile.email) {
      // No verified email → we can neither merge safely nor create an
      // account that email-code login could later reach. Refuse.
      return loginError("no_verified_email");
    }
    const byEmail = getUserIdByEmail(profile.email);
    if (byEmail) {
      // Same verified inbox on both sides — merge into the existing
      // account so balances/keys are preserved, and record the binding.
      userId = byEmail;
      markEmailVerified(userId);
    } else {
      try {
        const created = await createVerifiedUser({
          email: profile.email,
          displayName: profile.displayName,
        });
        userId = created.userId;
        isNew = true;
      } catch (err) {
        const msg = err instanceof ProvisionError ? err.message : (err as Error).message;
        console.error(`[oauth:${providerName}] provisioning failed for ${profile.email}:`, msg);
        return loginError("provision_failed");
      }
    }
    putOauthIdentity(providerName, profile.providerUserId, userId);
  }

  const user = await getUser(userId);
  if (!user) return loginError("provision_failed");

  const token = signSession(user.userId, user.tokenVersion ?? 0);
  const frag = new URLSearchParams({ token, isNew: isNew ? "1" : "0" });
  return redirect(`${appUrl()}/oauth/callback#${frag}`, {
    "set-cookie": clearStateCookie(),
  });
};
