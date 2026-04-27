import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type UsageDetailResponse } from '../lib/api';
import { AppNav, SectionLabel } from '../components/AppNav';
import { BalancePill } from '../components/BalancePill';
import { ConsumeChart24h, type HourBucket } from '../components/ConsumeChart24h';
import { UsageRow } from '../components/UsageRow';

const card = 'bg-white border-2 border-ink rounded-md shadow-[3px_3px_0_0_#1C1917]';
const selectCls =
  'px-3 py-1.5 bg-white border-2 border-ink rounded text-[12.5px] font-bold text-ink ' +
  'shadow-[2px_2px_0_0_#1C1917] focus:outline-none focus:translate-x-[1px] focus:translate-y-[1px] ' +
  'focus:shadow-[1px_1px_0_0_#1C1917] transition-all cursor-pointer';

export default function UsageHistory() {
  const [data, setData] = useState<UsageDetailResponse>({ records: [], totals: { consumed: 0, calls: 0 }, hourly24h: [] });
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.getUsage({ limit: 50 }).then((r) => setData(r)),
      api.getBuckets().then((r) => {
        const total = (r.buckets || []).reduce((s: number, b) => {
          if (b.skuType === 'topup' || b.skuType === 'trial') return s + (b.totalRemainingUsd ?? 0);
          return s + (b.dailyRemainingUsd ?? 0);
        }, 0);
        setBalance(total);
      }),
    ]).finally(() => setLoading(false));
  }, []);

  const buckets: HourBucket[] = (data.hourly24h || []).map((h) => {
    const hourNum = parseInt(h.hour.split(':')[0], 10);
    return { hour: hourNum, consumeUsd: h.consumed };
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center font-mono text-[#A89A8D]">
        加载中…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg pb-12">
      <AppNav current="dashboard" />

      <main className="max-w-[1340px] mx-auto px-5 sm:px-9 pt-6">
        {/* Breadcrumb */}
        <div className="font-mono text-[11px] tracking-[0.06em] text-[#A89A8D] mb-4">
          <Link to="/dashboard" className="hover:text-ink transition-colors">控制台</Link>
          <span className="mx-2 text-[#D9CEC2]">/</span>
          <span className="text-ink-2">使用历史</span>
        </div>

        {/* Hero row — h1 left, BalancePill right */}
        <div className="flex items-end justify-between mb-9 flex-wrap gap-4">
          <div>
            <div className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-[#A89A8D] mb-2 font-bold">
              USAGE · 使用历史
            </div>
            <h1 className="text-[36px] md:text-[44px] font-bold tracking-tight leading-none mb-3">
              每一笔都对得上账。
            </h1>
            <div className="font-mono text-[13px] text-[#6B5E52]">
              共 <span className="text-ink font-bold">{data.totals?.calls ?? 0}</span> 次调用 ·
              <span className="text-ink font-bold ml-1">${(data.totals?.consumed ?? 0).toFixed(2)}</span> 已用 ·
              <span className="text-ink font-bold ml-1">4 月以来</span>
            </div>
          </div>
          <BalancePill amount={`$${balance.toFixed(2)}`} label="当前余额" />
        </div>

        {/* 24h chart */}
        <section className="mb-7">
          <SectionLabel
            action={
              <span className="font-mono text-[10px] flex gap-3 normal-case tracking-tight text-[#6B5E52]">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 bg-accent border-2 border-ink rounded-sm" />消耗
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 bg-accent-deep border-2 border-ink rounded-sm" />峰值
                </span>
              </span>
            }
          >
            近 24 小时变化
          </SectionLabel>
          <ConsumeChart24h buckets={buckets} variant="desktop" />
        </section>

        {/* Filter bar */}
        <div className={`${card} flex flex-wrap items-center gap-2.5 p-3 mb-5`}>
          <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold mr-1">
            筛选
          </span>
          <select className={selectCls}>
            <option>近 7 天</option>
            <option>近 30 天</option>
            <option>4 月以来</option>
          </select>
          <select className={selectCls}>
            <option>全部模型</option>
          </select>
          <select className={selectCls}>
            <option>全部来源</option>
          </select>
        </div>

        {/* Table */}
        <div className={`${card} overflow-hidden mb-5`}>
          <table className="w-full">
            <thead>
              <tr className="bg-ink text-bg border-b-2 border-ink">
                <Th className="w-32">时间 ↓</Th>
                <Th className="w-24">类型</Th>
                <Th className="w-32">来源</Th>
                <Th>模型</Th>
                <Th className="w-28 text-right">$ 变化</Th>
              </tr>
            </thead>
            <tbody>
              {data.records?.length > 0 ? (
                data.records.map((r) => (
                  <UsageRow
                    key={r.id}
                    variant="desktop"
                    time={new Date(r.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    eventType={r.eventType}
                    model={r.model || undefined}
                    source={r.source || undefined}
                    amount={`${r.amountUsd >= 0 ? '+' : '−'}$${Math.abs(r.amountUsd).toFixed(3)}`}
                  />
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="text-center text-[#A89A8D] text-[13px] p-8 font-mono">
                    暂无使用记录 · 试着用一次 Agent，再回来这里看
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex justify-between items-center flex-wrap gap-3">
          <div className="font-mono text-[12px] text-[#6B5E52]">
            显示第 <span className="text-ink font-bold">1 至 {Math.min(50, data.records?.length ?? 0)}</span> 条，共{' '}
            <span className="text-ink font-bold">{data.totals?.calls ?? 0}</span> 条记录
          </div>
          <div className="flex gap-1.5">
            <PageBtn disabled>首页</PageBtn>
            <PageBtn disabled>上一页</PageBtn>
            <PageBtn active>1</PageBtn>
            <PageBtn>下一页</PageBtn>
            <PageBtn>末页</PageBtn>
          </div>
        </div>
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

function PageBtn({
  children,
  active = false,
  disabled = false,
}: {
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
}) {
  if (active) {
    return (
      <button className="px-3 py-1.5 font-mono text-[12px] font-bold border-2 border-ink rounded bg-ink text-bg shadow-[2px_2px_0_0_#1C1917]/40">
        {children}
      </button>
    );
  }
  return (
    <button
      disabled={disabled}
      className={
        'px-3 py-1.5 font-mono text-[12px] font-bold border-2 border-ink rounded bg-white text-ink ' +
        'shadow-[2px_2px_0_0_#1C1917] ' +
        'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#1C1917] ' +
        'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#1C1917] ' +
        'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-x-0 disabled:hover:translate-y-0 disabled:hover:shadow-[2px_2px_0_0_#1C1917] ' +
        'transition-all'
      }
    >
      {children}
    </button>
  );
}
