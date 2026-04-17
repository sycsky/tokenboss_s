import { useState } from "react";

import { PhoneFrame } from "../components/PhoneFrame.js";
import { LinkButton } from "../components/Button.js";
import { BackButton } from "../components/BackButton.js";
import { CHAT_COMPLETIONS_URL } from "../lib/api.js";

type Tab = "curl" | "python" | "node";

/**
 * Developer onboarding. TokenBoss speaks the OpenAI chat-completions
 * protocol so any SDK that supports a custom `base_url` just works —
 * this screen shows the three most common ways to call it.
 */
export default function OnboardInstall() {
  const [tab, setTab] = useState<Tab>("curl");
  const [copied, setCopied] = useState(false);

  const baseUrl = CHAT_COMPLETIONS_URL.replace(/\/v1\/chat\/completions$/, "");

  const snippets: Record<Tab, string> = {
    curl: `curl ${CHAT_COMPLETIONS_URL} \\
  -H "Authorization: Bearer tb_live_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "claude-sonnet-4-6",
    "messages": [{"role": "user", "content": "Hello"}]
  }'`,
    python: `from openai import OpenAI

client = OpenAI(
    base_url="${baseUrl}/v1",
    api_key="tb_live_YOUR_KEY",
)

resp = client.chat.completions.create(
    model="claude-sonnet-4-6",
    messages=[{"role": "user", "content": "Hello"}],
)
print(resp.choices[0].message.content)`,
    node: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${baseUrl}/v1",
  apiKey: "tb_live_YOUR_KEY",
});

const resp = await client.chat.completions.create({
  model: "claude-sonnet-4-6",
  messages: [{ role: "user", content: "Hello" }],
});
console.log(resp.choices[0].message.content);`,
  };

  const current = snippets[tab];

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(current);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* non-secure context — user can select manually */
    }
  }

  return (
    <PhoneFrame>
      <div className="flex-1 px-6 py-8 flex flex-col">
        <div className="mb-4">
          <BackButton />
        </div>

        <h1 className="text-h2 mb-2">接入 TokenBoss</h1>
        <p className="text-body text-text-secondary mb-4">
          TokenBoss 兼容 OpenAI API — 把 base URL 改成下面的地址，api_key
          换成你的 tb_live_ key，就能直接跑。
        </p>

        {/* Base URL card */}
        <div className="bg-accent-subtle border border-accent/30 rounded-[14px] p-3 mb-4">
          <div className="text-caption text-text-secondary mb-1">Base URL</div>
          <div className="font-mono text-caption break-all">{baseUrl}/v1</div>
        </div>

        {/* Language tabs */}
        <div className="flex bg-bg-alt rounded-sm p-1 mb-3">
          {(["curl", "python", "node"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={[
                "flex-1 py-2 rounded-sm text-label transition-colors",
                tab === t
                  ? "bg-surface text-text-primary shadow-warm-sm"
                  : "text-text-secondary",
              ].join(" ")}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Snippet */}
        <div className="bg-text-primary rounded-[14px] p-4 mb-4 flex-1 flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-2">
            <div className="text-caption text-white/60 font-mono">{tab}</div>
            <button
              onClick={handleCopy}
              className="text-caption text-accent hover:text-accent-hover font-medium"
            >
              {copied ? "已复制 ✓" : "复制"}
            </button>
          </div>
          <pre className="font-mono text-[12px] text-white leading-relaxed whitespace-pre-wrap break-all flex-1 overflow-auto">
            {current}
          </pre>
        </div>

        <div className="text-caption text-text-muted mb-3">
          还没有 key？到控制台「管理 API Key」页面创建。
        </div>

        <LinkButton to="/dashboard/keys" fullWidth>
          去创建 API Key
        </LinkButton>
      </div>
    </PhoneFrame>
  );
}
