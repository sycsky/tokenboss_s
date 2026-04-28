import { useState } from 'react';
import { Link } from 'react-router-dom';
import { TerminalBlock } from '../components/TerminalBlock';
import { TopNav } from '../components/TopNav';
import { AppNav } from '../components/AppNav';
import { useAuth } from '../lib/auth';
import { slockBtn } from '../lib/slockBtn';

/**
 * Public-facing landing for `tokenboss.co/skill.md` (v0.4.0 OpenClaw spec).
 *
 * The .md file is served as raw markdown to Agents from the same URL —
 * humans clicking the link land here instead. Mirrors the file's
 * structure: install spell, what gets configured (3 providers), merge
 * rules, model table, verification, troubleshooting.
 */

const SKILL_VERSION = '0.4.0';
const SKILL_RAW_URL = '/skill.md';

const card = 'bg-white border-2 border-ink rounded-md shadow-[3px_3px_0_0_#1C1917]';
const codeBlock =
  'font-mono text-[12.5px] text-ink bg-bg border-2 border-ink rounded p-3 ' +
  'whitespace-pre-wrap break-all leading-relaxed';
const codeChip =
  'font-mono text-[12px] text-ink bg-bg border-2 border-ink rounded px-2 py-0.5';

interface ProviderRow {
  key: string;
  protocol: string;
  baseUrl: string;
  models: string[];
  blurb: string;
  accent: string;
}

const PROVIDERS: ProviderRow[] = [
  {
    key: 'tokenboss-gpt',
    protocol: 'openai-responses',
    baseUrl: 'https://api.tokenboss.co/openai',
    blurb: 'OpenAI Responses API (default primary model after install)',
    models: ['gpt-5.5', 'gpt-5.4', 'gpt-5.3-codex', 'gpt-5.1-codex-max'],
    accent: 'bg-cyan-stamp text-cyan-stamp-ink',
  },
  {
    key: 'tokenboss-claude',
    protocol: 'anthropic-messages',
    baseUrl: 'https://api.tokenboss.co/anthropic',
    blurb: 'Anthropic Claude native messages (Sonnet / Opus / Haiku)',
    models: ['claude-sonnet-4-6', 'claude-opus-4-7', 'claude-opus-4-5-20251101', 'claude-haiku-4-5-20251001'],
    accent: 'bg-lavender text-lavender-ink',
  },
  {
    key: 'tokenboss-gemini',
    protocol: 'openai-completions',
    baseUrl: 'https://api.tokenboss.co/openai/v1',
    blurb: 'Google Gemini via OpenAI Chat Completions surface',
    models: ['gemini-3.1-pro-preview', 'gemini-3-flash-preview'],
    accent: 'bg-yellow-stamp text-yellow-stamp-ink',
  },
];

interface InstallStep {
  n: number;
  text: string;
  detail?: string;
}

const INSTALL_STEPS: InstallStep[] = [
  { n: 1, text: 'Fetch this skill' },
  { n: 2, text: 'Prompt for', detail: 'TOKENBOSS_API_KEY' },
  { n: 3, text: 'Merge the JSON below into', detail: '~/.openclaw/openclaw.json' },
  { n: 4, text: 'Set agents.defaults.model.primary to', detail: 'tokenboss-gpt/gpt-5.5' },
  { n: 5, text: 'Restart the gateway so new providers + gateway config take effect' },
];

interface TroubleRow {
  symptom: string;
  cause: string;
  fix: string;
}

const TROUBLE: TroubleRow[] = [
  {
    symptom: '401 Unauthorized',
    cause: 'Missing or wrong key',
    fix: 'Re-run set up to refresh, or openclaw config set models.providers.tokenboss-gpt.apiKey <KEY> (repeat for all three providers)',
  },
  {
    symptom: 'Unknown model id',
    cause: 'Wrong namespace',
    fix: 'Use tokenboss-gpt/..., tokenboss-claude/..., or tokenboss-gemini/...',
  },
  {
    symptom: 'Provider not found',
    cause: 'Skill applied partially',
    fix: 'Re-run set up; check ~/.openclaw/openclaw.json has all three provider keys',
  },
  {
    symptom: '4xx on /anthropic endpoint',
    cause: 'Wrong api field',
    fix: 'tokenboss-claude must use api: "anthropic-messages"',
  },
  {
    symptom: '4xx on /openai endpoint',
    cause: 'Wrong api field',
    fix: 'tokenboss-gpt → api: "openai-responses"; tokenboss-gemini → api: "openai-completions"',
  },
];

