import type { ReactNode } from "react";

/**
 * Standard card per `design.html`:
 *   - white surface, 1px warm border, 14px radius, warm shadow.
 * `tone="dark"` swaps to the Telegram-chat dark surface, `tone="active"`
 * is the selected state for plan cards, `tone="quota"` is the dark stat
 * card used on the dashboard.
 */
export function Card({
  children,
  tone = "default",
  className = "",
  onClick,
}: {
  children: ReactNode;
  tone?: "default" | "active" | "quota" | "dark";
  className?: string;
  onClick?: () => void;
}) {
  const base =
    "rounded-[14px] border p-4 transition-colors";
  const toneClasses: Record<string, string> = {
    default: "bg-surface border-border shadow-warm",
    active: "bg-accent-light border-accent border-[1.5px] shadow-warm",
    quota: "bg-text-primary text-white border-transparent shadow-warm-lg p-[22px]",
    dark: "bg-dk-surface border-dk-border text-dk-text-primary",
  };
  return (
    <div
      className={`${base} ${toneClasses[tone]} ${onClick ? "cursor-pointer" : ""} ${className}`}
      onClick={onClick}
    >
      {children}
    </div>
  );
}
