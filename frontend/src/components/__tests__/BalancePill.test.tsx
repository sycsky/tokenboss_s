import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BalancePill } from '../BalancePill';

describe('<BalancePill>', () => {
  it('renders amount with default label', () => {
    render(<BalancePill amount="$8.32" />);
    expect(screen.getByText('余额')).toBeInTheDocument();
    expect(screen.getByText('$8.32')).toBeInTheDocument();
  });

  it('renders custom label when provided', () => {
    render(<BalancePill amount="$32.10" label="当前余额" />);
    expect(screen.getByText('当前余额')).toBeInTheDocument();
    expect(screen.getByText('$32.10')).toBeInTheDocument();
  });
});
