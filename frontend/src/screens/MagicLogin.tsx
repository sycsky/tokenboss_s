import { Navigate } from 'react-router-dom';

/**
 * /login/magic was the email-code "forgot password" recovery flow when
 * the primary auth was email + password. Now that /login itself is
 * email-code, this page just redirects to keep external bookmarks
 * working.
 */
export default function MagicLogin() {
  return <Navigate to="/login" replace />;
}
