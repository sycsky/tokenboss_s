import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useAdminAuth } from "../lib/adminAuth.js";

/**
 * Admin route guard. No /me-equivalent for admin (stateless JWT), so we
 * just check whether a token exists in storage. If a downstream API call
 * later returns 401, the screen catches it and clears state via
 * `useAdminAuth().invalidate()`, which puts us back at this guard's
 * redirect path on the next render.
 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { token } = useAdminAuth();
  const location = useLocation();

  // token === undefined would mean we haven't hydrated yet; the provider
  // does the read synchronously in useState init, so this is an
  // unreachable state in practice. Treat it as logged-out for safety.
  if (!token) {
    return <Navigate to="/admin/login" state={{ from: location.pathname }} replace />;
  }
  return <>{children}</>;
}
