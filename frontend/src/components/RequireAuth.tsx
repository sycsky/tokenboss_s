import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { PhoneFrame } from "./PhoneFrame.js";
import { useAuth } from "../lib/auth.js";

/**
 * Route guard. Wraps a protected screen and:
 *   - shows a brief loading state while the session is being hydrated
 *   - redirects to /login with `state.from` set so the login screen can
 *     bounce the user back after a successful sign-in
 *   - renders its children once the user is signed in
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();

  if (user === undefined) {
    return (
      <PhoneFrame>
        <div className="flex-1 flex items-center justify-center text-body text-text-secondary">
          加载中…
        </div>
      </PhoneFrame>
    );
  }

  if (user === null) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  return <>{children}</>;
}
