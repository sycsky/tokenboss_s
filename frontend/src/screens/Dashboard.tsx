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
import { getBucketsCached, peekBuckets } from '../lib/bucketsCache';
import { APIKeyList, type KeyStats } from '../components/APIKeyList';
import { AllKeysModal, CreateKeyModal, DeleteKeyModal, RevealKeyModal } from '../components/KeyModals';
import { UsageRow } from '../components/UsageRow';
import { formatModelName } from '../lib/modelName';
import { formatSource } from '../lib/sourceDisplay';
import { UnverifiedEmailBanner } from '../components/UnverifiedEmailBanner';
import { AppNav, SectionLabel } from '../components/AppNav';
import { TerminalBlock } from '../components/TerminalBlock';
import { ContactSalesModal } from '../components/ContactSalesModal';
import { slockBtn } from '../lib/slockBtn';
import { MonoLogLoader } from '../components/MonoLogLoader';

const card = 'bg-white border-2 border-ink rounded-md shadow-[3px_3px_0_0_#1C1917]';

/**
 * Module-level cache for the Dashboard's usage / keyHintGroups / keys
 * fetches. Persists across route unmounts (Dashboard is a route element
 * — react-router throws away the component instance on every navigation),
 * so a user bouncing between /console and a sub-page sees an instant
 * render on return: stale state paints first, the API calls re-fire in
 * the background and silently upgrade the UI when fresher numbers
 * arrive (stale-while-revalidate).
 *
 * Buckets are NOT held here — they live in `bucketsCache.ts` so
 * UsageHistory and any future page can share the same cached value
 * instead of each firing its own /v1/buckets on mount.
 *
 * Scoped by `userId` so logout/login in the same SPA session (logout uses
 * react-router navigate, not a full page reload) doesn't expose the
 * previous account's usage / keys to a fresh login. The Dashboard guard
 * at the top of the component invalidates the cache whenever the
 * current authenticated userId stops matching the cached one.
 */
interface DashboardCache {
  /** Auth subject this cache snapshot belongs to. Mismatched user → wipe. */
  userId?: string;
  usage?: UsageDetailResponse;
  keyHintGroups?: UsageAggregateGroup[];
  keys?: ProxyKeySummary[];
  /** Wall-clock ms when the last full refresh completed. Used to decide
   *  whether the first paint should hide the hero behind a skeleton
   *  (no cache yet) or render directly with cached values. */
  cachedAt?: number;
}
const dashboardCache: DashboardCache = {};

/** Wipe every field — used when the cache no longer matches the active user. */
function resetDashboardCache(): void {
  dashboardCache.userId = undefined;
  dashboardCache.usage = undefined;
  dashboardCache.keyHintGroups = undefined;
  dashboardCache.keys = undefined;
  dashboardCache.cachedAt = undefined;
}

/**
 * Build a label → KeyStats map from the server's keyHint aggregation.
 *
 * Backend's `keyHint` (usageHandlers.ts:93) is actually the newapi
 * `token_name` — the user-given label like "default" — NOT the raw key
 * tail. Earlier code took `groupKey.slice(-4)` and matched it against
 * `k.key.slice(-4)`, which silently missed every time ("default".slice(-4)
 * = "ault" vs masked-key tail "aCvC"), so every key showed "未使用" no
 * matter how much it was used. We index by the full label string so the
 * lookup actually works.
 */
function shapeKeyStats(groups: UsageAggregateGroup[]): Map<string, KeyStats> {
  const m = new Map<string, KeyStats>();
  // Defensive: if state ever drifts to non-array (malformed response,
  // serialized cache replay, etc.), render empty rather than crash with
  // "groups is not iterable" — TS guarantees the type but runtime can
  // still slip past via `as unknown` boundaries on the network seam.
  if (!Array.isArray(groups)) return m;
  for (const g of groups) {
    if (!g.groupKey) continue;
    m.set(g.groupKey, {
      callCount: g.callCount,
      totalSpent: g.totalConsumedUsd,
      lastUsedAt: g.lastUsedAt,
    });
  }
  return m;
}

