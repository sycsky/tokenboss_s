#!/bin/sh
# Inject runtime environment variables into the built JS bundle.
# Zeabur sets VITE_API_URL and VITE_CHAT_URL as container env vars.
# Vite bakes a placeholder at build time; we swap it here at startup.

set -e

HTML=/usr/share/nginx/html/index.html

# Write a runtime config script that the app can read via window.__ENV__
cat > /usr/share/nginx/html/env.js << EOF
window.__ENV__ = {
  VITE_API_URL: "${VITE_API_URL:-}",
  VITE_CHAT_URL: "${VITE_CHAT_URL:-}"
};
EOF

# Inject env.js into index.html if not already present
if ! grep -q "env.js" "$HTML"; then
  sed -i 's|<head>|<head><script src="/env.js"></script>|' "$HTML"
fi

# Start nginx
exec nginx -g "daemon off;"
