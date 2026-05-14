/**
 * Integration test for the gh-3 rewrite of `/install/manual`.
 *
 * The page composes 4 visual sections:
 *   1. Hero — CCSwitchDetector card
 *   2. Main — KeyInjectionFlow (branches on auth state)
 *   3. Footer — ProtocolFamilyLinks (3 cards)
 *   4. Disclosure — AdvancedManualRecipes (closed by default)
 *
 * We mock `useAuth` to the unauthenticated state so KeyInjectionFlow
 * renders the AnonKeyPasteInput branch — picking auth here is enough
 * to exercise the page-level wiring; the inner components have their
 * own component-level tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import * as authModule from '../../lib/auth';
import ManualConfigPC from '../ManualConfigPC';

beforeEach(() => {
  vi.restoreAllMocks();
  // Anonymous visitor → KeyInjectionFlow → AnonKeyPasteInput branch.
  vi.spyOn(authModule, 'useAuth').mockReturnValue({
    user: null,
    token: null,
  } as any);
});

describe('ManualConfigPC', () => {
  it('renders Hero with CCSwitchDetector + KeyInjectionFlow + ProtocolFamilyLinks + collapsed AdvancedManualRecipes', () => {
    render(
      <MemoryRouter>
        <ManualConfigPC />
      </MemoryRouter>,
    );

    // Step 1 — CCSwitchDetector copy (post P0-2/P0-3 hot-fix: now framed
    // as "Step 1: 先装 CC Switch" not "还没装").
    expect(screen.getByText(/先装 CC Switch/i)).toBeInTheDocument();

    // KeyInjectionFlow (anon branch) — AnonKeyPasteInput renders the label.
    expect(screen.getByLabelText(/API Key/i)).toBeInTheDocument();

    // ProtocolFamilyLinks — 3 cards.
    expect(screen.getByText(/OpenAI-compat 协议/i)).toBeInTheDocument();
    expect(screen.getByText(/Claude 协议/i)).toBeInTheDocument();
    expect(screen.getByText(/Gemini 协议/i)).toBeInTheDocument();

    // AdvancedManualRecipes disclosure — closed by default.
    const summary = screen.getByText(/高级 · 手动配置/i);
    const details = summary.closest('details');
    expect(details).not.toBeNull();
    expect(details!.open).toBe(false);
  });
});
