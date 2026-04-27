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

import {
  ApiError,
  api,
  getStoredSession,
  setStoredSession,
  type AuthResponse,
  type UserProfile,
} from "./api.js";

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

  // On mount: if we have a stored token, fetch /me to validate it and
  // load the profile. If no token, short-circuit to "not signed in".
  useEffect(() => {
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
      sendCode,
      loginWithCode,
      logout,
      refresh,
    }),
    [state, register, login, sendCode, loginWithCode, logout, refresh],
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