const FULL_CONFIG_JSON = `{
  "agents": {
    "defaults": {
      "model": {
        "primary": "tokenboss-gpt/gpt-5.5"
      }
    }
  },
  "gateway": {
    "mode": "local",
    "port": 18789,
    "bind": "loopback"
  },
  "models": {
    "providers": {
      "tokenboss-claude": {
        "baseUrl": "https://api.tokenboss.co/anthropic",
        "apiKey": "\${TOKENBOSS_API_KEY}",
        "api": "anthropic-messages",
        "models": [
          { "id": "claude-sonnet-4-6", "name": "Claude Sonnet 4.6" },
          { "id": "claude-opus-4-7", "name": "Claude Opus 4.7" },
          { "id": "claude-opus-4-5-20251101", "name": "Claude Opus 4.5" },
          { "id": "claude-haiku-4-5-20251001", "name": "Claude Haiku 4.5" }
        ]
      },
      "tokenboss-gpt": {
        "baseUrl": "https://api.tokenboss.co/openai",
        "apiKey": "\${TOKENBOSS_API_KEY}",
        "api": "openai-responses",
        "models": [
          { "id": "gpt-5.5", "name": "GPT-5.5" },
          { "id": "gpt-5.4", "name": "GPT-5.4" },
          { "id": "gpt-5.3-codex", "name": "GPT-5.3 Codex" },
          { "id": "gpt-5.1-codex-max", "name": "GPT-5.1 Codex Max" }
        ]
      },
      "tokenboss-gemini": {
        "baseUrl": "https://api.tokenboss.co/openai/v1",
        "apiKey": "\${TOKENBOSS_API_KEY}",
        "api": "openai-completions",
        "models": [
          { "id": "gemini-3.1-pro-preview", "name": "Gemini 3.1 Pro" },
          { "id": "gemini-3-flash-preview", "name": "Gemini 3 Flash" }
        ]
      }
    }
  }
}`;

const VERIFY_COMMANDS = `# Confirm gateway came back up
openclaw gateway status

# Show current config
openclaw config show models.providers.tokenboss-gpt

# Switch primary model
openclaw models set tokenboss-claude/claude-sonnet-4-6

# Smoke test
openclaw chat "Say hello"`;

