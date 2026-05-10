import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../../lib/auth';
import * as apiModule from '../../lib/api';
import OrderStatus from '../OrderStatus';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  // Stub api.me for AuthProvider initialization.
  vi.spyOn(apiModule.api, 'me').mockResolvedValue({
    user: {
      userId: 'u_1',
      email: 'alice@x.com',
      emailVerified: true,
      balance: 0,
      createdAt: '2026-04-01T00:00:00Z',
    },
  } as any);
});

const renderOrder = (orderId = 'ord_test_123') =>
  render(
    <MemoryRouter initialEntries={[`/billing/orders/${orderId}`]}>
      <AuthProvider>
        <Routes>
          <Route path="/billing/orders/:id" element={<OrderStatus />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );

describe('OrderStatus loading state', () => {
  it('renders MonoLogLoader with custom title while order is pending', () => {
    const never = new Promise<never>(() => {});
    vi.spyOn(apiModule.api, 'getOrder').mockReturnValue(never as any);

    renderOrder();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('tokenboss · loading order')).toBeInTheDocument();
    expect(screen.getByText(/order status/)).toBeInTheDocument();
    // 旧 "加载订单中…" h1 不应再出现
    expect(screen.queryByText('加载订单中…')).toBeNull();
  });
});
