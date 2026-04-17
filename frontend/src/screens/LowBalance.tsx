import { TelegramShell } from "../components/TelegramShell.js";
import { ChatBubble } from "../components/ChatBubble.js";
import { LinkButton } from "../components/Button.js";

/**
 * Screen 9 — Low balance alert inside a Telegram chat. The alert is styled
 * like an in-line system card with an accent border so it stands out
 * against regular chat messages.
 */
export default function LowBalance() {
  return (
    <TelegramShell>
      <ChatBubble from="user" time="14:21">
        帮我用一句话总结一下昨天发的研报要点
      </ChatBubble>
      <ChatBubble from="bot" senderName="Claude Sonnet 4.6" time="14:21">
        昨天的研报核心观点：AI
        资本支出边际开始放缓，但推理需求仍在高速扩张……
      </ChatBubble>

      <ChatBubble from="alert" time="TokenBoss · 系统提示">
        <div className="font-semibold text-accent mb-1">⚠ 余额不多啦</div>
        <div>
          剩余 <span className="font-mono font-semibold">$0.42</span>
          ，约 8%。继续使用大约还能对话 30 次。
        </div>
        <div className="mt-3 flex gap-2">
          <a
            href="/billing/plans"
            className="text-caption text-accent hover:text-accent-hover underline underline-offset-2"
          >
            续费 →
          </a>
          <span className="text-caption text-dk-text-muted">·</span>
          <a
            href="/billing/addons"
            className="text-caption text-accent hover:text-accent-hover underline underline-offset-2"
          >
            买加量包 →
          </a>
        </div>
      </ChatBubble>

      <ChatBubble from="user" time="14:22">
        /balance
      </ChatBubble>

      <div className="mt-6 space-y-2">
        <LinkButton to="/billing/plans" fullWidth>
          升级套餐
        </LinkButton>
        <LinkButton to="/billing/addons" variant="secondary" fullWidth>
          只买加量包
        </LinkButton>
      </div>
    </TelegramShell>
  );
}
