import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import * as Sentry from "@sentry/react";
import App from "./App.tsx";
import { AuthProvider } from "./lib/auth.js";
import { AdminAuthProvider } from "./lib/adminAuth.js";
import "./index.css";

// Frontend Sentry — separate project from backend so error counts /
// affected-user metrics don't conflate the two layers. DSN is public
// by design (lives in the browser bundle), so it can sit in env or
// even be hardcoded; we use VITE_SENTRY_DSN for env parity with
// VITE_API_URL etc. Without the env set Sentry.init is a no-op (safe
// to leave during local dev — no events fired).
const sentryDsn =
  (import.meta.env.VITE_SENTRY_DSN as string | undefined) ||
  (typeof window !== "undefined" && window.__ENV__?.VITE_SENTRY_DSN) ||
  undefined;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.MODE,
    // No perf trace data — Sentry's free tier transaction quota is
    // small and we don't have a perf use case yet. Flip on later if
    // we want page-load timing breakdowns.
    tracesSampleRate: 0,
    // Session replay disabled too (separate quota, separate cost) —
    // we'll consider it after we see real bug-report volume.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Sentry.ErrorBoundary
      fallback={({ error, resetError }) => (
        <div style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '64px auto' }}>
          <h1 style={{ fontSize: 22, marginBottom: 8 }}>页面出错了</h1>
          <p style={{ color: '#6B5E52', marginBottom: 16, lineHeight: 1.6 }}>
            刚才这块界面崩了 — 错误已经自动报给我们。你可以试着重新加载继续用。
          </p>
          <pre style={{
            background: '#F0EBE3',
            border: '2px solid #1C1917',
            padding: 12,
            borderRadius: 6,
            fontSize: 12,
            overflow: 'auto',
            marginBottom: 16,
          }}>
            {error instanceof Error ? error.message : String(error)}
          </pre>
          <button
            type="button"
            onClick={resetError}
            style={{
              padding: '8px 16px',
              fontWeight: 700,
              background: '#1C1917',
              color: 'white',
              border: '2px solid #1C1917',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            重新加载
          </button>
        </div>
      )}
    >
      <BrowserRouter>
        <AuthProvider>
          <AdminAuthProvider>
            <App />
          </AdminAuthProvider>
        </AuthProvider>
      </BrowserRouter>
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
