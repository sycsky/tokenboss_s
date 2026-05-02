/**
 * Auth context — holds the current session token + user profile.
 *
 * Persists the JWT to localStorage (via `api.ts`) so a refresh keeps the
 * user signed in. On mount, if a token exists we call `/v1/me` to hydrate
 * the profile and validate the token in one shot; a 401 clears it.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import * as Sentry from "@sentry/react";

import {
  ApiError,
  api,
  getStoredSession,
  setStoredSession,
  type AuthResponse,
  type UserProfile,
} from "./api.js";

/**
 * Drop every `tb_key_v1:*` entry from localStorage. The previous release
 * cached plaintext API keys per (email, keyId) — the new flow has no
 * such cache, so any leftover entries are stale plaintext that we'd
 * rather not leave sitting there. Idempotent: a no-op once cleared.
 */
function purgeLegacyKeyCache(): void {
  try {
    const toDelete: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith("tb_key_v1:") || k === "tb_last_email")) {
        toDelete.push(k);
      }
    }
    toDelete.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* private mode / disabled storage — nothing to clean */
  }
}

interface AuthState {
  /** undefined while we're still hydrating from localStorage + /v1/me. */
  user: UserProfile | null | undefined;
  /** Convenience: null when no token stored (and /me not yet attempted). */
  token: string | null;
}

interface AuthContextValue extends AuthState {
  /** Create a new account with email + password. Returns the AuthResponse with isNew=true. */
  register: (input: { email: string; password: string; displayName?: string }) => Promise<import("./api.js").AuthResponse>;
  /** Log in with email + password. */
  login: (email: string, password: string) => Promise<import("./api.js").AuthResponse>;
  /** Consume a verification token from the email link. Auto-logs the user in. */
  verifyEmail: (token: string) => Promise<import("./api.js").AuthResponse>;
  /** Resend the verification email for the current session. */
  resendVerification: () => Promise<{ ok: true; alreadyVerified?: boolean }>;
  /** Send a one-time code to the given email address (used by recovery / magic-link flow). */
  sendCode: (email: string) => Promise<void>;
  /**
   * Exchange an email + OTP code for a session. Used by the recovery flow.
   * Returns the full AuthResponse (includes `isNew` flag for new accounts).
   */
  loginWithCode: (email: string, code: string) => Promise<import("./api.js").AuthResponse>;
  logout: () => void;
  /** Re-fetch the profile (e.g. after a chat call changes the balance). */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() => ({
    user: undefined, // still hydrating
    token: getStoredSession(),
  }));

  // Sync the current user to Sentry whenever auth state changes —
  // sets / clears the user context so issues track "affected users"
  // accurately across login, logout, and silent token expiry. We
  // only send the userId (no email / no displayName) to keep PII
  // out of error reports — userId is enough to look the user up
  // server-side if support actually needs to reach them.
  useEffect(() => {
    if (state.user) {
      Sentry.setUser({ id: state.user.userId });
    } else {
      // Sentry.setUser(null) clears the user context — used for both
      // explicit logout and the "still hydrating / not signed in"
      // states. Repeated calls are cheap (no-op when already null).
      Sentry.setUser(null);
    }
  }, [state.user?.userId]);

  // On mount: if we have a stored token, fetch /me to validate it and
  // load the profile. If no token, short-circuit to "not signed in".
  useEffect(() => {
    // One-shot migration: the previous release wrote per-(email, keyId)
    // plaintext API keys to localStorage under `tb_key_v1:*`. The new
    // flow doesn't write or read those, so any leftover entries are
    // stale plaintext that should be wiped — running on every mount is
    // fine, after the first cleanup it's a no-op.
    purgeLegacyKeyCache();

    let cancelled = false;
    const token = getStoredSession();
    if (!token) {
      setState({ user: null, token: null });
      return;
    }
    (async () => {
      try {
        const { user } = await api.me();
        if (!cancelled) setState({ user, token });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          setStoredSession(null);
          setState({ user: null, token: null });
        } else {
          // Network / server errors leave the token in place but show "signed out"
          // so the UI doesn't spin forever. Refresh will retry.
          setState({ user: null, token });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const register = useCallback(
    async (input: { email: string; password: string; displayName?: string }): Promise<AuthResponse> => {
      const res = await api.register(input);
      setStoredSession(res.token);
      setState({ user: res.user, token: res.token });
      return res;
    },
    [],
  );

  const login = useCallback(async (email: string, password: string): Promise<AuthResponse> => {
    const res = await api.login(email, password);
    setStoredSession(res.token);
    setState({ user: res.user, token: res.token });
    return res;
  }, []);

  const verifyEmail = useCallback(async (token: string): Promise<AuthResponse> => {
    const res = await api.verifyEmail(token);
    setStoredSession(res.token);
    setState({ user: res.user, token: res.token });
    return res;
  }, []);

  const resendVerification = useCallback(async () => {
    return api.resendVerification();
  }, []);

  const sendCode = useCallback(async (email: string) => {
    await api.sendCode(email);
  }, []);

  const loginWithCode = useCallback(async (email: string, code: string): Promise<AuthResponse> => {
    const res = await api.verifyCode(email, code);
    setStoredSession(res.token);
    setState({ user: res.user, token: res.token });
    return res;
  }, []);

  const logout = useCallback(() => {
    setStoredSession(null);
    setState({ user: null, token: null });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const { user } = await api.me();
      setState((prev) => ({ user, token: prev.token }));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setStoredSession(null);
        setState({ user: null, token: null });
      }
      throw err;
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: state.user,
      token: state.token,
      register,
      login,
      verifyEmail,
      resendVerification,
      sendCode,
      loginWithCode,
      logout,
      refresh,
    }),
    [state, register, login, verifyEmail, resendVerification, sendCode, loginWithCode, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return ctx;
}
