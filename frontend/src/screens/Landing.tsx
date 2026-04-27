import { Link, useNavigate } from 'react-router-dom';
import { CompatRow, AgentMark } from '../components/CompatRow';
import { TerminalBlock } from '../components/TerminalBlock';
import { TierCard } from '../components/TierCard';
import { SectionHeader } from '../components/SectionHeader';
import { TopNav, BrandPlate } from '../components/TopNav';
import { useAuth } from '../lib/auth';
import openClawIcon from '../assets/agents/openclaw.svg';
import hermesIcon from '../assets/agents/hermes.png';

// Compat row: only true Agent products (not coding CLIs). Codex / Claude
// Code are dev-environments, not agents — keeping the row honest.
const AGENTS: AgentMark[] = [
  {
    id: 'oc',
    name: 'OpenClaw',
    className: 'bg-[#0A0807] p-1',
    icon: <img src={openClawIcon} alt="" className="w-full h-full" style={{ imageRendering: 'pixelated' }} />,
  },
  {
    id: 'hm',
    name: 'Hermes Agent',
    className: 'bg-white p-0',
    icon: <img src={hermesIcon} alt="" className="w-full h-full object-cover rounded-lg" />,
  },
];

/**
 * Differentiator card · used in the Slock-style features row. Each card is
 * a tinted block (bg-[#FFF4E6] etc) with a tiny mono tag on top, a short
 * h3 in the middle, and one paragraph of body copy.
 */
function FeatureCard({
  tag,
  title,
  body,
  accentBg,
}: {
  tag: string;
  title: string;
  body: string;
  accentBg: string;
}) {
  return (
    <div className={`${accentBg} rounded-md p-6 md:p-7 border-2 border-ink shadow-[4px_4px_0_0_#1C1917]`}>
      <p className="font-mono text-[10.5px] font-bold tracking-[0.16em] uppercase text-ink-3 mb-4">
        {tag}
      </p>
      <h3 className="text-[18px] md:text-[20px] font-bold tracking-tight mb-2.5 leading-tight">
        {title}
      </h3>
      <p className="text-[13.5px] text-ink-2 leading-relaxed">
        {body}
      </p>
    </div>
  );
}

/**
 * Slock-pixel button helper. Filled fill + 2px hard ink border + 3px hard
 * offset shadow. Hover "depresses" — translates 1px to bottom-right and
 * shrinks the shadow.
 */
function slockBtn(variant: 'primary' | 'secondary' | 'dark' = 'primary') {
  const base =
    'inline-block border-2 border-ink rounded-md font-bold tracking-tight px-5 py-2.5 md:px-6 md:py-3 text-[14px] md:text-[15px] shadow-[3px_3px_0_0_#1C1917] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#1C1917] transition-all whitespace-nowrap';
  const fill =
    variant === 'primary'
      ? 'bg-accent text-white'
      : variant === 'dark'
        ? 'bg-ink text-white'
        : 'bg-bg text-ink';
  return `${base} ${fill}`;
}

