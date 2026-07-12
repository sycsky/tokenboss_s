import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import * as apiModule from '../../lib/api';
import * as authModule from '../../lib/auth';
import type { BillingOrder } from '../../lib/api';
import OrderStatus from '../OrderStatus';

let refreshMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  refreshMock = vi.fn(async () => {});
  vi.spyOn(authModule, 'useAuth').mockReturnValue({
    user: { userId: 'u_1', email: 'a@x.com', emailVerified: true, balance: 0, createdAt: '2026-04-01T00:00:00Z' },
    session: { token: 't' } as any,
    loading: false,
    refresh: refreshMock,
    setSession: () => {}, logout: () => {}, refreshUser: async () => {},
  } as any);
});

const renderOrder = (orderId = 'ord_test_123') =>
  render(
    <MemoryRouter initialEntries={[`/billing/orders/${orderId}`]}>
      <Routes>
        <Route path="/billing/orders/:id" element={<OrderStatus />} />
      </Routes>
    </MemoryRouter>,
  );

const paidTopup = (overrides: Partial<BillingOrder> = {}): BillingOrder =>
  ({
    orderId: 'ord_test_123',
    skuType: 'topup',
    channel: 'dodo',
    amount: 50,
    currency: 'USD',
    topupAmountUsd: 340,
    status: 'paid',
    createdAt: '2026-07-12T00:00:00Z',
    paidAt: '2026-07-12T00:01:00Z',
    ...overrides,
  }) as BillingOrder;

describe('OrderStatus loading state', () => {
  it('renders MonoLogLoader with custom title while order is pending', () => {
    const never = new Promise<never>(() => {});
    vi.spyOn(apiModule.api, 'getOrder').mockReturnValue(never as any);

    renderOrder();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('tokenboss · loading order')).toBeInTheDocument();
    // Endpoint appears twice — visible spinner row + sr-only announcement.
    expect(screen.getAllByText(/order status/).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('加载订单中…')).toBeNull();
  });
});

describe('OrderStatus settlement phases (topup)', () => {
  it('settleStatus=settled → claims credit + refreshes balance', async () => {
    vi.spyOn(apiModule.api, 'getOrder').mockResolvedValue({
      order: paidTopup({ settleStatus: 'settled' }),
    } as any);

    renderOrder();

    expect(await screen.findByText('支付成功')).toBeInTheDocument();
    expect(screen.getByText(/已加到余额/)).toBeInTheDocument();
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it('settleStatus=failed → surfaces recovery state, never claims credit or refreshes', async () => {
    vi.spyOn(apiModule.api, 'getOrder').mockResolvedValue({
      order: paidTopup({ settleStatus: 'failed' }),
    } as any);

    renderOrder();

    expect(await screen.findByText('支付成功 · 入账未完成')).toBeInTheDocument();
    expect(screen.queryByText(/已加到余额/)).toBeNull();
    // Critical: a failed credit must not be refreshed/redirected as success.
    await Promise.resolve();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('paid but settleStatus unresolved → shows crediting-in-progress, no premature refresh', async () => {
    vi.spyOn(apiModule.api, 'getOrder').mockResolvedValue({
      order: paidTopup({ settleStatus: undefined }),
    } as any);

    renderOrder();

    expect(await screen.findByText('支付成功 · 正在入账')).toBeInTheDocument();
    expect(screen.queryByText(/已加到余额/)).toBeNull();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
