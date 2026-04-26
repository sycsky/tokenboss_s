import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { BalancePill } from '../components/BalancePill';
import { ConsumeChart24h, HourBucket } from '../components/ConsumeChart24h';
import { UsageRow } from '../components/UsageRow';

export default function UsageHistory() {
  const { user } = useAuth();
  const [data, setData] = useState<any>({ records: [], totals: { consumed: 0, calls: 0 }, hourly24h: [] });
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.getUsage({ limit: 50 }).then((r: any) => setData(r)),
      api.getBuckets().then((r: any) => {
        const total = (r.buckets || []).reduce((s: number, b: any) => {
          if (b.skuType === 'topup' || b.skuType === 'trial') return s + (b.totalRemainingUsd ?? 0);
          return s + (b.dailyRemainingUsd ?? 0);
        }, 0);
        setBalance(total);
      }),
    ]).finally(() => setLoading(false));
  }, []);

  const buckets: HourBucket[] = (data.hourly24h || []).map((h: any) => {
    const hourNum = parseInt(h.hour.split(':')[0], 10);
    return { hour: hourNum, consumeUsd: h.consumed };
  });

  if (loading) return <div className="min-h-screen bg-bg flex items-center justify-center text-ink-3">加载中…</div>;

  return (
    <div className="min-h-screen bg-bg pb-12">
      <nav className="px-9 py-4 flex items-center justify-between border-b border-border max-w-[1340px] mx-auto">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-accent rounded-md flex items-center justify-center text-white font-mono text-[10px] font-bold">TB</div>
          <span className="font-bold">TokenBoss</span>
        </div>
        <div className="flex gap-6 text-[13px] text-ink-2">
          <Link to="/dashboard" className="text-ink font-semibold">控制台</Link>
          <Link to="/pricing">套餐</Link>
        </div>
        <div className="text-[12.5px] text-ink-2">{user?.email}</div>
      </nav>

      <main className="max-w-[1340px] mx-auto px-9 py-9">
        {/* Breadcrumb */}
        <div className="font-mono text-[11px] text-ink-3 mb-4">
          <Link to="/dashboard" className="hover:text-ink">控制台</Link>
          <span className="mx-2 text-ink-4">/</span>
          <span>使用历史</span>
        </div>

        {/* Hero row */}
        <div className="flex items-end justify-between mb-8 flex-wrap gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-2">使用历史</h1>
            <div className="font-mono text-[13px] text-ink-2">
              共 <span className="text-ink font-bold">{data.totals?.calls ?? 0}</span> 次调用 ·
              <span className="text-ink font-bold ml-1">${(data.totals?.consumed ?? 0).toFixed(2)}</span> 已用 ·
              <span className="text-ink font-bold ml-1">4 月以来</span>
            </div>
          </div>
          <BalancePill amount={`$${balance.toFixed(2)}`} label="当前余额" />
        </div>

        {/* 24h chart */}
        <div className="mb-5">
          <div className="flex justify-between mb-3">
            <span className="text-sm font-bold">近 24 小时变化</span>
            <span className="font-mono text-[11px] text-ink-2 flex gap-3">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 bg-accent rounded-full" />消耗</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 bg-green-ink rounded-full" />恢复</span>
            </span>
          </div>
          <ConsumeChart24h buckets={buckets} variant="desktop" />
        </div>

        {/* Filter bar (placeholder) */}
        <div className="flex gap-2.5 items-center mb-5 p-3 bg-surface border border-border rounded-xl flex-wrap">
          <select className="px-3 py-1.5 bg-surface-2 border border-border rounded-md text-sm">
            <option>近 7 天</option>
            <option>近 30 天</option>
            <option>4 月以来</option>
          </select>
          <select className="px-3 py-1.5 bg-surface-2 border border-border rounded-md text-sm">
            <option>全部模型</option>
          </select>
          <select className="px-3 py-1.5 bg-surface-2 border border-border rounded-md text-sm">
            <option>全部来源</option>
          </select>
        </div>

        {/* Table */}
        <div className="bg-surface border border-border rounded-xl overflow-hidden mb-5">
          <table className="w-full">
            <thead>
              <tr className="bg-surface-2 border-b border-border">
                <th className="text-left font-mono text-[10.5px] font-bold tracking-wider uppercase text-ink-3 px-4 py-3 w-32">时间 ↓</th>
                <th className="text-left font-mono text-[10.5px] font-bold tracking-wider uppercase text-ink-3 px-4 py-3 w-24">类型</th>
                <th className="text-left font-mono text-[10.5px] font-bold tracking-wider uppercase text-ink-3 px-4 py-3 w-32">来源</th>
                <th className="text-left font-mono text-[10.5px] font-bold tracking-wider uppercase text-ink-3 px-4 py-3">模型</th>
                <th className="text-right font-mono text-[10.5px] font-bold tracking-wider uppercase text-ink-3 px-4 py-3 w-28">$ 变化</th>
              </tr>
            </thead>
            <tbody>
              {data.records?.length > 0 ? data.records.map((r: any) => (
                <UsageRow key={r.id}
                  variant="desktop"
                  time={new Date(r.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  eventType={r.eventType}
                  model={r.model || undefined}
                  source={r.source || undefined}
                  amount={`${r.amountUsd >= 0 ? '+' : '−'}$${Math.abs(r.amountUsd).toFixed(3)}`}
                />
              )) : (
                <tr><td colSpan={5} className="text-center text-ink-3 text-sm p-6">暂无使用记录</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex justify-between items-center">
          <div className="font-mono text-[12px] text-ink-3">
            显示第 <span className="text-ink font-semibold">1 至 {Math.min(50, data.records?.length ?? 0)}</span> 条
            ，共 <span className="text-ink font-semibold">{data.totals?.calls ?? 0}</span> 条记录
          </div>
          <div className="flex gap-1.5">
            <button className="px-3 py-1.5 font-mono text-xs border border-border rounded-md bg-surface text-ink-2" disabled>首页</button>
            <button className="px-3 py-1.5 font-mono text-xs border border-border rounded-md bg-surface text-ink-2" disabled>上一页</button>
            <button className="px-3 py-1.5 font-mono text-xs border border-ink rounded-md bg-ink text-bg font-semibold">1</button>
            <button className="px-3 py-1.5 font-mono text-xs border border-border rounded-md bg-surface text-ink-2">下一页</button>
            <button className="px-3 py-1.5 font-mono text-xs border border-border rounded-md bg-surface text-ink-2">末页</button>
          </div>
        </div>
      </main>
    </div>
  );
}
