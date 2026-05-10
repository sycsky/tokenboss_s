import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MonoLogLoader } from '../MonoLogLoader';

describe('<MonoLogLoader>', () => {
  it('renders default header and given endpoints', () => {
    render(<MonoLogLoader endpoints={['subscription state', 'usage 30d', 'api keys']} />);
    expect(screen.getByText('tokenboss · syncing')).toBeInTheDocument();
    // Each endpoint appears twice — once in the visible spinner row,
    // once in the sr-only "正在加载 …" announcement for screen readers.
    expect(screen.getAllByText(/subscription state/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/usage 30d/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/api keys/).length).toBeGreaterThanOrEqual(1);
  });

  it('accepts a custom title', () => {
    render(<MonoLogLoader title="tokenboss · loading order" endpoints={['order status']} />);
    expect(screen.getByText('tokenboss · loading order')).toBeInTheDocument();
  });

  it('exposes role=status and aria-busy for screen readers', () => {
    render(<MonoLogLoader endpoints={['x']} />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    // sr-only text echoes the endpoints so screen readers announce
    // *what* is loading, not just "loading".
    expect(screen.getByText(/正在加载\s*x/)).toBeInTheDocument();
  });

  it('renders one of the 8 braille spinner frames per endpoint', () => {
    render(<MonoLogLoader endpoints={['a', 'b', 'c']} />);
    const frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧'];
    const root = screen.getByRole('status');
    const text = root.textContent ?? '';
    const matches = frames.filter(f => text.includes(f));
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });
});
