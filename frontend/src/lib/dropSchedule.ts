import { useEffect, useState } from 'react';

/**
 * Daily-drop schedule for tiers like Ultra that release a fixed slot count
 * at a fixed wall-clock time. Single source of truth so the /pricing card
 * countdown and the /billing/pay?plan=ultra detail page never drift.
 *
 * Wall clock is **Asia/Shanghai (UTC+8, no DST)** — never use the user's
 * local timezone. A buyer in NYC and a buyer in Beijing must see the same
 * "minutes left" so neither has an unfair head start.
 */

/** Compute the next occurrence of HH:MM CST as a UTC ms epoch. */
export function nextDailyAtUtcMs(hourCST: number, minuteCST = 0): number {
  const now = new Date();
  // CST is UTC+8 → CST hour H equals UTC hour (H-8) mod 24.
  const targetUtcHour = (hourCST - 8 + 24) % 24;
  const target = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      targetUtcHour,
      minuteCST,
      0,
    ),
  );
  if (target.getTime() <= now.getTime()) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  return target.getTime();
}

/** Live `HH:MM:SS` string ticking down to a UTC target. Returns "00:00:00"
 *  once the target is past — caller decides what to render in that state.
 *  Use this for one-shot countdowns; for recurring daily drops that should
 *  auto-roll to tomorrow when today's passes, use `useDailyCountdown`. */
export function useCountdownTo(targetMs: number): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const diff = Math.max(0, targetMs - now);
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** Phase of a daily drop event:
 *   - `before`        — today's drop hasn't started; countdown ticks down to it
 *   - `transitioning` — drop just opened; brief 2-5s window where Super is
 *     "buying" (UI shows "抢购中…" instead of countdown digits)
 *   - `passed`        — transition window over; countdown ticks down to
 *     tomorrow's drop. "已被抢完" copy applies.
 *
 * The transition window exists to make the daily flip feel real instead
 * of scripted — without it, the countdown jumps 00:00:01 → 23:59:59 in
 * one tick, which looks fake. */
export type DropPhase = 'before' | 'transitioning' | 'passed';

/** Daily transition window length in seconds. Picked deterministically by
 *  CST calendar date so all users see the same flip moment on a given
 *  day, but the duration varies day-to-day (so it doesn't feel robotic).
 *  Capped at 5s so users never feel the page is "stuck". */
function getDailyTransitionDelayMs(nowMs: number): number {
  // Convert to CST to get the calendar date this drop belongs to. Using
  // UTC date here would shift the seed at UTC midnight (= 08:00 CST),
  // which is mid-day from the drop's perspective and would change the
  // "today" seed mid-cycle.
  const cstOffsetMs = 8 * 60 * 60 * 1000;
  const cstDate = new Date(nowMs + cstOffsetMs);
  const seed =
    cstDate.getUTCFullYear() * 10000 +
    (cstDate.getUTCMonth() + 1) * 100 +
    cstDate.getUTCDate();
  // Knuth multiplicative hash → modulo to {2,3,4,5}.
  const hashed = (seed * 2654435761) >>> 0;
  return (2 + (hashed % 4)) * 1000;
}

/**
 * Live phase + countdown for a recurring daily drop in CST. Auto-rolls
 * to tomorrow's slot when today's transition window ends. All state is
 * derived from `now` each render — no setTarget machinery — so the hook
 * can't desync between phase and countdown.
 *
 * Returns:
 *   - countdown: "HH:MM:SS" — time to today's drop ('before') or
 *     tomorrow's drop ('passed'); shows "00:00:00" while 'transitioning'.
 *   - phase: see DropPhase docs above.
 */
export function useDailyCountdown(
  hourCST: number,
  minuteCST = 0,
): { countdown: string; phase: DropPhase } {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const cstOffsetMs = 8 * 60 * 60 * 1000;
  const cstNowOfDayMs = (now + cstOffsetMs) % 86_400_000;
  const cstDropOfDayMs = (hourCST * 3600 + minuteCST * 60) * 1000;
  const transitionDelayMs = getDailyTransitionDelayMs(now);
  const cstTransitionEndOfDayMs = cstDropOfDayMs + transitionDelayMs;

  let phase: DropPhase;
  let target: number;

  if (cstNowOfDayMs < cstDropOfDayMs) {
    phase = 'before';
    target = nextDailyAtUtcMs(hourCST, minuteCST); // today's drop
  } else if (cstNowOfDayMs < cstTransitionEndOfDayMs) {
    phase = 'transitioning';
    target = now; // diff = 0; UI replaces digits with "抢购中…"
  } else {
    phase = 'passed';
    target = nextDailyAtUtcMs(hourCST, minuteCST); // tomorrow's drop
  }

  const diff = Math.max(0, target - now);
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');

  return {
    countdown: `${pad(h)}:${pad(m)}:${pad(s)}`,
    phase,
  };
}

/** Ultra-specific schedule constants — kept here so copy ("8 席", "10:00",
 *  "9:55") is impossible to drift between card / detail page. */
export const ULTRA_DROP = {
  /** Public-facing announced opening time. */
  hourCST: 10,
  /** Super-tier preempt window — 5 min before public opening. The "real"
   *  daily transition moment, used by countdown + state-flipping copy. */
  preemptHourCST: 9,
  preemptMinuteCST: 55,
  slotsPerDay: 8,
} as const;
