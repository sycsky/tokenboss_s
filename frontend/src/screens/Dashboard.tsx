import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { APIKeyList } from '../components/APIKeyList';
import { UsageRow } from '../components/UsageRow';

interface Bucket {
  id: string;
  skuType: string;
  amountUsd: number;
  dailyCapUsd: number | null;
  dailyRemainingUsd: number | null;
  totalRemainingUsd: number | null;
  expiresAt: string | null;
}

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [usage, setUsage] = useState<any>({ records: [], totals: { consumed: 0, calls: 0 } });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.getBuckets().then((r: any) => setBuckets(r.buckets || [])),
      api.getUsage({ limit: 4 }).then((r: any) => setUsage(r)),
    ]).finally(() => setLoading(false));
  }, []);

  // Compute total balance: sum of all remaining
  const balanceUsd = buckets.reduce((sum, b) => {
    if (b.skuType === 'topup' || b.skuType === 'trial') return sum + (b.totalRemainingUsd ?? 0);
    return sum + (b.dailyRemainingUsd ?? 0);
  }, 0);

  const planBucket = buckets.find(b => b.skuType.startsWith('plan_'));
  const dailyCap = planBucket?.dailyCapUsd ?? 0;
  const dailyRemaining = planBucket?.dailyRemainingUsd ?? 0;
  const dailyUsed = dailyCap - dailyRemaining;
  const dailyPct = dailyCap > 0 ? Math.min(100, (dailyUsed / dailyCap) * 100) : 0;

  if (loading) return <div className="min-h-screen bg-bg flex items-center justify-center text-ink-3">加载中…</div>;

  const initial = (user?.email?.[0] ?? 'U').toUpperCase();

  return (
    <div className="min-h-screen bg-bg pb-12">
      {/* App nav */}
      <nav className="px-5 py-3.5 flex items-center justify-between border-b border-border max-w-[1200px] mx-auto">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-accent rounded-md flex items-center justify-center text-white font-mono text-[10px] font-bold">TB</div>
          <span className="font-bold">TokenBoss</span>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/pricing" className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md border border-border bg-surface">套餐</Link>
          <button onClick={logout} className="w-7 h-7 bg-ink rounded-full text-white text-[11px] font-mono font-bold">{initial}</button>
        </div>
      </nav>

      <main className="max-w-[1200px] mx-auto px-5 pt-5 lg:grid lg:grid-cols-[2fr_1fr] lg:gap-6">
        {/* Balance hero — full width */}
        <section className="lg:col-span-2 bg-gradient-to-br from-accent to-accent-deep text-white rounded-2xl p-6 mb-4 relative overflow-hidden">
          <div className="font-mono text-[10px] tracking-[0.14em] uppercase opacity-80 mb-2">当前余额</div>
          <div className="font-mono text-[54px] lg:text-[84px] font-bold leading-none mb-1">
            <span className="text-[28px] lg:text-[42px] opacity-70 align-top">$</span>{balanceUsd.toFixed(2).split('.')[0]}<span className="opacity-70">.{balanceUsd.toFixed(2).split('.')[1]}</span>
          </div>
          <div className="font-mono text-xs opacity-85 mt-2 mb-4">
            {planBucket
              ? `${planBucket.skuType.replace('plan_', '').toUpperCase()} 套餐 · 还 ${Math.ceil((new Date(planBucket.expiresAt!).getTime() - Date.now()) / 86400e3)} 天`
              : '无活跃套餐'}
          </div>
          <div className="grid grid-cols-2 gap-2 max-w-md">
            <a className="py-2.5 bg-white/15 border border-white/20 rounded-lg text-sm font-semibold text-center backdrop-blur-sm cursor-pointer">充值</a>
            <a className="py-2.5 bg-white/15 border border-white/20 rounded-lg text-sm font-semibold text-center backdrop-blur-sm cursor-pointer">联系客服</a>
          </div>
        </section>

        {/* MAIN COL */}
        <div className="space-y-4">
          {/* Daily cap */}
          {planBucket && dailyCap > 0 && (
            <section className="bg-surface border border-border rounded-xl p-4">
              <div className="flex justify-between items-baseline mb-2.5">
                <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3 font-bold">今日额度</span>
                <span className="font-mono text-[13px] font-semibold text-ink">${dailyUsed.toFixed(2)} <span className="text-ink-3">/ ${dailyCap}</span></span>
              </div>
              <div className="h-2 bg-surface-2 rounded-full overflow-hidden mb-2">
                <div className="h-full bg-gradient-to-r from-accent to-accent-deep rounded-full" style={{ width: `${dailyPct}%` }} />
              </div>
              <div className="flex justify-between font-mono text-[11px] text-ink-3">
                <span>剩 <span className="text-ink-2 font-semibold">${dailyRemaining.toFixed(2)}</span></span>
                <span>明 0:00 重置</span>
              </div>
            </section>
          )}

          {/* Latest call */}
          {usage.records?.[0] && (
            <section className="bg-ink text-white rounded-xl px-4 py-3.5 flex items-center gap-3">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse flex-shrink-0" />
              <div className="font-mono text-[11.5px] text-ink-3 leading-snug flex-1">
                最近 · <span className="text-white font-semibold">{new Date(usage.records[0].createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span> · <span className="text-accent font-semibold">{usage.records[0].model || 'auto'}</span> · −${(usage.records[0].amountUsd ?? 0).toFixed(3)}
              </div>
            </section>
          )}

          {/* Active buckets */}
          <section>
            <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3 font-bold mb-2.5 flex items-center gap-2">
              <span className="w-4 h-px bg-ink-3" />活跃额度池
            </div>
            <div className="space-y-2">
              {buckets.map(b => (
                <div key={b.id} className="bg-surface border border-border rounded-xl p-3.5">
                  <div className="flex justify-between mb-2">
                    <span className="text-sm font-bold">
                      {b.skuType === 'topup' ? '充值余额' : b.skuType === 'trial' ? '试用余额' : `${b.skuType.replace('plan_', '').toUpperCase()} 月度套餐`}
                    </span>
                    <span className={`font-mono text-[9px] font-bold tracking-wider uppercase px-1.5 py-0.5 rounded ${b.skuType === 'topup' ? 'bg-green-soft text-green-ink' : b.skuType === 'trial' ? 'bg-amber-100 text-amber-800' : 'bg-accent-soft text-accent-ink'}`}>
                      {b.skuType === 'topup' ? '不过期' : b.skuType === 'trial' ? '试用' : '套餐'}
                    </span>
                  </div>
                  {b.dailyCapUsd != null && (
                    <div className="font-mono text-xs flex justify-between text-ink-2 py-0.5">
                      <span>每日 cap</span><span className="text-ink font-bold">${b.dailyCapUsd}</span>
                    </div>
                  )}
                  {(b.skuType === 'topup' || b.skuType === 'trial') && (
                    <div className="font-mono text-xs flex justify-between text-ink-2 py-0.5">
                      <span>剩余</span><span className="text-ink font-bold">${(b.totalRemainingUsd ?? 0).toFixed(2)}</span>
                    </div>
                  )}
                  {b.skuType === 'trial' && b.expiresAt && (
                    <div className="font-mono text-xs flex justify-between text-ink-2 py-0.5"><span>到期</span><span className="text-ink font-bold">{new Date(b.expiresAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span></div>
                  )}
                </div>
              ))}
              {buckets.length === 0 && (
                <div className="text-center text-ink-3 text-sm p-6 bg-surface border border-border rounded-xl">暂无活跃额度</div>
              )}
            </div>
          </section>

          {/* Today stats */}
          <section className="grid grid-cols-2 gap-2">
            <div className="bg-surface border border-border rounded-xl p-3.5">
              <div className="font-mono text-[9.5px] uppercase tracking-wider text-ink-3 font-bold mb-1">调用</div>
              <div className="font-mono text-2xl font-bold leading-none">{usage.totals?.calls ?? 0}</div>
              <div className="font-mono text-[11px] text-ink-3 mt-1">次</div>
            </div>
            <div className="bg-surface border border-border rounded-xl p-3.5">
              <div className="font-mono text-[9.5px] uppercase tracking-wider text-ink-3 font-bold mb-1">已用</div>
              <div className="font-mono text-2xl font-bold leading-none text-accent">${(usage.totals?.consumed ?? 0).toFixed(2)}</div>
            </div>
          </section>
        </div>

        {/* SIDE COL */}
        <aside className="space-y-4 mt-4 lg:mt-0">
          {/* 接入中心 */}
          <section className="bg-surface border border-border rounded-xl p-4">
            <div className="flex justify-between items-baseline mb-3.5">
              <span className="text-sm font-bold">接入中心</span>
              <span className="font-mono text-[10px] text-ink-3">v1.0</span>
            </div>
            <div className="bg-surface-2 rounded-lg p-2 flex items-center gap-2 mb-3">
              <div className="w-5 h-5 rounded-md bg-gradient-to-br from-accent to-accent-deep flex items-center justify-center text-white font-mono text-[8.5px] font-bold">OC</div>
              <span className="text-xs font-semibold flex-1">OpenClaw</span>
              <span className="font-mono text-[9.5px] font-bold tracking-wider text-green-ink bg-green-soft px-1.5 py-0.5 rounded">运行中</span>
            </div>
            <a className="block text-center py-2.5 bg-accent-soft border border-dashed border-accent text-accent-ink rounded-lg text-xs font-semibold cursor-pointer">+ 接入新 Agent</a>
          </section>

          {/* Recent usage */}
          <section>
            <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3 font-bold mb-2.5 flex justify-between items-center">
              <span className="flex items-center gap-2"><span className="w-4 h-px bg-ink-3" />最近使用</span>
              <Link to="/dashboard/history" className="text-accent font-semibold text-[10px]">查看全部 →</Link>
            </div>
            <div className="bg-surface border border-border rounded-xl overflow-hidden">
              {usage.records?.slice(0, 4).map((r: any) => (
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
                <div className="text-center text-ink-3 text-sm p-6">暂无使用记录</div>
              )}
            </div>
          </section>

          {/* API Keys inline */}
          <section>
            <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3 font-bold mb-2.5 flex items-center gap-2">
              <span className="w-4 h-px bg-ink-3" />API Key
            </div>
            <APIKeyList />
          </section>
        </aside>
      </main>
    </div>
  );
}