export default function Skill() {
  const { user } = useAuth();
  const isLoggedIn = !!user;
  const [showJson, setShowJson] = useState(false);

  return (
    <div className="min-h-screen bg-bg pb-12">
      {isLoggedIn ? <AppNav /> : <TopNav />}

      <main className="max-w-[820px] mx-auto px-5 sm:px-9 pt-6">
        {/* Hero */}
        <div className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-[#A89A8D] font-bold mb-2 flex items-center gap-2 flex-wrap">
          <span className="bg-yellow-stamp text-yellow-stamp-ink border-2 border-ink rounded px-1.5 py-0.5 tracking-[0.12em]">
            v{SKILL_VERSION}
          </span>
          <span>SKILL · tokenboss for openclaw</span>
        </div>
        <h1 className="text-[40px] md:text-[48px] font-bold tracking-tight leading-[1.05] mb-3">
          One key · three providers.
        </h1>
        <p className="text-[14px] text-text-secondary mb-9 max-w-[600px] leading-relaxed">
          Adds TokenBoss to OpenClaw as three providers — <span className="font-mono text-[13px] text-ink-2">tokenboss-gpt</span>, <span className="font-mono text-[13px] text-ink-2">tokenboss-claude</span>, <span className="font-mono text-[13px] text-ink-2">tokenboss-gemini</span> — under <span className={codeChip}>models.providers.*</span>. One TokenBoss API key authenticates all three.
        </p>

        {/* 01 · Install spell */}
        <section className="mb-10">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold mb-3 flex items-center gap-2">
            <span className="bg-lime-stamp text-lime-stamp-ink border-2 border-ink rounded px-1.5 py-0.5 tracking-[0.12em]">
              install
            </span>
            <span>In OpenClaw, run</span>
          </div>
          <div className={`${card} p-6`}>
            <TerminalBlock cmd="set up tokenboss.co/skill.md" size="lg" />
            <p className="text-[13.5px] text-text-secondary mt-4 mb-3 leading-relaxed">
              OpenClaw will:
            </p>
            <ol className="space-y-2.5">
              {INSTALL_STEPS.map((s) => (
                <li key={s.n} className="flex items-start gap-3 text-[13.5px] text-text-secondary leading-relaxed">
                  <span className="flex-shrink-0 w-5 h-5 inline-flex items-center justify-center bg-ink text-bg border-2 border-ink rounded font-mono text-[10.5px] font-bold mt-0.5">
                    {s.n}
                  </span>
                  <span className="flex-1 min-w-0">
                    {s.text}
                    {s.detail && <> <span className={codeChip}>{s.detail}</span></>}
                  </span>
                </li>
              ))}
            </ol>
            <div className="mt-4 pt-4 border-t-2 border-ink/10">
              <p className="text-[12.5px] text-text-secondary mb-2">
                Restart command (no-op if your OpenClaw auto-restarts on <code className={codeChip}>set up</code>):
              </p>
              <div className={codeBlock}>openclaw gateway restart</div>
            </div>
          </div>
        </section>

        {/* 02 · What gets configured — 3 provider cards */}
        <section className="mb-10">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold mb-3">
            What gets configured · 3 providers
          </div>
          <div className="space-y-3">
            {PROVIDERS.map((p) => (
              <div key={p.key} className={`${card} p-5`}>
                <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
                  <span className={`font-mono text-[13px] font-bold tracking-tight px-2 py-0.5 ${p.accent} border-2 border-ink rounded`}>
                    {p.key}
                  </span>
                  <span className="font-mono text-[10.5px] text-[#A89A8D] tracking-[0.12em] uppercase">
                    api: {p.protocol}
                  </span>
                </div>
                <p className="text-[12.5px] text-text-secondary mb-3 leading-relaxed">
                  {p.blurb}
                </p>
                <div className="font-mono text-[10.5px] text-[#A89A8D] mb-1 tracking-[0.12em] uppercase">Base URL</div>
                <div className={codeBlock + ' mb-3'}>{p.baseUrl}</div>
                <div className="font-mono text-[10.5px] text-[#A89A8D] mb-1.5 tracking-[0.12em] uppercase">Models</div>
                <div className="flex flex-wrap gap-1.5">
                  {p.models.map((m) => (
                    <span key={m} className="font-mono text-[11px] text-ink-2 bg-bg border-2 border-ink/30 rounded px-1.5 py-0.5">
                      {m}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="font-mono text-[11px] text-[#A89A8D] mt-3 leading-relaxed">
            Reference any model as <span className={codeChip}>&lt;provider-key&gt;/&lt;model-id&gt;</span>, e.g. <span className={codeChip}>tokenboss-claude/claude-sonnet-4-6</span>
          </p>
        </section>

        {/* 03 · Full JSON (collapsed by default — most users won't need to see it) */}
        <section className="mb-10">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold mb-3">
            Configuration JSON
          </div>
          <div className={`${card} p-5`}>
            <p className="text-[13px] text-text-secondary mb-3 leading-relaxed">
              <span className="font-bold text-ink">Never blanket-overwrite</span> <span className={codeChip}>~/.openclaw/openclaw.json</span>. Update only the <span className={codeChip}>agents</span>, <span className={codeChip}>models</span>, and <span className={codeChip}>gateway</span> nodes. Replace <span className={codeChip}>{'${TOKENBOSS_API_KEY}'}</span> with your key.
            </p>
            <button
              type="button"
              onClick={() => setShowJson((v) => !v)}
              className={
                'font-mono text-[11px] font-bold tracking-wider uppercase text-ink-2 hover:text-accent ' +
                'underline underline-offset-4 decoration-2 decoration-ink/20 hover:decoration-accent transition-colors'
              }
            >
              {showJson ? '收起 JSON ↑' : '展开完整 JSON ↓'}
            </button>
            {showJson && (
              <div className={codeBlock + ' mt-3'}>{FULL_CONFIG_JSON}</div>
            )}
          </div>
        </section>

        {/* 04 · Verify */}
        <section className="mb-10">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold mb-3">
            Verify
          </div>
          <div className={`${card} p-5`}>
            <p className="text-[13px] text-text-secondary mb-3 leading-relaxed">
              After install + restart:
            </p>
            <div className={codeBlock}>{VERIFY_COMMANDS}</div>
          </div>
        </section>

        {/* 05 · Troubleshooting */}
        <section className="mb-10">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold mb-3">
            Troubleshooting
          </div>
          <div className={`${card} overflow-hidden`}>
            <table className="w-full">
              <thead>
                <tr className="bg-ink text-bg border-b-2 border-ink">
                  <Th className="w-[28%]">Symptom</Th>
                  <Th className="w-[22%]">Cause</Th>
                  <Th>Fix</Th>
                </tr>
              </thead>
              <tbody>
                {TROUBLE.map((t, i) => (
                  <tr key={t.symptom} className={i < TROUBLE.length - 1 ? 'border-b border-ink/10' : ''}>
                    <Td>
                      <span className="font-mono text-[12px] font-bold text-accent">{t.symptom}</span>
                    </Td>
                    <Td className="text-[12.5px] text-ink">{t.cause}</Td>
                    <Td className="text-[12px] text-text-secondary">{t.fix}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* CTA + raw md link */}
        <section className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t-2 border-ink/10">
          <Link
            to="/console"
            className={slockBtn('primary') + ' inline-flex items-center'}
          >
            Get your API key →
          </Link>
          <a
            href={SKILL_RAW_URL}
            className="font-mono text-[12px] text-ink-2 hover:text-ink underline underline-offset-4 decoration-2"
          >
            View raw skill.md ↗
          </a>
        </section>
      </main>
    </div>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`text-left font-mono text-[10.5px] font-bold tracking-[0.14em] uppercase text-bg/85 px-4 py-3 ${className}`}>
      {children}
    </th>
  );
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 align-top ${className}`}>{children}</td>;
}
