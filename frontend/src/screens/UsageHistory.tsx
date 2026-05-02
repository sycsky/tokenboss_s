import { useEffect, useState } from 'react';
import { api, type UsageDetailResponse } from '../lib/api';
import { AppNav, Breadcrumb, SectionLabel } from '../components/AppNav';
import { BalancePill } from '../components/BalancePill';
import { ConsumeChart24h, type HourBucket } from '../components/ConsumeChart24h';
import { UsageRow } from '../components/UsageRow';
import { formatModelName } from '../lib/modelName';
// formatSource is intentionally unused while the 来源 column is hidden —
// UA-based attribution is unreliable today (Hermes/Codex/Claude Code all
// surface as openai-python UA → falls to 'other'). Re-import once X-Source
// header propagation is wired into each agent's install snippet.

const card = 'bg-white border-2 border-ink rounded-md shadow-[3px_3px_0_0_#1C1917]';
const selectCls =
  'px-3 py-1.5 bg-white border-2 border-ink rounded text-[12.5px] font-bold text-ink ' +
  'shadow-[2px_2px_0_0_#1C1917] focus:outline-none focus:translate-x-[1px] focus:translate-y-[1px] ' +
  'focus:shadow-[1px_1px_0_0_#1C1917] transition-all cursor-pointer';

/**
 * Render a record's timestamp as "M月D日 HH:mm".
 *
 * Why not the "今天/昨天/周X" smart format we used before — a heavy user
 * with 100+ calls today fills the first 5+ pages with rows that all
 * say "今天 ...", which makes pagination LOOK broken even when it's
 * working (different entries on each page, but identical labels).
 * Always showing the explicit date makes date variation visible the
 * moment the user pages back, so they can SEE pagination working.
 * The Dashboard "近 5 笔" panel keeps its terser HH:mm format —
 * different surface, different need.
 */
