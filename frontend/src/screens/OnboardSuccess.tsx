import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { OnboardShell } from '../components/OnboardShell';
import { slockBtn } from '../lib/slockBtn';

const COUNTDOWN_SECONDS = 10;
const TRIAL_DURATION_MS = 24 * 60 * 60 * 1000;

const STEPS = [
  '看 Agent 实时调用',
  '加更多 Agent · 共用同一份额度',
  '喜欢就升级月度套餐',
];

/**
 * Step 03 — confirmation interlude. Order of reveal:
 *   1. h1 + sub: tell the user what's connected — Agent has wired up.
 *   2. Checklist of "what's next" inside a single white card with the
 *      ✓ marks stamping in 200 ms apart.
 *   3. Surprise pill: "$10 已发到你账上" + live 24h countdown. Treats
 *      the trial credit as a gift reveal, not the lead message; the
 *      ticking clock nudges them to actually use it.
 *
 * The auto-advance countdown (page-level) runs the full window — no
 * early-jump shortcut.
 */
export default function OnboardSuccess() {
  const nav = useNavigate();
  const [secs, setSecs] = useState(COUNTDOWN_SECONDS);
  const [enterStep, setEnterStep] = useState(0);

  // Trial expiry — anchored on mount, ticks every second.
  const [trialExpiresAt] = useState(() => Date.now() + TRIAL_DURATION_MS);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Reveal cadence — three beats so the user can register each one:
  //   1. checkmarks tap in 1-2-3 at a steady ~300 ms cadence
  //   2. brief pause, then the trial pill slams down
  //   3. another small pause, then the confetti bursts
  useEffect(() => {
    const timers = [
      setTimeout(() => setEnterStep(1), 250),   // ✓ 1
      setTimeout(() => setEnterStep(2), 550),   // ✓ 2
      setTimeout(() => setEnterStep(3), 850),   // ✓ 3
      setTimeout(() => setEnterStep(4), 1550),  // pill ($10) — 700ms pause
      setTimeout(() => setEnterStep(5), 2050),  // confetti — 500ms after pill
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    if (secs <= 0) {
      nav('/console');
      return;
    }
    const t = setTimeout(() => setSecs((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secs, nav]);

  const remaining = Math.max(0, Math.floor((trialExpiresAt - now) / 1000));
  const hh = String(Math.floor(remaining / 3600)).padStart(2, '0');
  const mm = String(Math.floor((remaining % 3600) / 60)).padStart(2, '0');
  const ss = String(remaining % 60).padStart(2, '0');
  const trialClock = `${hh}:${mm}:${ss}`;

  return (
    <OnboardShell
      step="03"
      cnLabel="已激活"
      enLabel="You're in"
      title="搞定。"
      subtitle="你的 Agent 已经接好。"
    >
      <div className="font-mono text-[10.5px] tracking-[0.16em] uppercase text-[#A89A8D] font-bold mb-3">
        接下去你可以
      </div>

      <div className="bg-white border-2 border-ink rounded-md shadow-[3px_3px_0_0_#1C1917] mb-5 overflow-hidden">
        {STEPS.map((text, i) => {
          const shown = i < enterStep;
          const isLast = i === STEPS.length - 1;
          return (
            <div
              key={i}
              className={
                'flex items-center gap-3 px-4 py-3.5 ' +
                (isLast ? '' : 'border-b-2 border-ink/10')
              }
              style={{
                opacity: shown ? 1 : 0,
                transform: shown ? 'translateY(0)' : 'translateY(-4px)',
                transition:
                  'opacity 0.24s ease-out, transform 0.32s cubic-bezier(0.34, 1.56, 0.64, 1)',
              }}
            >
              <span
                aria-hidden="true"
                className="font-mono text-[16px] font-extrabold flex-shrink-0 leading-none text-[#16A34A]"
                style={{
                  display: 'inline-block',
                  transform: shown ? 'scale(1)' : 'scale(0.3)',
                  opacity: shown ? 1 : 0,
                  transition:
                    'transform 0.36s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s ease-out',
                }}
              >
                ✓
              </span>
              <span className="text-[13.5px] font-semibold text-ink flex-1 leading-snug">
                {text}
              </span>
            </div>
          );
        })}
      </div>

      <div className="relative mb-9">
        {enterStep >= 5 && <ConfettiBurst />}
        <div
          className="bg-lime-stamp text-lime-stamp-ink border-2 border-ink rounded-md shadow-[3px_3px_0_0_#1C1917] px-4 py-3 flex items-center justify-between gap-3 relative"
          style={{
            opacity: enterStep >= 4 ? 1 : 0,
            transform:
              enterStep >= 4
                ? 'translateY(0) scale(1) rotate(0)'
                : 'translateY(-10px) scale(0.6) rotate(-4deg)',
            transition:
              'opacity 0.26s ease-out, transform 0.5s cubic-bezier(0.34, 1.7, 0.45, 1)',
          }}
        >
          <span className="flex items-center gap-2 text-[13.5px] font-bold tracking-tight">
            <span aria-hidden="true" className="text-[14px] leading-none">✨</span>
            <span>
              <span className="text-[16px]">$10</span> 已发到你账上
            </span>
          </span>
          <span className="font-mono text-[13px] font-bold tabular-nums leading-none flex items-baseline gap-1">
            <span className="text-[10px] tracking-[0.14em] uppercase opacity-70">还有</span>
            {trialClock}
          </span>
        </div>
      </div>

      <Link
        to="/console"
        className={
          slockBtn('primary') +
          ' w-full text-center inline-flex items-center justify-center gap-2.5'
        }
      >
        <span>看控制台 →</span>
        <span className="inline-flex items-center gap-1.5 font-mono text-[12px] opacity-90 tabular-nums">
          <span
            aria-hidden="true"
            className="w-1.5 h-1.5 rounded-full bg-cyan-stamp animate-pulse"
          />
          {secs}s
        </span>
      </Link>
    </OnboardShell>
  );
}

/**
 * Slock-pixel "stamp" confetti — hard-edged 8×8 squares with 2 px ink
 * borders, in the status palette (cyan / yellow / lavender / accent).
 * 18 pieces burst radially from the pill center, falling outward with
 * random rotation, fading as they go. No soft glows or gradients —
 * everything stays in the brand's pixel/stamp idiom.
 */
const CONFETTI_COLORS = [
  'bg-cyan-stamp',
  'bg-yellow-stamp',
  'bg-lavender',
  'bg-accent',
] as const;

function ConfettiBurst() {
  const pieces = Array.from({ length: 18 }, (_, i) => {
    // Spread evenly with a small random jitter so the burst doesn't look
    // like a clock face, and bias slightly upward so pieces clear the
    // pill before falling.
    const angle = (i / 18) * 360 + (Math.random() - 0.5) * 24;
    const distance = 80 + Math.random() * 50;
    const tx = Math.cos((angle * Math.PI) / 180) * distance;
    const ty = Math.sin((angle * Math.PI) / 180) * distance - 12;
    const rot = (Math.random() - 0.5) * 720;
    const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    return <ConfettiPiece key={i} tx={tx} ty={ty} rot={rot} color={color} />;
  });
  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
      {pieces}
    </div>
  );
}

function ConfettiPiece({
  tx,
  ty,
  rot,
  color,
}: {
  tx: number;
  ty: number;
  rot: number;
  color: string;
}) {
  const [flown, setFlown] = useState(false);
  useEffect(() => {
    // Two rAF ticks so the initial transform commits before transitioning,
    // otherwise the piece teleports to its end state without animating.
    const r1 = requestAnimationFrame(() => {
      const r2 = requestAnimationFrame(() => setFlown(true));
      return () => cancelAnimationFrame(r2);
    });
    return () => cancelAnimationFrame(r1);
  }, []);
  return (
    <span
      className={`absolute top-1/2 left-1/2 w-2 h-2 ${color} border-2 border-ink`}
      style={{
        marginLeft: -5,
        marginTop: -5,
        transform: flown
          ? `translate(${tx}px, ${ty}px) rotate(${rot}deg)`
          : 'translate(0, 0) rotate(0)',
        opacity: flown ? 0 : 1,
        transition:
          'transform 1500ms cubic-bezier(0.16, 0.85, 0.4, 1), opacity 1500ms ease-out',
      }}
    />
  );
}
