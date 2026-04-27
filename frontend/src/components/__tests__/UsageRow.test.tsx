import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UsageRow } from '../UsageRow';

describe('<UsageRow>', () => {
  it('renders mobile variant with all data', () => {
    render(<UsageRow
      variant="mobile"
      time="9:41"
      eventType="consume"
      source="OpenClaw"
      model="Sonnet 4.7"
      amount="−$0.027"
    />);
    expect(screen.getByText('9:41')).toBeInTheDocument();
    expect(screen.getByText('Sonnet 4.7')).toBeInTheDocument();
    expect(screen.getByText('OpenClaw')).toBeInTheDocument();
    expect(screen.getByText('消耗')).toBeInTheDocument();
    expect(screen.getByText('−$0.027')).toBeInTheDocument();
  });

  it('renders reset event with green pill', () => {
    render(<UsageRow
      variant="mobile"
      time="0:00"
      eventType="reset"
      amount="+$30.00"
    />);
    expect(screen.getByText('重置')).toBeInTheDocument();
    expect(screen.getByText('+$30.00')).toBeInTheDocument();
  });

  it('renders desktop variant inside a table', () => {
    render(
      <table>
        <tbody>
          <UsageRow
            variant="desktop"
            time="2026/04/26 9:41"
            eventType="expire"
            source="套餐"
            model="日 cap 重置"
            amount="−$4.57"
          />
        </tbody>
      </table>
    );
    expect(screen.getByText('作废')).toBeInTheDocument();
    expect(screen.getByText('−$4.57')).toBeInTheDocument();
  });
});