interface FooterLink {
  text: string;
  to?: string;
  href?: string;
}
function FooterCol({ label, links }: { label: string; links: FooterLink[] }) {
  return (
    <div>
      <p className="font-mono text-[10.5px] font-bold tracking-[0.18em] uppercase text-white/35 mb-4">
        {label}
      </p>
      <ul className="space-y-2.5">
        {links.map((l) => (
          <li key={l.text}>
            {l.to ? (
              <Link to={l.to} className="text-[13px] text-white/65 hover:text-white transition-colors">
                {l.text}
              </Link>
            ) : (
              <a href={l.href} className="text-[13px] text-white/65 hover:text-white transition-colors">
                {l.text}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Animated terminal demo on the hero right side. Pure CSS keyframes loop a
 * 6-second cycle showing the four steps after a user runs the install
 * command in their Agent: typing the command → fetching → registering skill
 * → activating $10 trial → idle waiting for instructions.
 */
function HeroTerminalDemo() {
  return (
    <div className="font-mono text-[13px] leading-relaxed bg-[#1C1917] rounded-2xl border border-[#3A332D] shadow-[0_30px_60px_-30px_rgba(60,40,20,0.45),0_8px_24px_-10px_rgba(60,40,20,0.25)] overflow-hidden select-none">
      {/* chrome — alternates between HERMES AGENT and OPENCLAW every 6s */}
      <div className="px-4 py-2.5 bg-[#0F0D0B] border-b border-[#3A332D] flex items-center gap-1.5">
        <span className="w-2.5 h-2.5 rounded-full bg-[#FB7185]"></span>
        <span className="w-2.5 h-2.5 rounded-full bg-[#FBBF24]"></span>
        <span className="w-2.5 h-2.5 rounded-full bg-[#34D399]"></span>
        <span className="ml-3 font-mono text-[10px] text-[#A89A8D] tracking-[0.16em] uppercase relative inline-block min-w-[160px]">
          <span className="td-header td-header-hermes">hermes agent</span>
          <span className="td-header td-header-openclaw absolute left-0 top-0">openclaw</span>
        </span>
      </div>

      {/* body */}
      <div className="p-5 min-h-[260px] text-[#A89A8D]">
        <div className="flex items-baseline gap-2">
          <span className="text-accent font-semibold">$</span>
          <span className="text-[#FFF8F0] td-typing whitespace-nowrap overflow-hidden inline-block">set up tokenboss.com/skill.md</span>
          <span className="td-cursor inline-block w-[7px] h-[14px] bg-[#FFF8F0] -mb-[2px]"></span>
        </div>

        <div className="td-line td-line-1 mt-2 flex items-center gap-2">
          <span className="text-[#34D399]">→</span>
          <span>fetching <span className="text-[#FFF8F0]">tokenboss.com/skill.md</span></span>
        </div>

        <div className="td-line td-line-2 mt-1 flex items-center gap-2">
          <span className="text-[#34D399]">✓</span>
          <span>registered skill <span className="text-accent">tokenboss</span> <span className="opacity-60">v1.0.0</span></span>
        </div>

        <div className="td-line td-line-3 mt-1 flex items-center gap-2">
          <span className="text-[#34D399]">✓</span>
          <span>activated <span className="text-[#FFF8F0]">$10</span> · <span className="opacity-60">24 h trial</span></span>
        </div>

        <div className="td-line td-line-4 mt-4 flex items-center gap-2 text-[#FFF8F0]">
          <span className="text-accent">›</span>
          <span>ready for instructions</span>
          <span className="td-cursor-blink inline-block w-[7px] h-[14px] bg-[#FFF8F0] -mb-[2px]"></span>
        </div>
      </div>
    </div>
  );
}

export default function Landing() {
  const { user } = useAuth();
  const isLoggedIn = !!user;
  const navigate = useNavigate();
  const goRegister = () => navigate('/register');

  // v1.0 has no self-checkout. Visitors → /register; logged-in → contact 客服.
  // Ultra is sold-out for logged-in users per spec, but visitors still see the
  // try CTA so we can funnel them into /register first.
  const tierCta = isLoggedIn
    ? { text: '联系客服购买', onClick: undefined }
    : { text: '免费开始 →', onClick: goRegister };
  const ultraCta = isLoggedIn
    ? { text: '名额已满', onClick: undefined, soldOut: true, variant: 'disabled' as const }
    : { text: '免费开始 →', onClick: goRegister, soldOut: false, variant: 'secondary' as const };
  const standardCta = isLoggedIn
    ? { text: '联系客服充值', onClick: undefined }
    : { text: '免费开始 →', onClick: goRegister };

  return (
    <div className="min-h-screen bg-bg overflow-hidden">
      <TopNav current="home" />

      {/* Hero */}
      <section className="max-w-[1200px] mx-auto px-6 md:px-14 pt-12 md:pt-20 pb-10 md:pb-12">
        <CompatRow label="你已经在用的 Agent · 开箱接管" agents={AGENTS} className="mb-7" />

        {/* 2-col on lg+, single col stacked on mobile */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] gap-x-12 gap-y-10 items-start">
          {/* LEFT: H1 + terminal + meta + CTA */}
          <div>
            <h1 className="font-sans text-[44px] md:text-[64px] lg:text-[72px] font-extrabold leading-none tracking-tight">
              你的 Agent<br />
              <span className="text-accent">钱包</span>
            </h1>

            <TerminalBlock cmd="set up tokenboss.com/skill.md" size="lg" className="mt-7 max-w-[520px]" />

            <p className="text-[13.5px] sm:text-[14px] text-ink-2 max-w-[520px] mt-4 leading-relaxed">
              一行命令装上 → Agent 立刻用得起 Claude · GPT · Codex。<br className="hidden sm:block" />
              <span className="text-ink-3">你专心创造，钱我来管。</span>
            </p>

            <div className="flex flex-wrap items-center gap-4 mt-8">
              {isLoggedIn ? (
                <Link to="/dashboard" className={slockBtn('primary')}>
                  去控制台 →
                </Link>
              ) : (
                <>
                  <Link to="/register" className={slockBtn('primary')}>
                    免费开始 · 送 $10 体验
                  </Link>
                  <span className="text-[13px] text-ink-2">
                    已有账户？<Link to="/login" className="text-ink underline underline-offset-2 hover:text-accent">登录</Link>
                  </span>
                </>
              )}
            </div>
          </div>

          {/* RIGHT: animated terminal demo (lg+ only) */}
          <div className="hidden lg:block lg:pl-2">
            <HeroTerminalDemo />
          </div>
        </div>
      </section>

      {/* Manifesto color band — Slock yellow-band equivalent (terracotta). */}
      <section className="bg-accent text-white border-y-2 border-ink">
        <div className="max-w-[1100px] mx-auto px-6 md:px-14 py-16 md:py-20 text-center">
          <h2 className="font-sans text-[26px] md:text-[40px] lg:text-[44px] font-extrabold leading-[1.15] tracking-tight">
            你专心创造<span className="opacity-55">,</span> 模型的事我们想好了。
          </h2>
        </div>
      </section>

      {/* Features · 3 cards, slock-style */}
      <section className="max-w-[1200px] mx-auto px-6 md:px-14 py-20 md:py-28">
        <p className="font-mono text-[10.5px] font-bold tracking-[0.2em] uppercase text-ink-3 mb-3 text-center">
          What makes TokenBoss different
        </p>
        <h2 className="font-sans text-[28px] md:text-[40px] font-extrabold leading-[1.1] tracking-tight text-center mb-12 md:mb-16">
          只解决一件事 — <span className="text-accent">让你的 Agent 顺手开工。</span>
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-5">
          <FeatureCard
            tag="01"
            title="开局立刻用得起好模型"
            body="$10 免费额度直接到账。Claude Opus / GPT-5 / Codex 顶级模型随便调，不用懂 API key。"
            accentBg="bg-[#FFF4E6]"
          />
          <FeatureCard
            tag="02"
            title="换 Agent 不用换钱包"
            body="今天 Hermes 写文案，明天 OpenClaw 跑研究 — 用同一份额度。换工具不重新开通。"
            accentBg="bg-[#F0EBE3]"
          />
          <FeatureCard
            tag="03"
            title="Agent 自己接好"
            body="在终端粘贴一行 → Agent 自己读 skill.md、自己接好 → 你专心创造，钱我来管。"
            accentBg="bg-[#EAF1ED]"
          />
        </div>
      </section>

      {/* 01 · Membership tiers */}
      <section id="pricing" className="max-w-[1200px] mx-auto px-6 md:px-14 py-12 md:py-16">
        <SectionHeader num="01" cn="套餐" en="Membership" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-5 mt-6">
          <TierCard
            name="Plus"
            pricePeriod="¥288 / 4 周"
            leverage="×3"
            totalUsd="≈ $840 美金额度"
            dailyCap="$30 美金 cap"
            models="Codex 系列模型"
            ctaText={tierCta.text}
            onCtaClick={tierCta.onClick}
            ctaVariant="secondary"
            tooltipExtras={['智能路由 · 多端复用 · API key 多端共享']}
          />
          <TierCard
            name="Super"
            pricePeriod="¥688 / 4 周"
            leverage="×4"
            totalUsd="≈ $2,240 美金额度"
            dailyCap="$80 美金 cap"
            models="Claude + Codex 系列模型"
            ctaText={tierCta.text}
            onCtaClick={tierCta.onClick}
            ctaVariant="primary"
            featured
            tooltipExtras={['含 Sonnet 4.7 / Opus 4.7 · 优先排队 · 高峰不降级']}
          />
          <TierCard
            name="Ultra"
            pricePeriod="¥1688 / 4 周"
            leverage="×12"
            totalUsd="≈ $20,160 美金额度"
            dailyCap="$720 美金 cap"
            models="Claude + Codex + reasoning"
            ctaText={ultraCta.text}
            onCtaClick={ultraCta.onClick}
            ctaVariant={ultraCta.variant}
            soldOut={ultraCta.soldOut}
            tooltipExtras={['含 reasoning (o1/o3) · 专属客服 · SLA · 定制路由策略']}
          />
        </div>
      </section>

      {/* 02 · Pay-as-you-go */}
      <section className="max-w-[1200px] mx-auto px-6 md:px-14 py-12 md:py-16">
        <SectionHeader num="02" cn="按量充值" en="Pay as you go" />
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 p-7 bg-bg border-2 border-ink rounded-md shadow-[3px_3px_0_0_#1C1917] mt-6">
          <div>
            <div className="font-mono text-2xl font-bold">
              <span className="text-base text-ink-2 align-top">¥</span>1
              <span className="text-ink-4 mx-2">/</span>
              <span className="text-base text-ink-2 align-top">$</span>1 美金
            </div>
            <div className="text-sm text-ink-3 mt-1">充值 ¥50 起 · 永不过期 · 全模型解锁</div>
          </div>
          {standardCta.onClick ? (
            <button onClick={standardCta.onClick} className={slockBtn('secondary')}>
              {standardCta.text}
            </button>
          ) : (
            <span className={slockBtn('secondary') + ' cursor-default'}>
              {standardCta.text}
            </span>
          )}
        </div>
      </section>

      {/* Final CTA color band — full-bleed terracotta with hard borders */}
      {!isLoggedIn && (
        <section className="bg-accent text-white border-y-2 border-ink">
          <div className="max-w-[1100px] mx-auto px-6 md:px-14 py-20 md:py-24 text-center">
            <h2 className="font-sans text-[34px] md:text-[52px] font-extrabold leading-[1.05] tracking-tight mb-3">
              现在试试？
            </h2>
            <p className="text-white/90 text-[15px] md:text-[17px] mb-8">
              免费开始 · 送 $10 体验额度 · 无需绑卡。
            </p>
            <div className="flex items-center justify-center gap-5 flex-wrap">
              <Link to="/register" className={slockBtn('dark')}>
                免费开始 →
              </Link>
              <span className="text-white/90 text-[14px]">
                已有账户？<Link to="/login" className="underline hover:text-white">登录</Link>
              </span>
            </div>
          </div>
        </section>
      )}

      {/* Footer · dark Slock-style */}
      <footer className="bg-ink text-white/60">
        <div className="max-w-[1200px] mx-auto px-6 md:px-14 py-14 md:py-16">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-8 md:gap-12 mb-10">
            {/* Brand col — uses the same tilted plate as the top nav */}
            <div className="col-span-2 md:col-span-1">
              <BrandPlate dark />
              <p className="text-white/45 text-[13px] leading-relaxed max-w-xs mt-4">
                你专心创造，钱我来管。
              </p>
            </div>

            <FooterCol
              label="PRODUCT"
              links={[
                { text: '钱包', to: '/' },
                { text: '原语', to: '/primitive' },
              ]}
            />
            <FooterCol
              label="DEVELOPERS"
              links={[
                { text: '快速接入', to: '/install/manual' },
              ]}
            />
          </div>
          <div className="pt-6 border-t border-white/10 font-mono text-[10.5px] text-white/35">
            © 2026 TokenBoss · All rights reserved.
          </div>
        </div>
      </footer>

      {/* Animated terminal demo keyframes (scoped via CSS class names, single 6s loop) */}
      <style>{`
        @keyframes td-type {
          0%   { width: 0; }
          15%  { width: 100%; }
          90%  { width: 100%; }
          100% { width: 0; }
        }
        @keyframes td-fadeup {
          0%, 100% { opacity: 0; transform: translateY(-3px); }
          /* hold visible 25-90% of cycle */
        }
        @keyframes td-cursor {
          0%, 12%   { opacity: 1; }
          12.01%, 100% { opacity: 0; }
        }
        @keyframes td-cursor-blink {
          0%, 60%   { opacity: 0; }
          70%, 100% { opacity: 1; }
          85%       { opacity: 0; }
        }
        .td-typing  { animation: td-type 6s steps(30, end) infinite; }
        .td-cursor  { animation: td-cursor 6s steps(1, end) infinite; }
        .td-line    { opacity: 0; animation-iteration-count: infinite; animation-duration: 6s; animation-timing-function: ease-out; animation-fill-mode: forwards; }
        .td-line-1  { animation-name: td-line-1; }
        .td-line-2  { animation-name: td-line-2; }
        .td-line-3  { animation-name: td-line-3; }
        .td-line-4  { animation-name: td-line-4; }
        @keyframes td-line-1 {
          0%, 24%  { opacity: 0; transform: translateY(-2px); }
          28%, 92% { opacity: 1; transform: translateY(0); }
          100%     { opacity: 0; transform: translateY(-2px); }
        }
        @keyframes td-line-2 {
          0%, 36%  { opacity: 0; transform: translateY(-2px); }
          40%, 92% { opacity: 1; transform: translateY(0); }
          100%     { opacity: 0; transform: translateY(-2px); }
        }
        @keyframes td-line-3 {
          0%, 48%  { opacity: 0; transform: translateY(-2px); }
          52%, 92% { opacity: 1; transform: translateY(0); }
          100%     { opacity: 0; transform: translateY(-2px); }
        }
        @keyframes td-line-4 {
          0%, 62%  { opacity: 0; transform: translateY(-2px); }
          66%, 92% { opacity: 1; transform: translateY(0); }
          100%     { opacity: 0; transform: translateY(-2px); }
        }
        .td-cursor-blink { animation: td-cursor-blink 1s steps(2, end) infinite; }
        @media (prefers-reduced-motion: reduce) {
          .td-typing, .td-cursor, .td-line, .td-cursor-blink { animation: none !important; opacity: 1 !important; width: 100% !important; }
        }
        /* Terminal header swap — 12s loop, hermes 0-6s, openclaw 6-12s. */
        @keyframes td-header-hermes   { 0%, 49.99% { opacity: 1; } 50%, 100% { opacity: 0; } }
        @keyframes td-header-openclaw { 0%, 49.99% { opacity: 0; } 50%, 100% { opacity: 1; } }
        .td-header           { animation-duration: 12s; animation-iteration-count: infinite; animation-timing-function: steps(1, end); }
        .td-header-hermes    { animation-name: td-header-hermes; }
        .td-header-openclaw  { animation-name: td-header-openclaw; opacity: 0; }
        @media (prefers-reduced-motion: reduce) {
          .td-header { animation: none !important; }
          .td-header-openclaw { opacity: 0 !important; }
        }
      `}</style>
    </div>
  );
}
