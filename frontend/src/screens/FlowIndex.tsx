import { Link } from "react-router-dom";

/**
 * `/flow` — developer preview page listing all 15 screens with links.
 * Not part of the product surface; useful during Step 6 development so we
 * can click-check every screen quickly.
 */
const SCREENS: { path: string; label: string; section: string }[] = [
  { path: "/", label: "1a · Landing (current)", section: "Marketing" },
  { path: "/landing/vision", label: "1b · Landing (vision)", section: "Marketing" },
  { path: "/onboard/welcome", label: "2 · Welcome", section: "Onboarding" },
  { path: "/onboard/install", label: "3 · Install CLI", section: "Onboarding" },
  { path: "/onboard/pair-code", label: "5 · Telegram pair code", section: "Onboarding" },
  { path: "/onboard/bind", label: "6 · Enter pair code", section: "Onboarding" },
  { path: "/onboard/success", label: "7 · Binding success", section: "Onboarding" },
  { path: "/chat/low-balance", label: "9 · Low balance alert", section: "Chat" },
  { path: "/chat/balance", label: "A · /balance command", section: "Chat" },
  { path: "/billing/plans", label: "10 · Plan selection", section: "Billing" },
  { path: "/billing/pay?plan=standard", label: "11 · Payment", section: "Billing" },
  {
    path: "/billing/success?plan=standard",
    label: "12 · Payment success",
    section: "Billing",
  },
  { path: "/billing/addons", label: "13 · Add-on packs", section: "Billing" },
  {
    path: "/billing/addon-success?pack=medium",
    label: "14 · Add-on success",
    section: "Billing",
  },
  { path: "/dashboard", label: "B · Dashboard", section: "Web" },
  { path: "/dashboard/history", label: "C · Usage history", section: "Web" },
];

export default function FlowIndex() {
  const bySection: Record<string, typeof SCREENS> = {};
  for (const s of SCREENS) {
    (bySection[s.section] ??= []).push(s);
  }

  return (
    <div className="min-h-screen bg-bg-alt px-6 py-10">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <div className="text-caption text-accent font-semibold tracking-widest">
            DEV PREVIEW
          </div>
          <h1 className="text-h2">TokenBoss · 15 屏导航</h1>
          <p className="text-caption text-text-secondary mt-2">
            这是开发期的内部页，产品上线后会移除。点击进入每一屏看效果。
          </p>
        </div>

        {Object.entries(bySection).map(([section, items]) => (
          <section key={section} className="mb-6">
            <div className="text-label text-text-secondary mb-2">{section}</div>
            <div className="bg-surface border border-border rounded-[14px] overflow-hidden">
              {items.map((s, i) => (
                <Link
                  key={s.path}
                  to={s.path}
                  className={`flex items-center justify-between px-4 py-3 text-body hover:bg-accent-light transition-colors ${
                    i < items.length - 1 ? "border-b border-border-subtle" : ""
                  }`}
                >
                  <span>{s.label}</span>
                  <span className="text-text-muted">→</span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
