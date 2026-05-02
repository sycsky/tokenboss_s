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

describe('APIKeyList', () => {
  it('does NOT render any "复制" button', () => {
    render(
      <APIKeyList
        keys={[baseKey()]}
        loadError={null}
        keyStats={new Map()}
        cachedPlaintexts={new Map()}
        onCreateClick={() => {}}
        onDeleteClick={() => {}}
        onShowAllClick={() => {}}
      />,
    );
    expect(screen.queryByLabelText(/复制/)).toBeNull();
  });

  it('renders "永久" for keys with expiresAt = null', () => {
    render(
      <APIKeyList
        keys={[baseKey()]}
        loadError={null}
        keyStats={new Map()}
        cachedPlaintexts={new Map()}
        onCreateClick={() => {}}
        onDeleteClick={() => {}}
        onShowAllClick={() => {}}
      />,
    );
    expect(screen.getByText(/永久/)).toBeInTheDocument();
  });

  it('renders "X 天后过期" for future expiry', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-02T12:00:00Z'));
    const future = new Date('2026-05-25T12:00:00Z').toISOString();
    render(
      <APIKeyList
        keys={[baseKey({ expiresAt: future })]}
        loadError={null}
        keyStats={new Map()}
        cachedPlaintexts={new Map()}
        onCreateClick={() => {}}
        onDeleteClick={() => {}}
        onShowAllClick={() => {}}
      />,
    );
    expect(screen.getByText(/23 天后过期/)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('renders 已过期 badge for expired keys and hides the delete pending state', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-13T12:00:00Z'));
    const past = new Date('2026-05-01T12:00:00Z').toISOString();
    render(
      <APIKeyList
        keys={[baseKey({ expiresAt: past })]}
        loadError={null}
        keyStats={new Map()}
        cachedPlaintexts={new Map()}
        onCreateClick={() => {}}
        onDeleteClick={() => {}}
        onShowAllClick={() => {}}
      />,
    );
    expect(screen.getByText('已过期')).toBeInTheDocument();
    expect(screen.getByText(/已过期 12 天/)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('renders 已吊销 badge for disabled (newapi-side) keys without expiry', () => {
    render(
      <APIKeyList
        keys={[baseKey({ disabled: true })]}
        loadError={null}
        keyStats={new Map()}
        cachedPlaintexts={new Map()}
        onCreateClick={() => {}}
        onDeleteClick={() => {}}
        onShowAllClick={() => {}}
      />,
    );
    expect(screen.getByText('已吊销')).toBeInTheDocument();
    expect(screen.queryByText('已过期')).toBeNull();
  });

  it('prefers 已过期 badge over 已吊销 when a key is both expired AND disabled', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-13T12:00:00Z'));
    const past = new Date('2026-05-01T12:00:00Z').toISOString();
    render(
      <APIKeyList
        keys={[baseKey({ disabled: true, expiresAt: past })]}
        loadError={null}
        keyStats={new Map()}
        cachedPlaintexts={new Map()}
        onCreateClick={() => {}}
        onDeleteClick={() => {}}
        onShowAllClick={() => {}}
      />,
    );
    expect(screen.getByText('已过期')).toBeInTheDocument();
    expect(screen.queryByText('已吊销')).toBeNull();
    vi.useRealTimers();
  });

  it('renders the plaintext + Copy button on rows whose keyId is in cachedPlaintexts', () => {
    const cached = new Map<string, string>([['k1', 'sk-FULL-PLAINTEXT-XYZ']]);
    render(
      <APIKeyList
        keys={[baseKey()]}
        loadError={null}
        keyStats={new Map()}
        cachedPlaintexts={cached}
        onCreateClick={() => {}}
        onDeleteClick={() => {}}
        onShowAllClick={() => {}}
      />,
    );
    expect(screen.getByText('sk-FULL-PLAINTEXT-XYZ')).toBeInTheDocument();
    expect(screen.queryByText('sk-•••a4c2')).toBeNull();
    expect(screen.getByLabelText(/复制/)).toBeInTheDocument();
  });

  it('shows masked + NO Copy button on rows that are NOT cached', () => {
    render(
      <APIKeyList
        keys={[baseKey()]}
        loadError={null}
        keyStats={new Map()}
        cachedPlaintexts={new Map()}
        onCreateClick={() => {}}
        onDeleteClick={() => {}}
        onShowAllClick={() => {}}
      />,
    );
    expect(screen.getByText('sk-•••a4c2')).toBeInTheDocument();
    expect(screen.queryByLabelText(/复制/)).toBeNull();
  });

  it('does NOT show Copy on disabled or expired keys even if cached', () => {
    const cached = new Map<string, string>([['k1', 'sk-CACHED-BUT-DEAD']]);
    const { rerender } = render(
      <APIKeyList
        keys={[baseKey({ disabled: true })]}
        loadError={null}
        keyStats={new Map()}
        cachedPlaintexts={cached}
        onCreateClick={() => {}}
        onDeleteClick={() => {}}
        onShowAllClick={() => {}}
      />,
    );
    expect(screen.queryByLabelText(/复制/)).toBeNull();

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-13T12:00:00Z'));
    const past = new Date('2026-05-01T12:00:00Z').toISOString();
    rerender(
      <APIKeyList
        keys={[baseKey({ expiresAt: past })]}
        loadError={null}
        keyStats={new Map()}
        cachedPlaintexts={cached}
        onCreateClick={() => {}}
        onDeleteClick={() => {}}
        onShowAllClick={() => {}}
      />,
    );
    expect(screen.queryByLabelText(/复制/)).toBeNull();
    vi.useRealTimers();
  });

  it('expired/disabled rows show the MASKED value, not the cached plaintext', () => {
    const cached = new Map<string, string>([['k1', 'sk-CACHED-BUT-DEAD']]);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-13T12:00:00Z'));
    const past = new Date('2026-05-01T12:00:00Z').toISOString();
    const { rerender } = render(
      <APIKeyList
        keys={[baseKey({ expiresAt: past })]}
        loadError={null}
        keyStats={new Map()}
        cachedPlaintexts={cached}
        onCreateClick={() => {}}
        onDeleteClick={() => {}}
        onShowAllClick={() => {}}
      />,
    );
    // Expired row falls back to the masked `sk-•••a4c2` even though
    // cache still has the plaintext.
    expect(screen.getByText('sk-•••a4c2')).toBeInTheDocument();
    expect(screen.queryByText('sk-CACHED-BUT-DEAD')).toBeNull();

    rerender(
      <APIKeyList
        keys={[baseKey({ disabled: true })]}
        loadError={null}
        keyStats={new Map()}
        cachedPlaintexts={cached}
        onCreateClick={() => {}}
        onDeleteClick={() => {}}
        onShowAllClick={() => {}}
      />,
    );
    // Disabled row also falls back to mask.
    expect(screen.getByText('sk-•••a4c2')).toBeInTheDocument();
    expect(screen.queryByText('sk-CACHED-BUT-DEAD')).toBeNull();
    vi.useRealTimers();
  });

  it('expired rows get a line-through + dim treatment so they read as dead', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-13T12:00:00Z'));
    const past = new Date('2026-05-01T12:00:00Z').toISOString();
    const { container } = render(
      <APIKeyList
        keys={[baseKey({ expiresAt: past })]}
        loadError={null}
        keyStats={new Map()}
        cachedPlaintexts={new Map()}
        onCreateClick={() => {}}
        onDeleteClick={() => {}}
        onShowAllClick={() => {}}
      />,
    );
    // Whole row dimmed
    expect(container.querySelector('.opacity-60')).toBeTruthy();
    // Label has line-through class
    expect(container.querySelector('.line-through')).toBeTruthy();
    vi.useRealTimers();
  });

  it('caps inline rows at maxInline (default 3) and surfaces a "see all" button', () => {
    const onShowAll = vi.fn();
    const manyKeys = Array.from({ length: 6 }, (_, i) =>
      baseKey({ keyId: `k-${i}`, label: `key-${i}` }),
    );
    render(
      <APIKeyList
        keys={manyKeys}
        loadError={null}
        keyStats={new Map()}
        cachedPlaintexts={new Map()}
        onCreateClick={() => {}}
        onDeleteClick={() => {}}
        onShowAllClick={onShowAll}
      />,
    );
    // Only 3 rows rendered inline.
    expect(screen.getByText('key-0')).toBeInTheDocument();
    expect(screen.getByText('key-1')).toBeInTheDocument();
    expect(screen.getByText('key-2')).toBeInTheDocument();
    expect(screen.queryByText('key-3')).toBeNull();
    // The see-all button shows the total count (6).
    const seeAll = screen.getByText(/查看全部 6 把 Key/);
    expect(seeAll).toBeInTheDocument();
    fireEvent.click(seeAll);
    expect(onShowAll).toHaveBeenCalledTimes(1);
  });

  it('does NOT render the see-all entry when keys.length <= maxInline', () => {
    render(
      <APIKeyList
        keys={[baseKey()]}
        loadError={null}
        keyStats={new Map()}
        cachedPlaintexts={new Map()}
        onCreateClick={() => {}}
        onDeleteClick={() => {}}
        onShowAllClick={() => {}}
      />,
    );
    expect(screen.queryByText(/查看全部/)).toBeNull();
  });
});
