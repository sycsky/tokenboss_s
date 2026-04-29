import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import {
  api,
  type BucketRecord,
  type CreatedProxyKey,
  type ProxyKeySummary,
  type UsageAggregateGroup,
  type UsageDetailResponse,
} from '../lib/api';
import { APIKeyList, type KeyStats } from '../components/APIKeyList';
import { CreateKeyModal, DeleteKeyModal, RevealKeyModal } from '../components/KeyModals';
import { UsageRow } from '../components/UsageRow';
import { UnverifiedEmailBanner } from '../components/UnverifiedEmailBanner';
import { AppNav, SectionLabel } from '../components/AppNav';
import { TerminalBlock } from '../components/TerminalBlock';
import { ContactSalesModal } from '../components/ContactSalesModal';
import { slockBtn } from '../lib/slockBtn';
import { getCachedKey, setCachedKey } from '../lib/keyCache';

const card = 'bg-white border-2 border-ink rounded-md shadow-[3px_3px_0_0_#1C1917]';

interface AgentStat {
  source: string;          // raw source identifier ("openclaw" / "hermes" / etc.)
  label: string;           // pretty display name
  initials: string;        // 2-letter avatar block
  color: string;           // tailwind classes for the avatar block
  callCount: number;
  totalSpent: number;
  lastUsedAt: string;      // ISO
}

const AGENT_REGISTRY: Record<string, { label: string; initials: string; color: string }> = {
  openclaw:    { label: 'OpenClaw',      initials: 'OC', color: 'bg-accent text-white' },
  hermes:      { label: 'Hermes Agent',  initials: 'HA', color: 'bg-lavender text-lavender-ink' },
};

function describeAgent(source: string): { label: string; initials: string; color: string } {
  const k = source.toLowerCase().trim();
  if (AGENT_REGISTRY[k]) return AGENT_REGISTRY[k];
  return {
    label: source,
    initials: source.slice(0, 2).toUpperCase(),
    color: 'bg-bg-alt text-ink',
  };
}

function shapeAgents(groups: UsageAggregateGroup[]): AgentStat[] {
  return groups
    .filter((g) => g.groupKey != null && g.groupKey.length > 0)
    .map((g) => {
      const source = g.groupKey as string;
      const meta = describeAgent(source);
      return {
        source,
        label: meta.label,
        initials: meta.initials,
        color: meta.color,
        callCount: g.callCount,
        totalSpent: g.totalConsumedUsd,
        lastUsedAt: g.lastUsedAt,
      };
    });
}

function shapeKeyStats(groups: UsageAggregateGroup[]): Map<string, KeyStats> {
  const m = new Map<string, KeyStats>();
  for (const g of groups) {
    if (!g.groupKey) continue;
    const tail = g.groupKey.slice(-4);
    m.set(tail, {
      callCount: g.callCount,
      totalSpent: g.totalConsumedUsd,
      lastUsedAt: g.lastUsedAt,
    });
  }
  return m;
}

