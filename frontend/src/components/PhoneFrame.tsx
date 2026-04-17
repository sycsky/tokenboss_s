import type { ReactNode } from "react";

/**
 * Mobile-first shell. On small viewports it fills the screen; on desktop it
 * centers the content in a phone-shaped column so the mobile prototypes
 * from `flow.html` look right at any window size.
 *
 * `tone` switches the backdrop color between the light default and the dark
 * Telegram-chat variant used by screens 5 / 9 / A.
 */
export function PhoneFrame({
  children,
  tone = "light",
}: {
  children: ReactNode;
  tone?: "light" | "dark";
}) {
  const bg = tone === "dark" ? "bg-dk-bg" : "bg-bg";
  const text = tone === "dark" ? "text-dk-text-primary" : "text-text-primary";
  return (
    <div className={`min-h-screen w-full flex justify-center ${bg}`}>
      <div
        className={`w-full max-w-phone min-h-screen flex flex-col ${bg} ${text}`}
      >
        {children}
      </div>
    </div>
  );
}
