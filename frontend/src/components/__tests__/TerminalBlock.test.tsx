import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TerminalBlock } from '../TerminalBlock';

describe('<TerminalBlock>', () => {
  it('renders cmd + COPY button', () => {
    render(<TerminalBlock cmd="set up tokenboss.com/skill.md" />);
    expect(screen.getByText('set up tokenboss.com/skill.md')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument();
  });

  it('copies to clipboard on click', async () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    render(<TerminalBlock cmd="hello" />);
    await userEvent.click(screen.getByRole('button'));
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('lazy-resolves extra on first COPY and writes resolved value', async () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    const resolver = vi.fn().mockResolvedValue('TOKENBOSS_API_KEY=sk-real-plaintext');
    render(
      <TerminalBlock
        cmd="set up tokenboss.com/skill.md"
        extra="TOKENBOSS_API_KEY=sk-mask...nA=="
        extraResolver={resolver}
      />,
    );
    // Visible extra starts as the masked placeholder.
    expect(screen.getByText('TOKENBOSS_API_KEY=sk-mask...nA==')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button'));
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(
      'set up tokenboss.com/skill.md\nTOKENBOSS_API_KEY=sk-real-plaintext',
    );
    // After resolve, the visible extra swaps to the plaintext value.
    expect(screen.getByText('TOKENBOSS_API_KEY=sk-real-plaintext')).toBeInTheDocument();
  });
});
