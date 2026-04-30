import { describe, it, expect } from 'vitest';
import { parseSourceHeader, parseUaSource, resolveSource } from '../sourceAttribution.js';

describe('parseSourceHeader', () => {
  it('lowercases + accepts a valid slug', () => {
    expect(parseSourceHeader('OpenClaw')).toEqual({ slug: 'openclaw', method: 'header' });
    expect(parseSourceHeader('hermes')).toEqual({ slug: 'hermes', method: 'header' });
    expect(parseSourceHeader('claude-code')).toEqual({ slug: 'claude-code', method: 'header' });
  });

  it('truncates to 32 chars', () => {
    const long = 'a'.repeat(50);
    const got = parseSourceHeader(long);
    expect(got?.slug).toHaveLength(32);
  });

  it('rejects illegal characters (returns null → fall through)', () => {
    expect(parseSourceHeader('open claw')).toBeNull();        // space
    expect(parseSourceHeader('open_claw')).toBeNull();        // underscore
    expect(parseSourceHeader('open/claw')).toBeNull();        // slash
    expect(parseSourceHeader('open.claw')).toBeNull();        // dot
    expect(parseSourceHeader('🤖')).toBeNull();                // emoji
  });

  it('returns null on undefined / empty', () => {
    expect(parseSourceHeader(undefined)).toBeNull();
    expect(parseSourceHeader('')).toBeNull();
    expect(parseSourceHeader('   ')).toBeNull();
  });
});

describe('parseUaSource', () => {
  it('matches each of the 4 known agent UA patterns', () => {
    expect(parseUaSource('openclaw-cli/1.2.3')?.slug).toBe('openclaw');
    expect(parseUaSource('Hermes-SDK/0.5.0 (linux)')?.slug).toBe('hermes');
    expect(parseUaSource('Mozilla/5.0 Claude-Code/1.0')?.slug).toBe('claude-code');
    expect(parseUaSource('codex-runtime/2.1')?.slug).toBe('codex');
  });

  it('matches case-insensitively', () => {
    expect(parseUaSource('OPENCLAW/1.0')?.slug).toBe('openclaw');
    expect(parseUaSource('claude_code/1.0')?.slug).toBe('claude-code'); // claude.?code regex
  });

  it('returns null when no pattern matches', () => {
    expect(parseUaSource('curl/8.0')).toBeNull();
    expect(parseUaSource('Mozilla/5.0 (X11; Linux)')).toBeNull();
    expect(parseUaSource(undefined)).toBeNull();
    expect(parseUaSource('')).toBeNull();
  });

  it('all matches carry method=ua', () => {
    expect(parseUaSource('openclaw/1.0')?.method).toBe('ua');
  });
});

describe('resolveSource', () => {
  it('header wins over UA', () => {
    const got = resolveSource({
      'x-source': 'codex',
      'user-agent': 'openclaw-cli/1.0',
    });
    expect(got).toEqual({ slug: 'codex', method: 'header' });
  });

  it('UA wins when no header', () => {
    expect(resolveSource({ 'user-agent': 'hermes/1.0' })).toEqual({
      slug: 'hermes',
      method: 'ua',
    });
  });

  it("falls back to 'other' when neither header nor UA matches", () => {
    expect(resolveSource({ 'user-agent': 'curl/8.0' })).toEqual({
      slug: 'other',
      method: 'fallback',
    });
    expect(resolveSource({})).toEqual({
      slug: 'other',
      method: 'fallback',
    });
  });

  it('illegal X-Source falls through to UA / fallback', () => {
    expect(resolveSource({ 'x-source': 'bad space', 'user-agent': 'openclaw/1.0' })).toEqual({
      slug: 'openclaw',
      method: 'ua',
    });
  });

  it('header lookup is case-insensitive (Lambda lowercases, but be safe)', () => {
    expect(resolveSource({ 'X-Source': 'openclaw' })).toEqual({
      slug: 'openclaw',
      method: 'header',
    });
  });
});
