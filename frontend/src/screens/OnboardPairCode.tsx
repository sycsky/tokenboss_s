import { TelegramShell } from "../components/TelegramShell.js";
import { ChatBubble } from "../components/ChatBubble.js";
import { LinkButton } from "../components/Button.js";

/**
 * Screen 5 — Telegram interaction preview. Shows the bot delivering a
 * one-time pair code after the user runs `/verify`.
 */
export default function OnboardPairCode() {
  return (
    <TelegramShell>
      <ChatBubble from="user" time="19:42">
        /verify
      </ChatBubble>
      <ChatBubble from="bot" senderName="OpenClaw Bot" time="19:42">
        👋 我收到你的验证请求了！
        <br />
        <br />
        请在 60 秒内把下面这组 6 位配对码输入到 TokenBoss 网页：
      </ChatBubble>
      <ChatBubble from="bot" senderName="OpenClaw Bot" time="19:42">
        <span className="font-mono text-[20px] tracking-[0.18em] text-accent">
          TB-8472
        </span>
      </ChatBubble>
      <ChatBubble from="bot" senderName="OpenClaw Bot" time="19:42">
        绑定成功后你就可以在这里直接和模型对话。输入 /help 查看所有指令。
      </ChatBubble>

      <div className="mt-6">
        <LinkButton to="/onboard/bind" fullWidth>
          回到 App 输入配对码
        </LinkButton>
      </div>
    </TelegramShell>
  );
}
