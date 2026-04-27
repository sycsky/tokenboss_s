import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CompatRow, AgentMark } from '../CompatRow';

describe('<CompatRow>', () => {
  it('renders label + agent marks', () => {
    const agents: AgentMark[] = [
      { id: 'oc', label: 'OC', name: 'OpenClaw' },
      { id: 'hm', label: 'HM', name: 'Hermes' },
    ];
    render(<CompatRow label="适配你喜欢的 Agent" agents={agents} />);
    expect(screen.getByText('适配你喜欢的 Agent')).toBeInTheDocument();
    expect(screen.getByText('OC')).toBeInTheDocument();
    expect(screen.getByText('HM')).toBeInTheDocument();
  });
});
