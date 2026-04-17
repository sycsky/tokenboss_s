import type { ReactNode } from "react";

/**
 * Telegram-style chat bubble used on screens 5, 9, and A.
 *   `from="bot"`   — bot/assistant message, flush-left, neutral surface
 *   `from="user"`  — user message, flush-right, accent tint
 *   `from="alert"` — inline system card (e.g. the low-balance warning),
 *                    full-width with the accent border
 */
export function ChatBubble({
  children,
  from,
  senderName,
  time,
}: {
  children: ReactNode;
  from: "bot" | "user" | "alert";
  senderName?: string;
  time?: string;
}) {
  if (from === "alert") {
    return (
      <div className="w-full rounded-[14px] border border-accent/40 bg-accent-subtle/20 p-4 my-3 text-[14px] text-dk-text-primary">
        {children}
        {time && (
          <div className="text-caption text-dk-text-muted mt-2">{time}</div>
        )}
      </div>
    );
  }

  const isBot = from === "bot";
  return (
    <div className={`flex my-2 ${isBot ? "justify-start" : "justify-end"}`}>
      <div className="max-w-[85%]">
        {senderName && isBot && (
          <div className="text-caption text-dk-text-muted mb-1 ml-1">
            {senderName}
          </div>
        )}
        <div
          className={[
            "rounded-[14px] px-4 py-[10px] text-[14px] leading-[1.5]",
            isBot
              ? "bg-dk-surface text-dk-text-primary rounded-tl-sm"
              : "bg-accent text-white rounded-tr-sm",
          ].join(" ")}
        >
          {children}
        </div>
        {time && (
          <div
            className={`text-caption text-dk-text-muted mt-1 ${isBot ? "ml-1" : "mr-1 text-right"}`}
          >
            {time}
          </div>
        )}
      </div>
    </div>
  );
}
