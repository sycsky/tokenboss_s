/**
 * UltraSoldOutPage — verifies the 3-phase copy machine and that all
 * key value-props (WHO / WHAT / WHY / Super-priority) are visible.
 *
 * Time pinning via vi.useFakeTimers + vi.setSystemTime so phase output
 * is deterministic. CST 9:55 = UTC 1:55, so we anchor relative to that.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../lib/auth';
import { UltraSoldOutPage } from '../Payment';

const PRICE = { price: '¥1688', period: '/ 4 周' };

function renderPage() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <UltraSoldOutPage price={PRICE} />
      </AuthProvider>
    </MemoryRouter>,
  );
}

/** Helper: utc ms for a given CST hour:minute on 2026-04-29. */
function utcMs(cstHour: number, cstMin: number, addMs = 0): number {
  return Date.UTC(2026, 3, 29, (cstHour - 8 + 24) % 24, cstMin, 0) + addMs;
}

describe('<UltraSoldOutPage>', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows the price + period in the subhead regardless of phase', () => {
    vi.setSystemTime(new Date(utcMs(8, 0))); // 8 AM CST = before
    renderPage();
    // price is a bare text fragment inside <p>, not a wrapped element
    expect(screen.getByText(/¥1688/)).toBeInTheDocument();
    expect(screen.getByText('/ 4 周')).toBeInTheDocument();
  });

  it('phase = before (pre 9:55): subhead says "即将抢购", countdown card titled "距离今日开放"', () => {
    vi.setSystemTime(new Date(utcMs(9, 50))); // 9:50 AM CST
    renderPage();
    // Subhead copy
    expect(screen.getByText(/Super 用户即将抢购今日 8 席/)).toBeInTheDocument();
    // Countdown card title
    expect(screen.getByText('距离今日开放')).toBeInTheDocument();
  });

  it('phase = transitioning (just past 9:55): banner says "正在抢购", countdown digits replaced by "抢购中…"', () => {
    vi.setSystemTime(new Date(utcMs(9, 55, 1_000))); // 9:55:01 — within 2-5s window
    renderPage();
    expect(screen.getByText(/Super 用户正在抢购今日 8 席/)).toBeInTheDocument();
    // Countdown card switches to "SUPER 抢购中" title
    expect(screen.getByText('SUPER 抢购中')).toBeInTheDocument();
    // The big digits row replaced by "抢购中…" pulse
    expect(screen.getByText('抢购中…')).toBeInTheDocument();
    // Footer right corner ALSO uses transitioning copy
    expect(screen.getByText('SUPER 抢购中…')).toBeInTheDocument();
  });

  it('phase = passed (>5s past 9:55): subhead "已被抢完", countdown title "距离明日开放"', () => {
    vi.setSystemTime(new Date(utcMs(10, 0))); // 10:00 — well past max 5s window
    renderPage();
    expect(screen.getByText(/今日 8 席已被 Super 用户抢完/)).toBeInTheDocument();
    expect(screen.getByText('距离明日开放')).toBeInTheDocument();
  });

  it('always renders the WHO / WHAT / WHY sections (independent of phase)', () => {
    vi.setSystemTime(new Date(utcMs(12, 0))); // any phase
    renderPage();
    // WHO section
    expect(screen.getByRole('heading', { name: '谁真的需要 Ultra' })).toBeInTheDocument();
    expect(screen.getByText('科研 Agent')).toBeInTheDocument();
    expect(screen.getByText('金融 Agent')).toBeInTheDocument();
    expect(screen.getByText('法律 / 医疗 / 工程 Agent')).toBeInTheDocument();
    // WHAT section
    expect(screen.getByRole('heading', { name: 'Ultra 给你的两件事' })).toBeInTheDocument();
    expect(screen.getByText(/GPT-5.5 Pro · OpenAI 满血 Codex 推理引擎/)).toBeInTheDocument();
    expect(screen.getByText(/Anthropic 官方 API 直连/)).toBeInTheDocument();
    // WHY GATED section
    expect(screen.getByRole('heading', { name: /为什么我们每天只放/ })).toBeInTheDocument();
  });

  it('always renders the SUPER 用户专属 priority callout (drives Plus → Super upsell)', () => {
    vi.setSystemTime(new Date(utcMs(8, 0)));
    renderPage();
    expect(screen.getByText('SUPER 用户专属')).toBeInTheDocument();
    expect(screen.getByText(/每日 9:55 提前 5 分钟独占抢购窗口/)).toBeInTheDocument();
    expect(screen.getByText(/10:00 后剩余名额才对所有人开放/)).toBeInTheDocument();
  });

  it('renders breadcrumb pointing back to /pricing', () => {
    vi.setSystemTime(new Date(utcMs(8, 0)));
    renderPage();
    const breadcrumbLink = screen.getByRole('link', { name: '套餐' });
    expect(breadcrumbLink).toHaveAttribute('href', '/pricing');
    // Final segment names the tier
    expect(screen.getByText('Ultra · 满血档')).toBeInTheDocument();
  });
});
