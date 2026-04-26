import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TerminalBlock } from '../TerminalBlock';

describe('<TerminalBlock>', () => {
  it('renders prompt + cmd + COPY button', () => {
    render(<TerminalBlock cmd="set up tokenboss.com/skill.md" />);
    expect(screen.getByText('$')).toBeInTheDocument();
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
});
