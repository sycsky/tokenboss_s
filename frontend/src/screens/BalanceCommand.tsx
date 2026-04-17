import { TelegramShell } from "../components/TelegramShell.js";
import { ChatBubble } from "../components/ChatBubble.js";
import { LinkButton } from "../components/Button.js";

/**
 * Screen A — `/balance` command response. Shows a quota card inside a
 * Telegram bubble with the current month's usage summary.
 */
export default function BalanceCommand() {
  return (
    <TelegramShell>
      <ChatBubble from="user" time="10:05">
        /balance
      </ChatBubble>

      <div className="my-2 rounded-[14px] bg-dk-surface border border-dk-border p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-caption text-dk-text-muted">本月额度</div>
          <div className="text-caption text-accent font-semibold">标准版</div>
        </div>
        <div className="flex items-baseline gap-2 mb-3">
          <span className="font-mono text-[32px] font-semibold text-dk-text-primary">
            72%
          </span>
          <span className="text-caption text-dk-text-muted">
            · 剩余 $14.40 / $20.00
          </span>
        </div>
        <div className="h-2 bg-dk-bg rounded-full overflow-hidden mb-4">
          <div
            className="h-full bg-accent"
            style={{ width: "72%" }}
          />
        </div>

        <div className="space-y-1.5 text-caption">
          <div className="flex justify-between">
            <span className="text-dk-text-muted">重置日期</span>
            <span className="font-mono text-dk-text-primary">2026-05-01</span>
          </div>
          <div className="flex justify-between">
            <span className="text-dk-text-muted">今日已用</span>
            <span className="font-mono text-dk-text-primary">$0.83</span>
          </div>
          <div className="flex justify-between">
            <span className="text-dk-text-muted">日上限</span>
            <span className="font-mono text-dk-text-primary">$2.00</span>
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-dk-border">
          <div className="text-caption text-dk-text-muted">详细账单</div>
          <a
            href="/dashboard"
            className="text-caption text-accent hover:underline"
          >
            tokenboss.co/dashboard →
          </a>
        </div>
      </div>

      <div className="mt-6">
        <LinkButton to="/dashboard" fullWidth>
          打开网页后台
        </LinkButton>
      </div>
    </TelegramShell>
  );
}