function formatRecordTime(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${d.getMonth() + 1}月${d.getDate()}日 ${time}`;
}

type DateRange = '7d' | '30d';
const PAGE_SIZE = 20;

const DATE_RANGE_OPTIONS: { value: DateRange; label: string }[] = [
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
];

/** Convert a date-range token into the ISO `from` query param.
 *  Backend caps lookback at 30d server-side (see usageHandlers
 *  `defaultStartTs`), so any wider range here would silently clamp. */
function dateRangeToFromIso(r: DateRange): string {
  const days = r === '7d' ? 7 : 30;
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export default function UsageHistory() {
  const [data, setData] = useState<UsageDetailResponse>({ records: [], totals: { consumed: 0, calls: 0 }, hourly24h: [] });
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRangeState] = useState<DateRange>('7d');
  const [currentPage, setCurrentPage] = useState(1);

  /** Filter changes always reset to page 1 — page=N for the new window
   *  is meaningless and almost certainly out of bounds. */
  function changeDateRange(r: DateRange) {
    setDateRangeState(r);
    setCurrentPage(1);
  }

  // Buckets — load once at mount, doesn't depend on the table filters.
  useEffect(() => {
    api.getBuckets().then((r) => {
      const total = (r.buckets || []).reduce((s: number, b) => {
        if (b.skuType === 'topup' || b.skuType === 'trial') return s + (b.totalRemainingUsd ?? 0);
        return s + (b.dailyRemainingUsd ?? 0);
      }, 0);
      setBalance(total);
    }).catch(() => { /* non-blocking — table can render without balance */ });
  }, []);

  // Usage — refetch whenever filter or page changes. Initial load also
  // flips off the loading skeleton; subsequent loads silently swap data.
  useEffect(() => {
    const from = dateRangeToFromIso(dateRange);
    const offset = (currentPage - 1) * PAGE_SIZE;
    api.getUsage({ from, limit: PAGE_SIZE, offset })
      .then((r) => setData(r))
      .finally(() => setLoading(false));
  }, [dateRange, currentPage]);

  const totalCalls = data.totals?.calls ?? 0;
  // `records` is the merged total (consume + reset rows) — what the
  // table actually renders. Falls back to `calls` for old backends
  // that haven't shipped the merged-total field yet.
  const totalRecords = data.totals?.records ?? totalCalls;
  const totalPages = Math.max(1, Math.ceil(totalRecords / PAGE_SIZE));
  const isFirstPage = currentPage <= 1;
  const isLastPage = currentPage >= totalPages;
  const recordsOnPage = data.records?.length ?? 0;
  const startIdx = recordsOnPage === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const endIdx = (currentPage - 1) * PAGE_SIZE + recordsOnPage;
  const currentRangeLabel =
    DATE_RANGE_OPTIONS.find((o) => o.value === dateRange)?.label ?? '';

  // Use hourStartMs (epoch ms) when present so the chart's X axis is in
  // the user's local timezone — the legacy `hour` string is UTC, so a
  // China user at 16:00 was seeing UTC "08:00" for the same hour. The
  // string fallback is kept for the rare case the backend hasn't
  // redeployed yet (during a rolling deploy window).
  const buckets: HourBucket[] = (data.hourly24h || []).map((h) => {
    const hourNum = h.hourStartMs != null
      ? new Date(h.hourStartMs).getHours()
      : parseInt(h.hour.split(':')[0], 10);
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
      <AppNav current="history" />

      <main className="max-w-[1340px] mx-auto px-5 sm:px-9 pt-6">
        <Breadcrumb items={[{ label: '控制台', to: '/console' }, { label: '使用历史' }]} />

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
              <span className="text-ink font-bold ml-1">${(data.totals?.consumed ?? 0).toFixed(4)}</span> 已用 ·
              <span className="text-ink font-bold ml-1">{currentRangeLabel}</span>
            </div>
          </div>
          <BalancePill amount={`$${balance.toFixed(4)}`} label="当前余额" />
        </div>

        {/* 24h chart — peak hour gets a deeper accent, no separate legend dot */}
        <section className="mb-7">
          <SectionLabel
            action={
              <span className="font-mono text-[10px] normal-case tracking-tight text-[#6B5E52] flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 bg-accent border-2 border-ink rounded-sm" />
                消耗 · 峰值高亮
              </span>
            }
          >
            近 24 小时变化
          </SectionLabel>
          <ConsumeChart24h buckets={buckets} variant="desktop" />
        </section>

        {/* Filter bar — only the time range select is wired to the API right
            now. The legacy "全部模型 / 全部来源" selects were pure decoration
            (no onChange handler, no backend support), so they're removed
            until model/source filtering is actually implemented end-to-end. */}
        <div className={`${card} flex flex-wrap items-center gap-2.5 p-3 mb-5`}>
          <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold mr-1">
            筛选
          </span>
          <select
            className={selectCls}
            value={dateRange}
            onChange={(e) => changeDateRange(e.target.value as DateRange)}
          >
            {DATE_RANGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Mobile list — below `lg` the desktop table doesn't fit a phone-
            width screen; show the same data as a vertically-stacked card
            list using UsageRow's mobile variant. `showSourceColumn={false}`
            hides source attribution (unreliable for now); `showSourceOnMobile`
            still gates the keyHint chip so users can identify which API
            key billed each call. */}
        <div className={`${card} overflow-hidden mb-5 lg:hidden`}>
          {data.records?.length > 0 ? (
            data.records.map((r) => (
              <UsageRow
                key={r.id}
                variant="mobile"
                showSourceOnMobile
                showSourceColumn={false}
                time={formatRecordTime(r.createdAt)}
                eventType={r.eventType}
                model={formatModelName(r.model)}
                keyHint={r.keyHint ?? undefined}
                amountUsd={r.amountUsd}
              />
            ))
          ) : (
            <div className="text-center text-[#A89A8D] text-[13px] p-8 font-mono">
              暂无使用记录 · 试着用一次 Agent，再回来这里看
            </div>
          )}
        </div>

        {/* Desktop table */}
        <div className={`${card} overflow-hidden mb-5 hidden lg:block`}>
          <table className="w-full">
            <thead>
              <tr className="bg-ink text-bg border-b-2 border-ink">
                <Th className="w-32">时间 ↓</Th>
                <Th className="w-20">类型</Th>
                <Th className="w-40">API Key</Th>
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
                    showSourceColumn={false}
                    time={formatRecordTime(r.createdAt)}
                    eventType={r.eventType}
                    model={formatModelName(r.model)}
                    keyHint={r.keyHint ?? undefined}
                    amountUsd={r.amountUsd}
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

        {/* Pagination — wired to the same `currentPage` state that drives
            the API offset. Buttons disable at boundaries and the current-
            page chip just shows "X / N". Window total comes from
            data.totals.calls which the backend computes across the FULL
            window (not just the page), so the page count is correct. */}
        <div className="flex justify-between items-center flex-wrap gap-3">
          <div className="font-mono text-[12px] text-[#6B5E52]">
            显示第 <span className="text-ink font-bold">{startIdx} 至 {endIdx}</span> 条，共{' '}
            <span className="text-ink font-bold">{totalRecords}</span> 条记录
          </div>
          <div className="flex gap-1.5">
            <PageBtn disabled={isFirstPage} onClick={() => setCurrentPage(1)}>首页</PageBtn>
            <PageBtn disabled={isFirstPage} onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}>上一页</PageBtn>
            <PageBtn active>{currentPage} / {totalPages}</PageBtn>
            <PageBtn disabled={isLastPage} onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}>下一页</PageBtn>
            <PageBtn disabled={isLastPage} onClick={() => setCurrentPage(totalPages)}>末页</PageBtn>
          </div>
        </div>

        <p className="font-mono text-[11px] text-[#A89A8D] mt-5 leading-relaxed">
          ※ 系统仅保留最近 30 天的使用记录，更早的查询请联系我们。
        </p>
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
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
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
      type="button"
      onClick={onClick}
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
