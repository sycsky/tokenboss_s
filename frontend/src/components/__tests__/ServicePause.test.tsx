import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../../App';
import { api, type BillingOrder } from '../../lib/api';
const auth = vi.hoisted(() => ({ user: null as { userId: string; email: string } | null, token: null, refresh: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../lib/auth', () => ({ useAuth: () => auth }));
const cutoff = Date.parse('2026-12-01T00:00:00+08:00');
const show = (path: string) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
beforeEach(() => { auth.user = null; vi.useFakeTimers(); vi.setSystemTime(cutoff - 1000); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('service pause website', () => {
  it('shows one homepage banner without a new slogan-side status card', () => {
    show('/');
    expect(screen.getByLabelText('服务暂停公告')).toHaveTextContent('2026 年 12 月 1 日 00:00');
    expect(screen.getByLabelText('服务暂停公告')).toHaveTextContent('shawn@tokenboss.co');
    expect(screen.queryByText('当前服务状态')).not.toBeInTheDocument();
    expect(screen.queryByText('免费试用')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '登录' })).not.toBeInTheDocument();
  });
  it.each(['/login', '/register', '/login/magic', '/verify-email?token=old', '/oauth/callback#token=old', '/billing/topup', '/billing/pay?plan=plus'])('%s displays a public notice without auth or payment forms', path => {
    show(path);
    expect(screen.getByRole('heading', { name: '服务暂停与退款说明' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByLabelText('停服时间')).toHaveTextContent('2026 年 12 月 1 日');
    const mail = screen.getByRole('link', { name: '发送退款申请邮件' });
    expect(mail.getAttribute('href')).toContain('mailto:shawn@tokenboss.co');
    expect(decodeURIComponent(mail.getAttribute('href')!)).toContain('联系微信');
  });
  it('updates the announcement and notice while a tab stays open across cutoff', async () => {
    show('/service-notice');
    expect(screen.getByLabelText('服务暂停公告')).toHaveTextContent('将于');
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(screen.getByLabelText('服务暂停公告')).toHaveTextContent('已于');
    expect(screen.queryByText(/已有 API Key 可在停服前/)).not.toBeInTheDocument();
  });
  it('keeps a manual-copy fallback when clipboard access is unavailable', async () => {
    show('/service-notice');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '复制邮箱' })); });
    expect(screen.getByRole('status')).toHaveTextContent('手动复制');
    expect(screen.getAllByRole('link', { name: 'shawn@tokenboss.co' })[0]).toHaveAttribute('href', expect.stringContaining('mailto:shawn@tokenboss.co'));
  });
  it('retains historical order details but hides pending payment and recharge links', async () => {
    auth.user = { userId: 'u_qa', email: 'qa@example.invalid' };
    vi.spyOn(api, 'getOrder').mockResolvedValue({ order: {
      orderId: 'qa-order', skuType: 'topup', status: 'pending', amount: 10,
      currency: 'USD', channel: 'dodo', createdAt: '2026-11-01T00:00:00Z',
      paymentUrl: 'https://example.invalid/checkout',
    } as BillingOrder });
    await act(async () => { show('/billing/orders/qa-order'); });
    expect(screen.getByText('qa-order')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /重新打开支付页/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /再充一笔/ })).not.toBeInTheDocument();
    expect(document.querySelector('a[href="https://example.invalid/checkout"]')).toBeNull();
  });
  it.each(['/console', '/console/account'])('keeps signed-in viewing at %s without recharge or redemption actions', async path => {
    auth.user = { userId: 'u_pause_qa', email: 'qa@example.invalid' };
    vi.spyOn(api, 'me').mockResolvedValue({ user: { ...auth.user, emailVerified: true, createdAt: '2026-11-01T00:00:00Z' } } as Awaited<ReturnType<typeof api.me>>);
    vi.spyOn(api, 'getBuckets').mockResolvedValue({ buckets: [] });
    vi.spyOn(api, 'listKeys').mockResolvedValue({ keys: [] });
    vi.spyOn(api, 'getUsage').mockResolvedValue({ records: [], totals: { consumed: 0, calls: 0 }, hourly24h: [] });
    vi.spyOn(api, 'getUsageAggregate').mockResolvedValue({ groups: [] } as unknown as Awaited<ReturnType<typeof api.getUsageAggregate>>);
    await act(async () => { show(path); });
    expect(screen.getByLabelText('服务暂停公告')).toBeInTheDocument();
    expect(document.querySelector('a[href="/billing/topup"]')).toBeNull();
    expect(screen.queryByRole('button', { name: '使用兑换码' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /续费/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /充值|开通套餐|选个套餐/ })).not.toBeInTheDocument();
  });
});
