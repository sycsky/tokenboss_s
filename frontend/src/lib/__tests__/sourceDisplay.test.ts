import { describe, it, expect } from 'vitest';
import { formatSource } from '../sourceDisplay';

describe('formatSource', () => {
  it('renders the 4 known agent slugs as their brand-correct display names', () => {
    expect(formatSource('openclaw')).toBe('OpenClaw');
    expect(formatSource('hermes')).toBe('Hermes');
    expect(formatSource('claude-code')).toBe('Claude Code');
    expect(formatSource('codex')).toBe('Codex');
  });

  it("renders 'other' as 'Other'", () => {
    expect(formatSource('other')).toBe('Other');
  });

  it('title-cases unknown slugs (third-party agents)', () => {
    expect(formatSource('random-test')).toBe('Random Test');
    expect(formatSource('my-bot')).toBe('My Bot');
    expect(formatSource('singleword')).toBe('Singleword');
  });

  it('returns — for null / undefined / empty', () => {
    expect(formatSource(null)).toBe('—');
    expect(formatSource(undefined)).toBe('—');
    expect(formatSource('')).toBe('—');
    expect(formatSource('   ')).toBe('—');
  });

  it('handles uppercase input via lowercase-first', () => {
    expect(formatSource('OpenClaw')).toBe('OpenClaw');  // re-cased via display map
    expect(formatSource('OTHER')).toBe('Other');
  });
});
