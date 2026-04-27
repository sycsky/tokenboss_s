import { Navigate } from 'react-router-dom';

/**
 * /register kept as an alias for the unified email-code flow at /login.
 * Landing CTAs and external links may still point here, so we redirect
 * instead of 404. The actual auth happens at /login — both new and
 * returning users go through the same screen.
 */
export default function Register() {
  return <Navigate to="/login" replace />;
}
