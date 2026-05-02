import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RevealKeyModal, CreateKeyModal } from '../KeyModals';
import * as keyCache from '../../lib/keyCache';
import * as apiModule from '../../lib/api';

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

describe('CreateKeyModal — expiresInDays select', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to "永久不过期" and submits without expiresInDays', async () => {
    const createSpy = vi.spyOn(apiModule.api, 'createKey').mockResolvedValue({
      keyId: 'k1',
      key: 'sk-x',
      label: 'default',
      createdAt: '2026-05-02T00:00:00Z',
      expiresAt: null,
    });

    render(<CreateKeyModal open={true} onClose={() => {}} onCreated={() => {}} />);
    fireEvent.click(screen.getByText('创建'));

    await vi.waitFor(() => expect(createSpy).toHaveBeenCalled());
    const arg = createSpy.mock.calls[0][0];
    expect(arg.expiresInDays).toBeUndefined();
  });

  it('selecting "30 天" submits expiresInDays: 30', async () => {
    const createSpy = vi.spyOn(apiModule.api, 'createKey').mockResolvedValue({
      keyId: 'k1',
      key: 'sk-x',
      label: 'temp',
      createdAt: '2026-05-02T00:00:00Z',
      expiresAt: '2026-06-01T00:00:00Z',
    });

    render(<CreateKeyModal open={true} onClose={() => {}} onCreated={() => {}} />);
    // Open the custom slock-pixel dropdown via its trigger button.
    fireEvent.click(screen.getByRole('button', { name: /有效期/ }));
    // Click the "30 天" option in the listbox.
    fireEvent.click(screen.getByRole('option', { name: /30 天/ }));
    fireEvent.click(screen.getByText('创建'));

    await vi.waitFor(() => expect(createSpy).toHaveBeenCalled());
    expect(createSpy.mock.calls[0][0].expiresInDays).toBe(30);
  });

  it('clicking outside the open dropdown closes it without changing the value', () => {
    render(<CreateKeyModal open={true} onClose={() => {}} onCreated={() => {}} />);
    // Open it.
    fireEvent.click(screen.getByRole('button', { name: /有效期/ }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    // Mousedown elsewhere — the trigger's accessible name still reads
    // 永久不过期 (the default) since we didn't pick anything.
    fireEvent.mouseDown(screen.getByText('新建 API Key'));
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('button', { name: /有效期/ })).toHaveTextContent(
      /永久不过期/,
    );
  });
});
