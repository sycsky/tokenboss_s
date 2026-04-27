import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TierCard } from '../TierCard';

describe('<TierCard>', () => {
  it('renders all props', () => {
    render(<TierCard
      name="Plus"
      pricePeriod="¥288 / 4 周"
      leverage="×3"
      totalUsd="≈ $840 调用额度"
      dailyCap="$30 每日 cap"
      models="Codex 系列"
      ctaText="联系客服开通"
    />);
    expect(screen.getByText('Plus')).toBeInTheDocument();
    expect(screen.getByText('¥288 / 4 周')).toBeInTheDocument();
    expect(screen.getByText('×3')).toBeInTheDocument();
    expect(screen.getByText('≈ $840 调用额度')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '联系客服开通' })).toBeInTheDocument();
  });

  it('shows ★ when featured', () => {
    render(<TierCard
      name="Super" pricePeriod="¥688/4周" dailyCap="$80/天" models="Claude+Codex"
      ctaText="开通" featured />);
    expect(screen.getByText('★')).toBeInTheDocument();
  });

  it('shows 售罄 + dims when soldOut', () => {
    const { container } = render(<TierCard
      name="Ultra" pricePeriod="¥1688/4周" dailyCap="$720/天" models="reasoning"
      ctaText="名额已满" ctaVariant="disabled" soldOut />);
    expect(screen.getByText('售罄')).toBeInTheDocument();
    expect(container.firstChild).toHaveClass('opacity-55');
  });
});
