import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RevealKeyModal } from '../KeyModals';
import * as keyCache from '../../lib/keyCache';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

const sample = {
  keyId: 'kid-1',
  key: 'sk-PLAINTEXT-FOREVER',
  label: 'work',
  createdAt: '2026-05-02T00:00:00Z',
  expiresAt: null,
};

describe('RevealKeyModal — show-once + cache-on-confirm', () => {
  it('renders the plaintext and the transparency message', () => {
    render(
      <RevealKeyModal open={true} onClose={() => {}} created={sample} email="alice@x.com" />,
    );
    expect(screen.getByText('sk-PLAINTEXT-FOREVER')).toBeInTheDocument();
    expect(screen.getByText(/仅显示这一次/)).toBeInTheDocument();
    expect(screen.getByText(/缓存在这台设备/)).toBeInTheDocument();
    expect(screen.getByText(/退出登录/)).toBeInTheDocument();
  });

  it('does NOT close on backdrop click', () => {
    const onClose = vi.fn();
    const { container } = render(
      <RevealKeyModal open={true} onClose={onClose} created={sample} email="alice@x.com" />,
    );
    const backdrop = container.querySelector('[aria-hidden="true"]');
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does NOT render the × close button', () => {
    render(
      <RevealKeyModal open={true} onClose={() => {}} created={sample} email="alice@x.com" />,
    );
    expect(screen.queryByLabelText('关闭')).toBeNull();
  });

  it('writes the plaintext to cache and closes when "我已保存好" is clicked', () => {
    const onClose = vi.fn();
    const setSpy = vi.spyOn(keyCache, 'setCachedKey');
    render(
      <RevealKeyModal open={true} onClose={onClose} created={sample} email="alice@x.com" />,
    );
    fireEvent.click(screen.getByText('我已保存好，关闭'));
    expect(setSpy).toHaveBeenCalledWith('alice@x.com', 'kid-1', 'sk-PLAINTEXT-FOREVER');
    expect(onClose).toHaveBeenCalled();
  });
});
