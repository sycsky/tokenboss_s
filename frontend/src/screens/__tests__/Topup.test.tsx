import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import * as apiModule from '../../lib/api';
import * as authModule from '../../lib/auth';
import Topup from '../Topup';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.spyOn(authModule, 'useAuth').mockReturnValue({
    user: {
      userId: 'u_1',
      email: 'alice@x.com',
      emailVerified: true,
      balance: 0,
      createdAt: '2026-04-01T00:00:00Z',
    },
    session: { token: 't' } as any,
    loading: false,
    setSession: () => {},
    logout: () => {},
    refreshUser: async () => {},
  } as any);
});

const renderTopup = () =>
  render(
    <MemoryRouter initialEntries={['/billing/topup']}>
      <Topup />
    </MemoryRouter>,
  );

describe('Topup service upgrade state', () => {
  it('disables purchase controls and never calls createOrder', async () => {
    const user = userEvent.setup();
    const createOrderSpy = vi.spyOn(apiModule.api, 'createOrder').mockResolvedValue({
      orderId: 'ord_should_not_create',
      paymentUrl: 'https://pay.test',
    } as any);

    renderTopup();

    expect(screen.getByText('服务升级中')).toBeInTheDocument();
    expect(screen.getAllByText(/暂不支持购买/).length).toBeGreaterThan(0);

    const purchaseButton = screen.getByRole('button', { name: /暂不支持购买/ });
    expect(purchaseButton).toBeDisabled();
    await user.click(purchaseButton);
    expect(createOrderSpy).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '已有兑换码？' }));
    expect(screen.getByRole('dialog', { name: '使用兑换码' })).toBeInTheDocument();
  });
});
