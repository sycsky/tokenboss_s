import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
        onCreateClick={() => {}}
        onDeleteClick={() => {}}
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
        onCreateClick={() => {}}
        onDeleteClick={() => {}}
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
        onCreateClick={() => {}}
        onDeleteClick={() => {}}
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
        onCreateClick={() => {}}
        onDeleteClick={() => {}}
      />,
    );
    expect(screen.getByText('已过期')).toBeInTheDocument();
    expect(screen.getByText(/已过期 12 天/)).toBeInTheDocument();
    vi.useRealTimers();
  });
});
