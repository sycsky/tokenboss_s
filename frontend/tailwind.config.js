/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // All tokens mirror `design.html` on tokenboss-preview.vercel.app.
      // Semantic names rather than raw hex so screens read like the spec.
      colors: {
        // Light mode (default)
        bg: "#F7F3EE",
        "bg-alt": "#F0EBE3",
        surface: "#FFFFFF",
        "surface-warm": "#FDF9F5",
        border: "#E8DDD5",
        "border-subtle": "#EDE8E0",
        "text-primary": "#1C1917",
        "text-secondary": "#6B5E52",
        "text-muted": "#A89A8D",
        accent: "#E8692A",
        "accent-hover": "#D4581D",
        "accent-subtle": "#FEE9DC",
        "accent-light": "#FFF4EE",
        success: "#16A34A",
        "success-subtle": "#DCFCE7",
        "success-border": "#BBF7D0",
        "success-text": "#14532D",
        warning: "#D97706",
        "warning-subtle": "#FEF3C7",
        danger: "#DC2626",
        "danger-subtle": "#FEE2E2",
        "danger-border": "#FECACA",
        "danger-text": "#7F1D1D",
        info: "#0369A1",
        "info-subtle": "#E0F2FE",
        "info-border": "#BAE6FD",
        "info-text": "#0C4A6E",

        // Dark-mode (Telegram chat screens)
        "dk-bg": "#141210",
        "dk-bg-alt": "#1A1714",
        "dk-surface": "#211E1A",
        "dk-surface-warm": "#261F19",
        "dk-border": "#332B24",
        "dk-text-primary": "#F5EFE8",
        "dk-text-secondary": "#A08870",
        "dk-text-muted": "#6B5545",

        // Brand badges
        "badge-claude-bg": "#FEE9DC",
        "badge-claude-text": "#9A3412",
      },
      fontFamily: {
        sans: ['"DM Sans"', '"Noto Sans SC"', "sans-serif"],
        mono: ['"Geist Mono"', "ui-monospace", "monospace"],
      },
      fontSize: {
        hero: ["40px", { lineHeight: "1.05", letterSpacing: "-0.03em", fontWeight: "700" }],
        h2: ["24px", { lineHeight: "1.2", letterSpacing: "-0.02em", fontWeight: "700" }],
        h3: ["18px", { lineHeight: "1.3", letterSpacing: "-0.01em", fontWeight: "600" }],
        body: ["15px", { lineHeight: "1.5" }],
        label: ["13px", { lineHeight: "1.4", fontWeight: "500" }],
        caption: ["12px", { lineHeight: "1.4" }],
        "mono-data": ["14px", { lineHeight: "1.4", letterSpacing: "0.02em", fontWeight: "500" }],
      },
      borderRadius: {
        sm: "8px",
        DEFAULT: "14px",
        lg: "20px",
      },
      boxShadow: {
        "warm-sm": "0 1px 3px rgba(100,60,20,0.06)",
        warm: "0 4px 12px rgba(100,60,20,0.08)",
        "warm-lg": "0 12px 32px rgba(100,60,20,0.10)",
      },
      maxWidth: {
        phone: "420px",
      },
    },
  },
  plugins: [],
};
