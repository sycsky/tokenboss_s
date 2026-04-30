import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UsageRow } from '../UsageRow';

describe('<UsageRow>', () => {
  it('renders mobile variant with all data and applies consume sign', () => {
    render(<UsageRow
      variant="mobile"
      time="9:41"
      eventType="consume"
      source="OpenClaw"
      model="Claude Sonnet 4.7"
      amountUsd={0.027}
    />);
    expect(screen.getByText('9:41')).toBeInTheDocument();
    expect(screen.getByText('Claude Sonnet 4.7')).toBeInTheDocument();
    // Mobile variant intentionally drops the source line for visual
    // density (UsageRow.tsx mobile branch comment) — source is only
    // shown in the desktop variant. So we don't assert OpenClaw here.
    expect(screen.getByText('消耗')).toBeInTheDocument();
    // Sign derived from eventType, not from value sign — backend ships
    // a positive magnitude and the row owns the '−' for consume events.
    expect(screen.getByText('−$0.027000')).toBeInTheDocument();
  });

  it('renders reset event with green pill and + sign', () => {
    render(<UsageRow
      variant="mobile"
      time="0:00"
      eventType="reset"
      amountUsd={30}
    />);
    expect(screen.getByText('重置')).toBeInTheDocument();
    expect(screen.getByText('+$30.000000')).toBeInTheDocument();
  });

  it('renders expire event with − sign even when value is positive', () => {
    render(
      <table>
        <tbody>
          <UsageRow
            variant="desktop"
            time="2026/04/26 9:41"
            eventType="expire"
            source="套餐"
            model="日 cap 重置"
            amountUsd={4.57}
          />
        </tbody>
      </table>
    );
    expect(screen.getByText('作废')).toBeInTheDocument();
    expect(screen.getByText('−$4.570000')).toBeInTheDocument();
  });

  it('renders topup event with + sign', () => {
    render(<UsageRow
      variant="mobile"
      time="10:00"
      eventType="topup"
      amountUsd={50}
    />);
    expect(screen.getByText('充值')).toBeInTheDocument();
    expect(screen.getByText('+$50.000000')).toBeInTheDocument();
  });
});
