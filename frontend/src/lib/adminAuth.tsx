/**
 * Admin auth context — independent of the user-side AuthProvider.
 *
 * Persists the admin JWT under `tb_admin_session` (different localStorage
 * key from the user `tb_session`) so an ops user can be logged in as
 * admin without disturbing their normal account session, and vice versa.
 *
 * No /v1/me-equivalent: the admin token carries `role: "admin"` and is
 * verified statelessly on the server. We just trust the stored token until
 * the next API call returns 401, at which point we clear and redirect.
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
  adminApi,
  getStoredAdminSession,
  setStoredAdminSession,
} from "./adminApi.js";

interface AdminAuthState {
  /** undefined while reading from localStorage on first mount; null when
   *  no token; string when a token is in storage. The token is not
   *  validated against the server until the next admin API call — UI
   *  treats string-present as "looks logged in" optimistically. */
  token: string | undefined | null;
  /** Username extracted from the token, or null. Display only. */
  username: string | null;
}

interface AdminAuthContextValue extends AdminAuthState {
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  /** Called by adminApi callers when they get a 401, to clear stale state. */
  invalidate: () => void;
}

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

/** Pull the `sub` claim out of an admin JWT for display. Doesn't verify
 *  the signature — the server is the source of truth. */
function readUsernameFromToken(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
    const json = atob(padded + pad);
    const claims = JSON.parse(json) as { sub?: string };
    return typeof claims.sub === "string" ? claims.sub : null;
  } catch {
    return null;
  }
}

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AdminAuthState>(() => {
    const stored = getStoredAdminSession();
    return {
      token: stored,
      username: stored ? readUsernameFromToken(stored) : null,
    };
  });

  // Re-sync if some other tab updates localStorage. Cheap & avoids two
  // browser tabs falling out of sync after one logs out.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "tb_admin_session" || e.key === null) {
        const next = getStoredAdminSession();
        setState({ token: next, username: next ? readUsernameFromToken(next) : null });
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await adminApi.login(username, password);
    setStoredAdminSession(res.token);
    setState({ token: res.token, username: res.username });
  }, []);

  const logout = useCallback(() => {
    setStoredAdminSession(null);
    setState({ token: null, username: null });
  }, []);

  const invalidate = useCallback(() => {
    setStoredAdminSession(null);
    setState({ token: null, username: null });
  }, []);

  const value = useMemo<AdminAuthContextValue>(
    () => ({
      token: state.token,
      username: state.username,
      login,
      logout,
      invalidate,
    }),
    [state, login, logout, invalidate],
  );

  return (
    <AdminAuthContext.Provider value={value}>
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth(): AdminAuthContextValue {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) {
    throw new Error("useAdminAuth must be used inside <AdminAuthProvider>");
  }
  return ctx;
}
