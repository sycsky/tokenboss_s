import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { APIKeyList } from '../APIKeyList';

const baseKey = (over: Partial<any> = {}) => ({
  keyId: 'k1',
  key: 'sk-•••a4c2',
  label: 'default',
  createdAt: '2026-04-15T00:00:00Z',
  disabled: false,
  expiresAt: null,
  ...over,
});

const baseProps = {
  loadError: null,
  keyStats: new Map(),
  onCreateClick: () => {},
  onDeleteClick: () => {},
  onShowAllClick: () => {},
};

describe('APIKeyList', () => {
  it('rows are always masked — no Copy button anywhere (platform never persists plaintext)', () => {
    render(<APIKeyList {...baseProps} keys={[baseKey()]} />);
    expect(screen.getByText('sk-•••a4c2')).toBeInTheDocument();
    expect(screen.queryByLabelText(/复制/)).toBeNull();
  });

  it('renders "永久" for keys with expiresAt = null', () => {
    render(<APIKeyList {...baseProps} keys={[baseKey()]} />);
    expect(screen.getByText(/永久/)).toBeInTheDocument();
  });

  it('renders "X 天后过期" for future expiry', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-02T12:00:00Z'));
    const future = new Date('2026-05-25T12:00:00Z').toISOString();
    render(<APIKeyList {...baseProps} keys={[baseKey({ expiresAt: future })]} />);
    expect(screen.getByText(/23 天后过期/)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('renders 已过期 badge for expired keys', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-13T12:00:00Z'));
    const past = new Date('2026-05-01T12:00:00Z').toISOString();
    render(<APIKeyList {...baseProps} keys={[baseKey({ expiresAt: past })]} />);
    expect(screen.getByText('已过期')).toBeInTheDocument();
    expect(screen.getByText(/已过期 12 天/)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('renders 已吊销 badge for disabled (newapi-side) keys without expiry', () => {
    render(<APIKeyList {...baseProps} keys={[baseKey({ disabled: true })]} />);
    expect(screen.getByText('已吊销')).toBeInTheDocument();
    expect(screen.queryByText('已过期')).toBeNull();
  });

  it('prefers 已过期 over 已吊销 when a key is both expired AND disabled', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-13T12:00:00Z'));
    const past = new Date('2026-05-01T12:00:00Z').toISOString();
    render(
      <APIKeyList
        {...baseProps}
        keys={[baseKey({ disabled: true, expiresAt: past })]}
      />,
    );
    expect(screen.getByText('已过期')).toBeInTheDocument();
    expect(screen.queryByText('已吊销')).toBeNull();
    vi.useRealTimers();
  });

  it('expired rows get a line-through + dim treatment so they read as dead', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-13T12:00:00Z'));
    const past = new Date('2026-05-01T12:00:00Z').toISOString();
    const { container } = render(
      <APIKeyList {...baseProps} keys={[baseKey({ expiresAt: past })]} />,
    );
    expect(container.querySelector('.opacity-60')).toBeTruthy();
    expect(container.querySelector('.line-through')).toBeTruthy();
    vi.useRealTimers();
  });

  it('caps inline rows at maxInline (default 1) and surfaces "查看全部 →" — no count', () => {
    const onShowAll = vi.fn();
    const manyKeys = Array.from({ length: 4 }, (_, i) =>
      baseKey({ keyId: `k-${i}`, label: `key-${i}` }),
    );
    render(<APIKeyList {...baseProps} keys={manyKeys} onShowAllClick={onShowAll} />);
    // Only 1 row rendered inline (the first).
    expect(screen.getByText('key-0')).toBeInTheDocument();
    expect(screen.queryByText('key-1')).toBeNull();
    // See-all button is text-only, no count number.
    const seeAll = screen.getByText('查看全部 →');
    expect(seeAll).toBeInTheDocument();
    fireEvent.click(seeAll);
    expect(onShowAll).toHaveBeenCalledTimes(1);
  });

  it('does NOT render the see-all entry when keys.length <= maxInline', () => {
    render(<APIKeyList {...baseProps} keys={[baseKey()]} />);
    expect(screen.queryByText(/查看全部/)).toBeNull();
  });

  it('respects an explicit maxInline override', () => {
    const manyKeys = Array.from({ length: 4 }, (_, i) =>
      baseKey({ keyId: `k-${i}`, label: `key-${i}` }),
    );
    render(<APIKeyList {...baseProps} keys={manyKeys} maxInline={2} />);
    expect(screen.getByText('key-0')).toBeInTheDocument();
    expect(screen.getByText('key-1')).toBeInTheDocument();
    expect(screen.queryByText('key-2')).toBeNull();
    expect(screen.getByText('查看全部 →')).toBeInTheDocument();
  });
});
