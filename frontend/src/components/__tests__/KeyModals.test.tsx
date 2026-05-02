import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RevealKeyModal, CreateKeyModal } from '../KeyModals';
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
  beforeEach(() => {
    // jsdom needs a clipboard mock — navigator.clipboard.writeText is
    // undefined by default and our copy buttons rely on it.
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it('renders the plaintext + the prominent action-verb warning', () => {
    render(
      <RevealKeyModal open={true} onClose={() => {}} created={sample} />,
    );
    expect(screen.getByText('sk-PLAINTEXT-FOREVER')).toBeInTheDocument();
    // Title is a call-to-action ("立刻复制并保存") not a description.
    expect(screen.getByText('立刻复制并保存')).toBeInTheDocument();
    // Body explains the one-shot consequence + the recovery path.
    expect(
      screen.getByText(/关闭后无法再次查看.*丢了只能新建/),
    ).toBeInTheDocument();
  });

  it('does NOT close on backdrop click', () => {
    const onClose = vi.fn();
    const { container } = render(
      <RevealKeyModal open={true} onClose={onClose} created={sample} />,
    );
    const backdrop = container.querySelector('[aria-hidden="true"]');
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does NOT render the × close button', () => {
    render(
      <RevealKeyModal open={true} onClose={() => {}} created={sample} />,
    );
    expect(screen.queryByLabelText('关闭')).toBeNull();
  });

  it('renders BOTH copy buttons — bare Key + full install command', () => {
    render(
      <RevealKeyModal open={true} onClose={() => {}} created={sample} />,
    );
    expect(screen.getByText('复制 API Key')).toBeInTheDocument();
    expect(screen.getByText('复制完整安装命令')).toBeInTheDocument();
  });

  it('「复制完整安装命令」 puts both lines on the clipboard', async () => {
    render(
      <RevealKeyModal open={true} onClose={() => {}} created={sample} />,
    );
    fireEvent.click(screen.getByText('复制完整安装命令'));
    await vi.waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        'set up tokenboss.co/skill.md\nTOKENBOSS_API_KEY=sk-PLAINTEXT-FOREVER',
      ),
    );
  });

  it('ack button is DISABLED until at least one copy fires', () => {
    render(
      <RevealKeyModal open={true} onClose={() => {}} created={sample} />,
    );
    expect(screen.getByText('我已保存好，关闭')).toBeDisabled();
    expect(screen.getByText(/请先复制 Key/)).toBeInTheDocument();
  });

  it('after a successful copy, ack button enables and closes on click', async () => {
    const onClose = vi.fn();
    render(
      <RevealKeyModal open={true} onClose={onClose} created={sample} />,
    );
    // Initially disabled.
    expect(screen.getByText('我已保存好，关闭')).toBeDisabled();
    // Click any copy button.
    fireEvent.click(screen.getByText('复制 API Key'));
    // Wait for clipboard.writeText to resolve and re-render.
    await vi.waitFor(() =>
      expect(screen.getByText('我已保存好，关闭')).not.toBeDisabled(),
    );
    // The "请先复制 Key" hint should be gone.
    expect(screen.queryByText(/请先复制 Key/)).toBeNull();
    // Now ack works — closes the modal. No platform-side persistence
    // happens (cache machinery was removed in favor of show-once).
    fireEvent.click(screen.getByText('我已保存好，关闭'));
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
