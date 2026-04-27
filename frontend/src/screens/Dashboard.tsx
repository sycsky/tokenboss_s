import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import {
  api,
  type BucketRecord,
  type ProxyKeySummary,
  type UsageAggregateGroup,
  type UsageDetailResponse,
} from '../lib/api';
import { APIKeyList, type KeyStats } from '../components/APIKeyList';
import { UsageRow } from '../components/UsageRow';
import { UnverifiedEmailBanner } from '../components/UnverifiedEmailBanner';
import { AppNav, SectionLabel } from '../components/AppNav';
import { slockBtn } from '../lib/slockBtn';

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
  openclaw:    { label: 'OpenClaw',     initials: 'OC', color: 'bg-accent text-white' },
  hermes:      { label: 'Hermes',       initials: 'HR', color: 'bg-lavender text-lavender-ink' },
  'claude-code': { label: 'Claude Code', initials: 'CC', color: 'bg-cyan-stamp text-cyan-stamp-ink' },
  codex:       { label: 'Codex CLI',    initials: 'CX', color: 'bg-lime-stamp text-lime-stamp-ink' },
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
  const noKeys = keys.length === 0;

  const balanceUsd = buckets.reduce((sum, b) => {
    if (b.skuType === 'topup' || b.skuType === 'trial') return sum + (b.totalRemainingUsd ?? 0);
    return sum + (b.dailyRemainingUsd ?? 0);
  }, 0);

  const planBucket = buckets.find((b) => b.skuType.startsWith('plan_'));
  const trialBucket = buckets.find((b) => b.skuType === 'trial');
  const dailyCap = planBucket?.dailyCapUsd ?? 0;
  const dailyRemaining = planBucket?.dailyRemainingUsd ?? 0;
  const dailyUsed = dailyCap - dailyRemaining;
  const dailyPct = dailyCap > 0 ? Math.min(100, (dailyUsed / dailyCap) * 100) : 0;

  const planTag = planBucket
    ? `${planBucket.skuType.replace('plan_', '').toUpperCase()} 套餐 · 还 ${Math.ceil((new Date(planBucket.expiresAt!).getTime() - Date.now()) / 86400e3)} 天`
    : trialBucket
      ? `TRIAL · 还 ${Math.max(0, Math.ceil((new Date(trialBucket.expiresAt!).getTime() - Date.now()) / 3600e3))} 小时`
      : '无活跃套餐';

  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center font-mono text-[#A89A8D]">
        加载中…
      </div>
    );
  }

  const balanceParts = balanceUsd.toFixed(2).split('.');

  return (
    <div className="min-h-screen bg-bg pb-12">
      <AppNav current="console" />

      {user && !user.emailVerified && user.email && (
        <div className="max-w-[1200px] mx-auto px-5 sm:px-9 pt-4">
          <UnverifiedEmailBanner email={user.email} />
        </div>
      )}

      <main className="max-w-[1200px] mx-auto px-5 sm:px-9 pt-5 lg:grid lg:grid-cols-[2fr_1fr] lg:gap-6">
        {/* Balance hero — full width across both columns */}
        <section
          className="lg:col-span-2 bg-accent text-white border-2 border-ink rounded-lg shadow-[4px_4px_0_0_#1C1917] p-6 sm:p-7 mb-5"
        >
          <div className="font-mono text-[10.5px] tracking-[0.18em] uppercase font-bold opacity-85 mb-3">
            当前余额
          </div>
          <div className="font-mono text-[60px] sm:text-[88px] font-bold leading-[0.95] mb-2">
            <span className="text-[28px] sm:text-[42px] opacity-70 align-top mr-1">$</span>
            {balanceParts[0]}
            <span className="opacity-65">.{balanceParts[1]}</span>
          </div>
          <div className="font-mono text-[12px] tracking-[0.08em] opacity-90 mb-5">{planTag}</div>
          <div className="flex flex-wrap gap-3 max-w-md">
            <Link to="/pricing" className={slockBtn('secondary')}>充值 →</Link>
            <a className={slockBtn('dark') + ' cursor-pointer'}>联系客服</a>
          </div>
        </section>

        {/* MAIN COL */}
        <div className="space-y-5">
          {/* Daily cap (only with active plan) */}
          {planBucket && dailyCap > 0 && (
            <section className={`${card} p-5`}>
              <div className="flex justify-between items-baseline mb-3">
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold">
                  今日额度
                </span>
                <span className="font-mono text-[13px] font-bold text-ink">
                  ${dailyUsed.toFixed(2)}
                  <span className="text-[#A89A8D] mx-1">/</span>
                  <span className="text-[#A89A8D]">${dailyCap}</span>
                </span>
              </div>
              <div className="h-3 bg-bg border-2 border-ink rounded overflow-hidden mb-2">
                <div className="h-full bg-accent" style={{ width: `${dailyPct}%` }} />
              </div>
              <div className="flex justify-between font-mono text-[11px] text-[#A89A8D]">
                <span>剩 <span className="text-ink font-semibold">${dailyRemaining.toFixed(2)}</span></span>
                <span>明 0:00 重置</span>
              </div>
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
                · −${(usage.records[0].amountUsd ?? 0).toFixed(3)}
              </div>
            </section>
          )}

          {/* Active buckets */}
          <section>
            <SectionLabel>活跃额度池</SectionLabel>
            <div className="space-y-2.5">
              {buckets.map((b) => (
                <div key={b.id} className={`${card} p-4`}>
                  <div className="flex justify-between mb-2">
                    <span className="text-[14px] font-bold text-ink">
                      {b.skuType === 'topup' ? '充值余额' : b.skuType === 'trial' ? '试用余额' : `${b.skuType.replace('plan_', '').toUpperCase()} 月度套餐`}
                    </span>
                    <BucketTag skuType={b.skuType} />
                  </div>
                  {b.dailyCapUsd != null && (
                    <Row label="每日 cap" value={`$${b.dailyCapUsd}`} />
                  )}
                  {(b.skuType === 'topup' || b.skuType === 'trial') && (
                    <Row label="剩余" value={`$${(b.totalRemainingUsd ?? 0).toFixed(2)}`} />
                  )}
                  {b.skuType === 'trial' && b.expiresAt && (
                    <Row
                      label="到期"
                      value={new Date(b.expiresAt).toLocaleString('zh-CN', {
                        month: 'numeric',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    />
                  )}
                </div>
              ))}
              {buckets.length === 0 && (
                <div className={`${card} p-6 text-center text-[#A89A8D] text-sm`}>暂无活跃额度</div>
              )}
            </div>
          </section>

          {/* Today stats */}
          <section className="grid grid-cols-2 gap-2.5">
            <div className={`${card} p-4`}>
              <div className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold mb-1.5">调用</div>
              <div className="font-mono text-[28px] font-bold leading-none text-ink">{usage.totals?.calls ?? 0}</div>
              <div className="font-mono text-[11px] text-[#A89A8D] mt-1">次</div>
            </div>
            <div className={`${card} p-4`}>
              <div className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold mb-1.5">已用</div>
              <div className="font-mono text-[28px] font-bold leading-none text-accent">${(usage.totals?.consumed ?? 0).toFixed(2)}</div>
            </div>
          </section>
        </div>

        {/* SIDE COL */}
        <aside className="space-y-5 mt-5 lg:mt-0">
          {/* 接入 — Agent + API Key 一张卡片，内部分隔 */}
          <section className={`${card} p-4`}>
            <div className="flex justify-between items-baseline mb-3">
              <span className="text-[14px] font-bold text-ink">接入</span>
              <span className="font-mono text-[10px] text-[#A89A8D] tracking-wider">v1.0</span>
            </div>

            {/* First-time guide — only when user has no keys AND no usage */}
            {noKeys && noActivity ? (
              <FirstTimeGuide />
            ) : (
              <>
                {/* AGENTS sub-section */}
                <div className="font-mono text-[9.5px] font-bold tracking-[0.16em] uppercase text-[#A89A8D] mb-2">
                  AGENTS
                </div>
                {agents.length === 0 ? (
                  <div className="bg-bg border-2 border-dashed border-ink/30 rounded p-3 mb-2.5 text-center font-mono text-[11px] text-[#A89A8D]">
                    还没有 Agent 调用过 · 接入后会自动出现
                  </div>
                ) : (
                  <div className="space-y-1.5 mb-2.5">
                    {agents.map((a) => {
                      return (
                        <div key={a.source} className="bg-bg border-2 border-ink rounded p-2.5 flex items-center gap-2.5">
                          <div className={`w-7 h-7 ${a.color} border-2 border-ink rounded font-mono text-[10px] font-bold flex items-center justify-center flex-shrink-0`}>
                            {a.initials}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[12.5px] font-bold text-ink truncate">{a.label}</div>
                            <div className="font-mono text-[10px] text-[#A89A8D] truncate">
                              {timeAgo(a.lastUsedAt)} · {a.callCount} 次 · ${a.totalSpent.toFixed(3)}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <a
                  href="/install/manual"
                  className={
                    'block text-center px-4 py-2 bg-accent-soft border-2 border-dashed border-ink rounded ' +
                    'text-[12.5px] font-bold tracking-tight text-accent-ink cursor-pointer ' +
                    'shadow-[3px_3px_0_0_#1C1917] ' +
                    'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] ' +
                    'transition-all'
                  }
                >
                  + 接入新 Agent
                </a>

                {/* divider */}
                <div className="my-4 border-t-2 border-ink/10" />

                {/* API KEY sub-section */}
                <div className="font-mono text-[9.5px] font-bold tracking-[0.16em] uppercase text-[#A89A8D] mb-1">
                  API KEY
                </div>
                <APIKeyList keys={keys} loadError={keysError} keyStats={keyStats} onChanged={reloadKeys} />
              </>
            )}
          </section>

          {/* Recent usage */}
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
                  amount={`${(r.amountUsd ?? 0) >= 0 ? '+' : '−'}$${Math.abs(r.amountUsd ?? 0).toFixed(3)}`}
                />
              ))}
              {(!usage.records || usage.records.length === 0) && (
                <div className="text-center text-[#A89A8D] text-[13px] p-6">暂无使用记录</div>
              )}
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
}

function FirstTimeGuide() {
  return (
    <div>
      <div className="font-mono text-[9.5px] font-bold tracking-[0.16em] uppercase text-[#A89A8D] mb-2">
        现在开始
      </div>
      <ol className="space-y-2 mb-3">
        <Step n="1" title="新建一把 API Key" hint="点下面的「现在新建 →」" />
        <Step n="2" title="粘到你的 Agent" hint="OpenClaw / Hermes / Codex 都支持" />
        <Step n="3" title="让 Agent 跑一次" hint="这里就会出现真实数据" />
      </ol>
      <Link
        to="/console/keys"
        className={
          'block text-center px-4 py-2 mb-3 bg-yellow-stamp border-2 border-ink rounded ' +
          'text-[12.5px] font-bold tracking-tight text-yellow-stamp-ink ' +
          'shadow-[3px_3px_0_0_#1C1917] ' +
          'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] ' +
          'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#1C1917] ' +
          'transition-all'
        }
      >
        现在新建 →
      </Link>
      <Link
        to="/install/manual"
        className="block text-center font-mono text-[11px] text-[#A89A8D] hover:text-ink underline underline-offset-2 transition-colors"
      >
        或先看接入文档
      </Link>
    </div>
  );
}

function Step({ n, title, hint }: { n: string; title: string; hint: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="w-5 h-5 flex-shrink-0 bg-ink text-bg border-2 border-ink rounded font-mono text-[10px] font-bold flex items-center justify-center mt-0.5">
        {n}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] font-semibold text-ink leading-snug">{title}</div>
        <div className="font-mono text-[10px] text-[#A89A8D] mt-px">{hint}</div>
      </div>
    </li>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="font-mono text-[11.5px] flex justify-between text-[#6B5E52] py-0.5">
      <span>{label}</span>
      <span className="text-ink font-bold">{value}</span>
    </div>
  );
}

function BucketTag({ skuType }: { skuType: BucketRecord['skuType'] }) {
  const map: Record<BucketRecord['skuType'], { label: string; cls: string }> = {
    trial:       { label: '试用',   cls: 'bg-yellow-stamp text-yellow-stamp-ink' },
    topup:       { label: '不过期', cls: 'bg-lime-stamp text-lime-stamp-ink' },
    plan_plus:   { label: 'Plus',   cls: 'bg-cyan-stamp text-cyan-stamp-ink' },
    plan_super:  { label: 'Super',  cls: 'bg-lavender text-lavender-ink' },
    plan_ultra:  { label: 'Ultra',  cls: 'bg-accent text-white' },
  };
  const t = map[skuType];
  return (
    <span className={`font-mono text-[9.5px] font-bold tracking-wider uppercase border-2 border-ink px-1.5 py-px rounded ${t.cls}`}>
      {t.label}
    </span>
  );
}
