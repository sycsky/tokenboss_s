import type { ReactNode } from "react";
import { PhoneFrame } from "./PhoneFrame.js";

/**
 * Full-screen Telegram chat look-alike for the mock chat screens
 * (5 — pair-code, 9 — low balance, A — /balance command). Wraps the
 * content in the dark PhoneFrame and adds a fake header + composer.
 */
export function TelegramShell({
  title = "OpenClaw Bot",
  subtitle = "在线",
  children,
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <PhoneFrame tone="dark">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-dk-border bg-dk-bg-alt">
        <div className="w-9 h-9 rounded-full bg-accent/20 flex items-center justify-center text-accent text-[14px] font-semibold">
          OC
        </div>
        <div className="flex-1">
          <div className="text-[14px] font-semibold text-dk-text-primary">{title}</div>
          <div className="text-caption text-dk-text-muted">{subtitle}</div>
        </div>
      </div>

      {/* Message area */}
      <div className="flex-1 px-4 py-3 overflow-y-auto">{children}</div>

      {/* Fake composer */}
      <div className="px-4 py-3 border-t border-dk-border bg-dk-bg-alt flex items-center gap-2">
        <div className="flex-1 bg-dk-surface rounded-full px-4 py-2 text-caption text-dk-text-muted">
          发送消息…
        </div>
        <div className="w-9 h-9 rounded-full bg-accent flex items-center justify-center text-white">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M2 8L14 2L10 14L8 9L2 8Z"
              fill="currentColor"
            />
          </svg>
        </div>
      </div>
    </PhoneFrame>
  );
}
