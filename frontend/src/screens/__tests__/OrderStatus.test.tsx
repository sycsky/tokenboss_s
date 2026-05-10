import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import * as apiModule from '../../lib/api';
import * as authModule from '../../lib/auth';
import OrderStatus from '../OrderStatus';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.spyOn(authModule, 'useAuth').mockReturnValue({
    user: { userId: 'u_1', email: 'a@x.com', emailVerified: true, balance: 0, createdAt: '2026-04-01T00:00:00Z' },
    session: { token: 't' } as any,
    loading: false,
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

describe('OrderStatus loading state', () => {
  it('renders MonoLogLoader with custom title while order is pending', () => {
    const never = new Promise<never>(() => {});
    vi.spyOn(apiModule.api, 'getOrder').mockReturnValue(never as any);

    renderOrder();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('tokenboss · loading order')).toBeInTheDocument();
    expect(screen.getByText(/order status/)).toBeInTheDocument();
    expect(screen.queryByText('加载订单中…')).toBeNull();
  });
});