export default function Dashboard() {
  const { user } = useAuth();

  // Cross-account safety: if the cache holds another user's snapshot
  // (logout/login in the same SPA session — react-router navigate doesn't
  // tear down the JS module), wipe it before we read any defaults below.
  // Mutating module state during render is fine here — it's idempotent
  // and React's tree isn't involved. Once `user` resolves the equality
  // either holds (no-op) or fails (one wipe, then equal forever).
  if (dashboardCache.userId !== user?.userId) {
    resetDashboardCache();
  }

  const [buckets, setBuckets] = useState<BucketRecord[]>(
    () => peekBuckets(user?.userId)?.buckets ?? [],
  );
  const [usage, setUsage] = useState<UsageDetailResponse>(
    dashboardCache.usage ?? { records: [], totals: { consumed: 0, calls: 0 }, hourly24h: [] },
  );
  const [keyHintGroups, setKeyHintGroups] = useState<UsageAggregateGroup[]>(
    dashboardCache.keyHintGroups ?? [],
  );
  const [keys, setKeys] = useState<ProxyKeySummary[]>(dashboardCache.keys ?? []);
  const [keysError, setKeysError] = useState<string | null>(null);

  // True only on the *very first* visit in this browser session — i.e.
  // when the cache has nothing at all. After the first refresh completes
  // we never block the UI again; we just silently revalidate in the
  // background. This is what makes "回到 console" feel instant.
  const [hydrating, setHydrating] = useState(!dashboardCache.cachedAt);

  async function reloadKeys() {
    try {
      const r = await api.listKeys();
      setKeys(r.keys);
      dashboardCache.keys = r.keys;
      setKeysError(null);
    } catch (e) {
      setKeysError((e as Error).message);
    }
  }

  useEffect(() => {
    // Each fetch carries its own .catch so one failing call (e.g. backend
    // returning 502 because newapi is down) doesn't cascade — the page
    // renders the data it COULD load and falls back to empty for the
    // rest. Without this, Promise.all rejects on the first failure and
    // .finally still runs, but .then setters from the other resolved
    // calls may race with the unhandled rejection in surprising ways.
    Promise.all([
      getBucketsCached(user?.userId)
        .then((r) => setBuckets(Array.isArray(r?.buckets) ? r.buckets : []))
        .catch(() => setBuckets([])),
      // Recent-call list + balance hero totals — keep small.
      // limit 5 — five rows ≈ the height of the right-side 接入 panel,
      // so the two columns end at roughly the same baseline without
      // tricks like flex-1 stretching or scrolling overflow.
      api.getUsage({ limit: 5 })
        .then((r) => {
          setUsage(r);
          dashboardCache.usage = r;
        })
        .catch(() => {
          // Keep whatever the cache already painted; don't overwrite
          // good stale data with an empty error state.
        }),
      // Per-key stats — server-side GROUP BY keyHint.
      api.getUsageAggregate('keyHint')
        .then((r) => {
          const groups = Array.isArray(r?.groups) ? r.groups : [];
          setKeyHintGroups(groups);
          dashboardCache.keyHintGroups = groups;
        })
        .catch(() => {
          setKeyHintGroups([]);
          dashboardCache.keyHintGroups = [];
        }),
      reloadKeys(),
    ]).finally(() => {
      dashboardCache.cachedAt = Date.now();
      // Stamp the cache with the user it belongs to so the guard above
      // can detect cross-account drift on the next mount.
      dashboardCache.userId = user?.userId;
      setHydrating(false);
    });
  }, [user?.userId]);

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
  // Hero progress bar visualizes "how much is LEFT" — full bar at the
  // start of the period, shrinks as the user spends. Reads more naturally
  // than a fill-from-empty bar next to a big "今日剩 $X" headline.
  const periodRemainingPct = periodTotal > 0
    ? Math.max(0, Math.min(100, (periodRemaining / periodTotal) * 100))
    : 0;

  // Threshold-colored fill: white = comfortable, yellow = mind it,
  // red-soft = top up soon. Pure white on accent-orange has weak
  // contrast at low remaining %, so we shift hue when the user is
  // running low — a "fuel gauge" cue in addition to the bar length.
  const periodFillColor =
    periodRemainingPct >= 50 ? 'bg-white'
    : periodRemainingPct >= 20 ? 'bg-yellow-stamp'
    : 'bg-red-soft';

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
  // The install spell is conceptually two lines: the setup command and
  // the API key env var. The platform never persists plaintext, so line 2
  // is ALWAYS a quoted placeholder — users paste their saved key in
  // place of <your-api-key> before sending the snippet to their Agent.
  // Angle brackets make it obvious it's a placeholder, not a real value.
  const spellExtra = `TOKENBOSS_API_KEY="<your-api-key>"`;

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
  const [allKeysOpen, setAllKeysOpen] = useState(false);

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

  // No global loading gate — render the layout immediately and let
  // individual sections handle their own empty / skeleton state. The hero
  // shows a pulsing skeleton during first hydration (see below) so we
  // don't flash "Agent 余额 $0.0000" before real bucket data lands.

  return (
    <div className="min-h-screen bg-bg pb-12">
      <AppNav current="console" />

      {user && !user.emailVerified && user.email && (
        <div className="max-w-[1200px] mx-auto px-5 sm:px-9 pt-4">
          <UnverifiedEmailBanner email={user.email} />
        </div>
      )}

      <main className="max-w-[1200px] mx-auto px-5 sm:px-9 pt-5">
        {hydrating ? (
          <MonoLogLoader endpoints={['subscription state', 'usage 30d', 'api keys']} />
        ) : (
        <div className="lg:grid lg:grid-cols-[2fr_1fr] lg:gap-6">
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
        <section className="lg:col-span-2 bg-accent text-white border-2 border-ink rounded-lg shadow-[4px_4px_0_0_#1C1917] px-5 py-4 sm:px-7 sm:py-5 mb-5 overflow-hidden">
          {/* Single-column hero with sectioned content:
                · Subscription section — headline + tier + days + 续费,
                  followed by the progress bar (when there's activity).
                · (Optional) wallet section — separated by a dashed rule,
                  shows 钱包余额 + 充值, with lime-stamp accent on labels
                  to mark "this is a different bucket of money."
              No grid, no equal-height stretch — content density is
              continuous top-to-bottom, no awkward dead zones. Mobile
              wraps each row naturally. */}

          {/* ===== SUBSCRIPTION SECTION ===== */}
          {subBucket ? (
            <>
              {/* Headline row: 今日剩 + tier chip + days + 续费 button */}
              <div className="flex flex-col items-start gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6 sm:gap-y-3">
                <div className="flex items-baseline gap-3 flex-wrap">
                  <span className="font-mono text-[10.5px] tracking-[0.18em] uppercase font-bold opacity-85">
                    今日剩
                  </span>
                  <span className="font-mono text-[36px] sm:text-[44px] font-bold leading-none">
                    <span className="text-[18px] sm:text-[22px] opacity-70 align-top mr-0.5">$</span>
                    {periodRemaining.toFixed(4)}
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

                {/* Subscription-side action — pushed to the right edge
                    on desktop with sm:ml-auto so the headline row spans
                    the hero width naturally. 充值额度 link only when
                    there's no wallet section below (first-topup entry). */}
                {isTrial ? (
                  <Link
                    to="/pricing"
                    className={
                      slockBtn('secondary') +
                      ' w-full text-center sm:w-auto sm:ml-auto'
                    }
                  >
                    选个套餐 →
                  </Link>
                ) : (
                  <div className="flex items-center gap-3 sm:gap-4 w-full sm:w-auto sm:ml-auto">
                    {!topupBucket && (
                      <Link
                        to="/billing/topup"
                        className="font-mono text-[12px] py-2 px-1 -my-2 text-white/80 hover:text-white underline underline-offset-4 decoration-white/30 hover:decoration-white transition-colors flex-shrink-0"
                      >
                        充值额度
                      </Link>
                    )}
                    <button
                      type="button"
                      onClick={() => setContactReason('renew')}
                      className={slockBtn('secondary') + ' flex-1 sm:flex-none'}
                    >
                      续费 →
                    </button>
                  </div>
                )}
              </div>

              {/* Progress bar — sits naturally below the headline,
                  no longer pushed to a far bottom by mt-auto. */}
              {periodTotal > 0 && !noActivity && (
                <div className="flex items-center gap-3 mt-3 sm:mt-3.5">
                  <div className="flex-1 h-2.5 bg-black/30 border border-white/30 rounded overflow-hidden">
                    <div
                      className={`h-full ${periodFillColor} transition-all duration-300`}
                      style={{ width: `${periodRemainingPct}%` }}
                    />
                  </div>
                  <span className="font-mono text-[11.5px] font-bold text-white/90 tabular-nums whitespace-nowrap">
                    剩 {Math.round(periodRemainingPct)}%
                  </span>
                </div>
              )}
            </>
          ) : (
            // No active subscription branch. When wallet credits exist
            // we still show "未开通套餐" + 开通 CTA at the top, then a
            // wallet section follows below the divider. When neither
            // exists, this is just the legacy "Agent 余额 $0" hero.
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6 sm:gap-y-3">
              <div className="flex items-baseline gap-3 flex-wrap">
                <span className="font-mono text-[10.5px] tracking-[0.18em] uppercase font-bold opacity-85">
                  {topupBucket ? '未开通套餐' : 'Agent 余额'}
                </span>
                {!topupBucket && (
                  <span className="font-mono text-[36px] sm:text-[44px] font-bold leading-none">
                    <span className="text-[18px] sm:text-[22px] opacity-70 align-top mr-0.5">$</span>
                    {balanceUsd.toFixed(4)}
                  </span>
                )}
              </div>
              <div className="flex flex-col-reverse items-stretch sm:flex-row sm:items-center gap-2 sm:gap-4 w-full sm:w-auto sm:ml-auto">
                {!topupBucket && (
                  <Link
                    to="/billing/topup"
                    className="font-mono text-[12px] py-2 px-1 -my-2 text-white/80 hover:text-white underline underline-offset-4 decoration-white/30 hover:decoration-white transition-colors flex-shrink-0 text-center sm:text-left"
                  >
                    充值额度
                  </Link>
                )}
                <Link
                  to="/pricing"
                  className={slockBtn('secondary') + ' w-full text-center sm:w-auto'}
                >
                  开通套餐 →
                </Link>
              </div>
            </div>
          )}

          {/* ===== WALLET BAR — full-bleed dark band at the hero bottom.
              Negative margins on left/right/bottom make the panel span
              the full hero width (eating the hero's own padding) and
              flush against the rounded bottom corners. Hero has
              overflow-hidden so the bar gets clipped to the rounded
              shape automatically — no need to mirror border-radius
              here. The black band gives the wallet its own visual
              territory: subscription on top (orange), wallet on
              bottom (ink), separated by their inherent color contrast
              instead of an explicit divider line. */}
          {topupBucket && (
            <div className="mt-4 sm:mt-5 -mx-5 sm:-mx-7 -mb-4 sm:-mb-5 bg-ink border-t-2 border-ink px-5 py-3 sm:px-7 sm:py-3.5 flex flex-col items-start gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6 sm:gap-y-3">
              <div className="flex items-baseline gap-3 flex-wrap">
                <span className="font-mono text-[10.5px] tracking-[0.18em] uppercase font-bold text-lime-stamp">
                  钱包余额
                </span>
                <span className="font-mono text-[26px] sm:text-[30px] font-bold leading-none text-white">
                  <span className="text-[13px] sm:text-[15px] opacity-70 align-top mr-0.5">$</span>
                  {(topupBucket.totalRemainingUsd ?? 0).toFixed(2)}
                </span>
              </div>
              <Link
                to="/billing/topup"
                className={
                  'inline-flex items-center justify-center gap-1.5 ' +
                  'border-2 border-lime-stamp bg-lime-stamp text-lime-stamp-ink ' +
                  'rounded-md font-bold tracking-tight whitespace-nowrap ' +
                  'px-5 py-2.5 text-[14px] ' +
                  'shadow-[2px_2px_0_0_#365314] ' +
                  'hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#365314] ' +
                  'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[0_0_0_0_#365314] ' +
                  'transition-all w-full sm:w-auto sm:ml-auto text-center'
                }
              >
                充值 →
              </Link>
            </div>
          )}
        </section>

        {/* MAIN COL */}
        <div className="space-y-5">
          {/* (Total-balance summary card moved into the hero's wallet zone
              — see RIGHT ZONE in the section above. Single source of truth
              for "user has wallet credits beyond the subscription".) */}

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
            <>
              <section>
                <div className="grid grid-cols-2 gap-2.5">
                  <div className={`${card} p-4`}>
                    <div className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold mb-1.5">调用</div>
                    <div className="font-mono text-[28px] font-bold leading-none text-ink">{usage.totals?.calls ?? 0}</div>
                    <div className="font-mono text-[11px] text-[#A89A8D] mt-1">次 · 近 30 天</div>
                  </div>
                  <div className={`${card} p-4`}>
                    <div className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-[#A89A8D] font-bold mb-1.5">已用</div>
                    <div className="font-mono text-[28px] font-bold leading-none text-accent">${(usage.totals?.consumed ?? 0).toFixed(4)}</div>
                    <div className="font-mono text-[11px] text-[#A89A8D] mt-1">近 30 天</div>
                  </div>
                </div>
              </section>

              {/* Recent usage — 5 rows is calibrated to roughly match
                  the right-side 接入 panel's height on desktop, so the
                  two columns end at the same baseline without ad-hoc
                  flex/scroll mechanics. */}
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
                  {usage.records?.slice(0, 5).map((r) => (
                    <UsageRow
                      key={r.id}
                      variant="mobile"
                      time={new Date(r.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                      eventType={r.eventType}
                      model={formatModelName(r.model)}
                      // chat-completions line: r.source non-null (worst case 'other')
                      // → formatSource displays the brand name. Other endpoints
                      // (embeddings/audio etc.) still return source=null →
                      // right-hand keyHint fallback (legacy path, commit 1be9be2).
                      source={r.source ? formatSource(r.source) : (r.keyHint ?? undefined)}
                      amountUsd={r.amountUsd ?? 0}
                    />
                  ))}
                </div>
              </section>
            </>
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
            {/* The install spell is always a placeholder snippet — the
                platform doesn't persist plaintext anywhere, so the user
                fills <your-api-key> in themselves from the value they
                saved at create time. The 「+ 创建 API Key」 button below
                covers "I haven't saved one / I lost mine" cases. */}
            <Link
              to="/install/manual"
              className="block mt-2.5 font-mono text-[11px] text-[#A89A8D] hover:text-ink transition-colors"
            >
              手动配置文档 →
            </Link>

            {/* divider */}
            <div className="my-4 border-t-2 border-ink/10" />

            {/* API KEY sub-section. The right-side BaseUrlChip surfaces the
                OpenAI-compatible endpoint so a user copying their key on the
                same screen also sees the URL they need to paste it into —
                avoids a trip to /install/manual just to find the base URL. */}
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="font-mono text-[9.5px] font-bold tracking-[0.16em] uppercase text-[#A89A8D]">
                API KEY
              </span>
              <BaseUrlChip />
            </div>
            <APIKeyList
              keys={keys}
              loadError={keysError}
              keyStats={keyStats}
              onCreateClick={() => setCreateOpen(true)}
              onDeleteClick={setDeleteTarget}
              onShowAllClick={() => setAllKeysOpen(true)}
            />
          </section>

        </aside>
        </div>
        )}
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
      <AllKeysModal
        open={allKeysOpen}
        onClose={() => setAllKeysOpen(false)}
        keys={keys}
        keyStats={keyStats}
        onDeleteClick={setDeleteTarget}
      />
      {/* DeleteKeyModal renders LAST so its backdrop sits on top of any
          other modal that might be open behind it (e.g. AllKeysModal,
          when the user clicked a row's delete button from inside it).
          Without this order, the confirmation appears trapped behind the
          parent modal and looks like nothing happened on click. */}
      <DeleteKeyModal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        target={deleteTarget}
        onDeleted={handleDeleted}
      />
    </div>
  );
}

/**
 * Compact one-click copy of the OpenAI-compatible base URL. Lives next to
 * the API KEY label so a user who has just copied their key also has the
 * other half of the config (base URL) visible and grabbable in one move.
 *
 * accent-color flash on copy mirrors APIKeyList's copy button so the
 * "did it work?" feedback is consistent across the whole screen.
 */
function BaseUrlChip() {
  const url = 'https://api.tokenboss.co/v1';
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — silently no-op; the URL is visible inline */
    }
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label="复制 base URL"
      className={
        'flex-shrink-0 inline-flex items-center gap-1.5 px-2 py-0.5 rounded border-2 ' +
        'font-mono text-[10px] tracking-tight transition-colors ' +
        (copied
          ? 'bg-accent border-accent text-white'
          : 'bg-white border-ink text-ink hover:bg-bg')
      }
    >
      <span className="font-mono">{copied ? '✓ 已复制' : 'api.tokenboss.co/v1'}</span>
      {!copied && (
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <rect x="3.5" y="3.5" width="6" height="7" rx="1" stroke="currentColor" strokeWidth="1.5" />
          <path d="M2 7.5V2.5C2 2.22 2.22 2 2.5 2H7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}