function timeAgo(iso: string): string {
  const diffSec = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return `${diffSec} 秒前`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小时前`;
  return `${Math.floor(diffSec / 86400)} 天前`;
}

export default function Dashboard() {
  const { user } = useAuth();
  const [buckets, setBuckets] = useState<BucketRecord[]>([]);
  const [usage, setUsage] = useState<UsageDetailResponse>({ records: [], totals: { consumed: 0, calls: 0 }, hourly24h: [] });
  const [agentGroups, setAgentGroups] = useState<UsageAggregateGroup[]>([]);
  const [keyHintGroups, setKeyHintGroups] = useState<UsageAggregateGroup[]>([]);
  const [keys, setKeys] = useState<ProxyKeySummary[]>([]);
  const [keysError, setKeysError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function reloadKeys() {
    try {
      const r = await api.listKeys();
      setKeys(r.keys);
      setKeysError(null);
    } catch (e) {
      setKeysError((e as Error).message);
    }
  }

  useEffect(() => {
    Promise.all([
      api.getBuckets().then((r) => setBuckets(r.buckets || [])),
      // Recent-call list + balance hero totals — keep small.
      api.getUsage({ limit: 4 }).then((r) => setUsage(r)),
      // AGENTS panel — server-side GROUP BY source.
      api.getUsageAggregate('source').then((r) => setAgentGroups(r.groups)),
      // Per-key stats — server-side GROUP BY keyHint.
      api.getUsageAggregate('keyHint').then((r) => setKeyHintGroups(r.groups)),
      reloadKeys(),
    ]).finally(() => setLoading(false));
  }, []);

  const agents = useMemo(() => shapeAgents(agentGroups), [agentGroups]);
  const keyStats = useMemo(() => shapeKeyStats(keyHintGroups), [keyHintGroups]);
  const noActivity = (usage.totals?.calls ?? 0) === 0;

  // Total spendable balance (sub remaining + wallet top-up). Comes from
  // /v1/me already converted to USD — display directly with `$`. The
  // separate "today's allowance" / "trial remaining" lives in subBucket.
  const balanceUsd = user?.balance ?? 0;

  // V3: trial is a subscription too. The hero treats trial / plus / super /
  // ultra uniformly as "subBucket" and only diverges in the chip color +
  // countdown phrasing.
  const subBucket = buckets.find(
    (b) =>
      b.skuType === 'trial' ||
      b.skuType === 'plan_plus' ||
      b.skuType === 'plan_super' ||
      b.skuType === 'plan_ultra',
  );
  const trialBucket = buckets.find((b) => b.skuType === 'trial');
  const topupBucket = buckets.find((b) => b.skuType === 'topup');
  const isTrial = subBucket?.skuType === 'trial';

  // Period quota (today's allowance for paid plans, total trial budget
  // for trial). Surfaced as a progress bar in its own card below the
  // hero — the same card used to render only for paid plans, but trial
  // is a subscription too and deserves the same usage visibility.
  const periodTotal = subBucket?.amountUsd ?? 0;
  const periodRemaining = isTrial
    ? (subBucket?.totalRemainingUsd ?? 0)
    : (subBucket?.dailyRemainingUsd ?? 0);
  const periodUsed = Math.max(0, periodTotal - periodRemaining);
  const periodPct = periodTotal > 0 ? Math.min(100, (periodUsed / periodTotal) * 100) : 0;

  // Live trial countdown — ticks once a second, only when there's a
  // trial bucket whose expiry is in the future. The hero shows it as a
  // mono HH:MM:SS so the urgency carried over from /onboard/success
  // doesn't get lost the moment the user lands on /console.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!trialBucket?.expiresAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [trialBucket?.expiresAt]);
  const trialSecRemaining = trialBucket?.expiresAt
    ? Math.max(0, Math.floor((new Date(trialBucket.expiresAt).getTime() - now) / 1000))
    : 0;
  const tH = String(Math.floor(trialSecRemaining / 3600)).padStart(2, '0');
  const tM = String(Math.floor((trialSecRemaining % 3600) / 60)).padStart(2, '0');
  const tS = String(trialSecRemaining % 60).padStart(2, '0');
  const trialClock = `${tH}:${tM}:${tS}`;

  // Plan tier metadata — chip color follows the status palette so
  // each tier reads at a glance without needing to read the label.
  const tierLabel =
    subBucket?.skuType === 'trial'
      ? 'TRIAL'
      : subBucket?.skuType.replace('plan_', '').toUpperCase() ?? '';
  const tierChipClass =
    subBucket?.skuType === 'trial' ? 'bg-yellow-stamp text-yellow-stamp-ink'
    : subBucket?.skuType === 'plan_plus' ? 'bg-cyan-stamp text-cyan-stamp-ink'
    : subBucket?.skuType === 'plan_super' ? 'bg-lavender text-lavender-ink'
    : subBucket?.skuType === 'plan_ultra' ? 'bg-accent text-white'
    : '';
  const subDaysRemaining = subBucket?.expiresAt
    ? Math.max(0, Math.ceil((new Date(subBucket.expiresAt).getTime() - Date.now()) / 86400e3))
    : 0;

  // Default-key target for the inline spell. The spell always points at
  // the same default key, so once we've revealed its plaintext on this
  // browser we cache it (per email+keyId in localStorage) — repeat
  // /console visits then read the cache and bypass newapi entirely.
  //
  // First visit: spell shows the masked key from listKeys; COPY runs
  // the resolver, which reveals via newapi, writes the plaintext to
  // both the clipboard and the cache, and swaps the visible value.
  //
  // Subsequent visits: cache hit → spell shows plaintext immediately,
  // no resolver needed, COPY is a pure-clipboard op with zero network.
  //
  // The bottom API KEY list rows still reveal-on-click (see APIKeyList)
  // since those serve management, not the always-on copy spell.
  const defaultKey = keys.find((k) => k.label === 'default') ?? keys[0];
  const cachedDefaultPlain =
    user?.email && defaultKey ? getCachedKey(user.email, defaultKey.keyId) : null;
  const spellExtra = defaultKey
    ? cachedDefaultPlain
      ? `TOKENBOSS_API_KEY=${cachedDefaultPlain}`
      : `TOKENBOSS_API_KEY=${defaultKey.key}`
    : undefined;
  const spellResolver =
    defaultKey && !cachedDefaultPlain
      ? async () => {
          const { key } = await api.revealKey(defaultKey.keyId);
          if (user?.email) setCachedKey(user.email, defaultKey.keyId, key);
          return `TOKENBOSS_API_KEY=${key}`;
        }
      : undefined;

  // Contact-sales modal — every paid action (upgrade / renew / topup)
  // routes through here in v1 since there's no self-checkout yet.
  const [contactReason, setContactReason] = useState<
    'upgrade' | 'renew' | 'topup' | 'general' | null
  >(null);

  // Inline key management — Create → Reveal → Delete all live on this
  // page now. The reveal stage owns the freshly-minted plaintext key
  // (one-shot), then `closeRevealAndRefresh` clears it and reloads the
  // list so the new entry shows up.
  const [createOpen, setCreateOpen] = useState(false);
  const [justCreated, setJustCreated] = useState<CreatedProxyKey | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProxyKeySummary | null>(null);

  function handleCreated(created: CreatedProxyKey) {
    setCreateOpen(false);
    setJustCreated(created);
    void reloadKeys();
  }
  function closeReveal() {
    setJustCreated(null);
  }
  async function handleDeleted() {
    setDeleteTarget(null);
    await reloadKeys();
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center font-mono text-[#A89A8D]">
        加载中…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg pb-12">
      <AppNav current="console" />

      {user && !user.emailVerified && user.email && (
        <div className="max-w-[1200px] mx-auto px-5 sm:px-9 pt-4">
          <UnverifiedEmailBanner email={user.email} />
        </div>
      )}

      <main className="max-w-[1200px] mx-auto px-5 sm:px-9 pt-5 lg:grid lg:grid-cols-[2fr_1fr] lg:gap-6">
        {/* Subscription hero — uniform treatment for any active tier
              (trial / plus / super / ultra). All three say "今日剩" since
              trial is also a 24h day-card. Mini progress bar lives on the
              hero itself — no separate "今日额度" card below. CTA differs:
                · trial            → "选个套餐 →"  /pricing (upgrade to paid)
                · plus/super/ultra → "续费 →"     ContactSalesModal(renew)
                                      + "充值额度" link → ContactSalesModal(topup)
                                     v1 has no self-serve upgrade across tiers,
                                     so within-tier renew + wallet topup are
                                     the only meaningful actions.
              No active subscription → "Agent 余额" + "开通套餐 →". */}
        <section className="lg:col-span-2 bg-accent text-white border-2 border-ink rounded-lg shadow-[4px_4px_0_0_#1C1917] px-5 py-4 sm:px-7 sm:py-5 mb-5">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            {subBucket ? (
              <>
                <div className="flex items-baseline gap-3 flex-wrap">
                  <span className="font-mono text-[10.5px] tracking-[0.18em] uppercase font-bold opacity-85">
                    今日剩
                  </span>
                  <span className="font-mono text-[36px] sm:text-[44px] font-bold leading-none">
                    <span className="text-[18px] sm:text-[22px] opacity-70 align-top mr-0.5">$</span>
                    {periodRemaining.toFixed(4)}
                    <span className="opacity-60 text-[18px] sm:text-[22px] ml-2">
                      / ${periodTotal}
                    </span>
                  </span>
                </div>

                <div className="flex items-center gap-2.5">
                  <span
                    className={
                      `font-mono text-[9.5px] tracking-[0.16em] uppercase font-bold px-1.5 py-0.5 ${tierChipClass} border-2 border-ink rounded`
                    }
                  >
                    {tierLabel}
                  </span>
                  <span className="font-mono text-[13px] font-bold leading-none">
                    {isTrial && trialSecRemaining > 0
                      ? `剩 ${trialClock}`
                      : isTrial
                        ? '已到期'
                        : `本月还 ${subDaysRemaining} 天`}
                  </span>
                </div>

                {isTrial ? (
                  <Link
                    to="/pricing"
                    className={slockBtn('secondary') + ' ml-auto'}
                  >
                    选个套餐 →
                  </Link>
                ) : (
                  <div className="ml-auto flex items-center gap-3 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setContactReason('topup')}
                      className="font-mono text-[12px] text-white/80 hover:text-white underline underline-offset-4 decoration-white/30 hover:decoration-white transition-colors"
                    >
                      充值额度
                    </button>
                    <button
                      type="button"
                      onClick={() => setContactReason('renew')}
                      className={slockBtn('secondary')}
                    >
                      续费 →
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="flex items-baseline gap-3 flex-wrap">
                  <span className="font-mono text-[10.5px] tracking-[0.18em] uppercase font-bold opacity-85">
                    Agent 余额
                  </span>
                  <span className="font-mono text-[36px] sm:text-[44px] font-bold leading-none">
                    <span className="text-[18px] sm:text-[22px] opacity-70 align-top mr-0.5">$</span>
                    {balanceUsd.toFixed(4)}
                  </span>
                </div>

                <Link to="/pricing" className={slockBtn('secondary') + ' ml-auto'}>开通套餐 →</Link>
              </>
            )}
          </div>

          {/* Mini progress bar — only when there's a subscription with a
              meaningful period total. Slim bar (h-2) inside hero replaces
              the larger standalone "今日额度" card we used to have below. */}
          {subBucket && periodTotal > 0 && (
            <div className="mt-4 h-2 bg-white/20 border border-white/40 rounded overflow-hidden">
              <div className="h-full bg-white" style={{ width: `${periodPct}%` }} />
            </div>
          )}
        </section>

        {/* MAIN COL */}
        <div className="space-y-5">
          {/* Total balance — only shown when the user has BOTH a sub AND
              wallet topup. In that case the hero shows today's allowance
              (sub-bound) but the user also has accrued topup that won't
              expire — this card surfaces the "your total walking-around
              money" so they don't think today's number is everything.
              For sub-only users, balance ≈ today's allowance, so this
              card would just be a confusing duplicate. */}
          {subBucket && topupBucket && (
            <section className={`${card} p-4 flex items-center gap-3 flex-wrap`}>
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold flex-shrink-0">
                Agent 余额
              </span>
              <span className="font-mono text-[16px] font-bold text-ink">
                ${balanceUsd.toFixed(4)}
              </span>
              <span className="font-mono text-[11px] text-[#A89A8D] flex-1 min-w-0">
                总可用 ≈ 订阅剩余 + 充值余量
              </span>
            </section>
          )}

          {/* Latest call — keeps the dark "live status" feel from before but
              dressed in Slock-pixel: ink fill + accent-orange hard offset. */}
          {usage.records?.[0] && (
            <section className="bg-ink text-white border-2 border-ink rounded-md shadow-[3px_3px_0_0_#E8692A] px-4 py-3.5 flex items-center gap-3">
              <span className="relative flex-shrink-0" aria-hidden="true">
                <span className="absolute inset-0 bg-[#16A34A]/40 rounded-full animate-ping" />
                <span className="relative block w-2 h-2 bg-[#16A34A] rounded-full" />
              </span>
              <div className="font-mono text-[11.5px] text-[#A89A8D] leading-snug flex-1 truncate">
                最近 ·{' '}
                <span className="text-white font-semibold">
                  {new Date(usage.records[0].createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                </span>{' '}
                ·{' '}
                <span className="text-accent font-semibold">{usage.records[0].model || 'auto'}</span>{' '}
                · −${(usage.records[0].amountUsd ?? 0).toFixed(6)}
              </div>
            </section>
          )}

          {/* Today stats — full numbers only after the first call has
              landed. Before that, an empty 0 / $0 grid feels like a
              sterile sandbox; the waiting card carries the story. */}
          {noActivity ? (
            <section className={`${card} p-5 flex items-center gap-4`}>
              <span className="relative flex-shrink-0" aria-hidden="true">
                <span className="absolute inset-0 bg-cyan-stamp/40 rounded-full animate-ping" />
                <span className="relative block w-3 h-3 bg-cyan-stamp border-2 border-ink rounded-full" />
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[14.5px] font-bold text-ink leading-snug">
                  等 Agent 第一笔调用…
                </div>
                <div className="text-[12.5px] text-[#6B5E52] mt-0.5 leading-snug">
                  调用进来这里就会出现实时数据 · 先去 Agent 试一句话
                </div>
              </div>
            </section>
          ) : (
            <section>
              <div className="grid grid-cols-2 gap-2.5">
                <div className={`${card} p-4`}>
                  <div className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold mb-1.5">调用</div>
                  <div className="font-mono text-[28px] font-bold leading-none text-ink">{usage.totals?.calls ?? 0}</div>
                  <div className="font-mono text-[11px] text-[#A89A8D] mt-1">次</div>
                </div>
                <div className={`${card} p-4`}>
                  <div className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold mb-1.5">已用</div>
                  <div className="font-mono text-[28px] font-bold leading-none text-accent">${(usage.totals?.consumed ?? 0).toFixed(4)}</div>
                </div>
              </div>
              <div className="text-right mt-2">
                <Link
                  to="/console/history"
                  className="font-mono text-[11.5px] text-accent font-bold tracking-wider hover:text-accent-deep underline underline-offset-4 decoration-2"
                >
                  查看完整用量 →
                </Link>
              </div>
            </section>
          )}
        </div>

        {/* SIDE COL */}
        <aside className="space-y-5 mt-5 lg:mt-0">
          {/* 接入 — persistent spell + manual-doc fallback, then AGENTS / API Key state. */}
          <section className={`${card} p-4`}>
            <div className="flex justify-between items-baseline mb-3">
              <span className="text-[14px] font-bold text-ink">接入</span>
              <span className="font-mono text-[10px] text-[#A89A8D] tracking-wider">v1.0</span>
            </div>

            {/* Always-visible spell — same SkillBoss-style two-line
                payload as /onboard/install (cmd + key env), so a user
                re-installing on a new machine / agent gets the whole
                bundle from one COPY. */}
            <TerminalBlock
              cmd="set up tokenboss.co/skill.md"
              extra={spellExtra}
              extraResolver={spellResolver}
              loading={keys.length === 0 && !keysError}
              prompt={
                <>
                  <span aria-hidden="true" className="mr-1.5">↓</span>
                  贴给 Agent
                  <span className="text-white/40 mx-1.5">·</span>
                  30 秒接好
                </>
              }
            />
            <Link
              to="/install/manual"
              className="block mt-2.5 font-mono text-[11px] text-[#A89A8D] hover:text-ink transition-colors"
            >
              手动配置文档 →
            </Link>

            {/* divider */}
            <div className="my-4 border-t-2 border-ink/10" />

            {/* AGENTS sub-section */}
            <div className="font-mono text-[9.5px] font-bold tracking-[0.16em] uppercase text-[#A89A8D] mb-2">
              AGENTS
            </div>
            {agents.length === 0 ? (
              <div className="bg-bg border-2 border-dashed border-ink/30 rounded p-3 mb-3 text-center font-mono text-[11px] text-[#A89A8D]">
                还没有 Agent 调用过 · 接入后会自动出现
              </div>
            ) : (
              <div className="space-y-1.5 mb-3">
                {agents.map((a) => (
                  <div key={a.source} className="bg-bg border-2 border-ink rounded p-2.5 flex items-center gap-2.5">
                    <div className={`w-7 h-7 ${a.color} border-2 border-ink rounded font-mono text-[10px] font-bold flex items-center justify-center flex-shrink-0`}>
                      {a.initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12.5px] font-bold text-ink truncate">{a.label}</div>
                      <div className="font-mono text-[10px] text-[#A89A8D] truncate">
                        {timeAgo(a.lastUsedAt)} · {a.callCount} 次 · ${a.totalSpent.toFixed(6)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* divider */}
            <div className="my-4 border-t-2 border-ink/10" />

            {/* API KEY sub-section */}
            <div className="font-mono text-[9.5px] font-bold tracking-[0.16em] uppercase text-[#A89A8D] mb-1">
              API KEY
            </div>
            <APIKeyList
              keys={keys}
              loadError={keysError}
              keyStats={keyStats}
              onCreateClick={() => setCreateOpen(true)}
              onDeleteClick={setDeleteTarget}
            />
          </section>

          {/* Recent usage — only when there's something to show. Empty
              "暂无使用记录" card was the same nothing as the left-col
              waiting indicator and added visual filler. */}
          {!noActivity && (
            <section>
              <SectionLabel
                action={
                  <Link to="/console/history" className="text-accent font-bold tracking-wider hover:text-accent-deep">
                    查看全部 →
                  </Link>
                }
              >
                最近使用
              </SectionLabel>
              <div className={`${card} overflow-hidden`}>
                {usage.records?.slice(0, 4).map((r) => (
                  <UsageRow
                    key={r.id}
                    variant="mobile"
                    time={new Date(r.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                    eventType={r.eventType}
                    model={r.model || undefined}
                    source={r.source || undefined}
                    amount={`${(r.amountUsd ?? 0) >= 0 ? '+' : '−'}$${Math.abs(r.amountUsd ?? 0).toFixed(6)}`}
                  />
                ))}
              </div>
            </section>
          )}
        </aside>
      </main>

      <ContactSalesModal
        open={contactReason !== null}
        onClose={() => setContactReason(null)}
        reason={contactReason ?? undefined}
      />

      <CreateKeyModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={handleCreated}
      />
      <RevealKeyModal
        open={justCreated !== null}
        onClose={closeReveal}
        created={justCreated}
      />
      <DeleteKeyModal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        target={deleteTarget}
        onDeleted={handleDeleted}
      />
    </div>
  );
}

