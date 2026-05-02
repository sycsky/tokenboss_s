import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  setCachedKey,
  getCachedKey,
  clearAllCachedKeys,
  sweepCachedKeys,
} from '../keyCache';

beforeEach(() => {
  localStorage.clear();
});

describe('clearAllCachedKeys', () => {
  it('removes all entries for the given email', () => {
    setCachedKey('alice@x.com', 'k1', 'sk-A');
    setCachedKey('alice@x.com', 'k2', 'sk-B');
    setCachedKey('bob@x.com', 'k3', 'sk-C');

    clearAllCachedKeys('alice@x.com');

    expect(getCachedKey('alice@x.com', 'k1')).toBeNull();
    expect(getCachedKey('alice@x.com', 'k2')).toBeNull();
    expect(getCachedKey('bob@x.com', 'k3')).toBe('sk-C');
  });

  it('is a no-op when email is undefined', () => {
    setCachedKey('alice@x.com', 'k1', 'sk-A');
    clearAllCachedKeys(undefined);
    expect(getCachedKey('alice@x.com', 'k1')).toBe('sk-A');
  });

  it('is a no-op when email has no matching entries', () => {
    setCachedKey('alice@x.com', 'k1', 'sk-A');
    clearAllCachedKeys('nobody@x.com');
    expect(getCachedKey('alice@x.com', 'k1')).toBe('sk-A');
  });
});

describe('sweepCachedKeys', () => {
  it('drops cache entries whose keyId is not in presentIds', () => {
    setCachedKey('alice@x.com', 'k-survive', 'sk-A');
    setCachedKey('alice@x.com', 'k-orphan-1', 'sk-B');
    setCachedKey('alice@x.com', 'k-orphan-2', 'sk-C');

    sweepCachedKeys('alice@x.com', new Set(['k-survive']));

    expect(getCachedKey('alice@x.com', 'k-survive')).toBe('sk-A');
    expect(getCachedKey('alice@x.com', 'k-orphan-1')).toBeNull();
    expect(getCachedKey('alice@x.com', 'k-orphan-2')).toBeNull();
  });

  it('does not touch other users entries', () => {
    setCachedKey('alice@x.com', 'k1', 'sk-A');
    setCachedKey('bob@x.com', 'k1', 'sk-B');
    sweepCachedKeys('alice@x.com', new Set()); // wipes all of alice's
    expect(getCachedKey('alice@x.com', 'k1')).toBeNull();
    expect(getCachedKey('bob@x.com', 'k1')).toBe('sk-B');
  });

  it('is a no-op when email is undefined', () => {
    setCachedKey('alice@x.com', 'k1', 'sk-A');
    sweepCachedKeys(undefined, new Set());
    expect(getCachedKey('alice@x.com', 'k1')).toBe('sk-A');
  });
});

describe('private mode / disabled localStorage', () => {
  // Simulate Safari private-mode-style failures where localStorage methods
  // throw QuotaExceededError or similar. None of the cache APIs should
  // surface the error to callers.
  let originalGetItem: typeof Storage.prototype.getItem;
  let originalSetItem: typeof Storage.prototype.setItem;
  let originalRemoveItem: typeof Storage.prototype.removeItem;

  beforeEach(() => {
    originalGetItem = Storage.prototype.getItem;
    originalSetItem = Storage.prototype.setItem;
    originalRemoveItem = Storage.prototype.removeItem;
  });

  afterEach(() => {
    Storage.prototype.getItem = originalGetItem;
    Storage.prototype.setItem = originalSetItem;
    Storage.prototype.removeItem = originalRemoveItem;
  });

  it('getCachedKey returns null instead of throwing', () => {
    Storage.prototype.getItem = vi.fn(() => {
      throw new Error('SecurityError: localStorage disabled');
    });
    expect(() => getCachedKey('alice@x.com', 'k1')).not.toThrow();
    expect(getCachedKey('alice@x.com', 'k1')).toBeNull();
  });

  it('setCachedKey swallows the error', () => {
    Storage.prototype.setItem = vi.fn(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => setCachedKey('alice@x.com', 'k1', 'sk-A')).not.toThrow();
  });

  it('clearAllCachedKeys swallows the error', () => {
    Storage.prototype.removeItem = vi.fn(() => {
      throw new Error('SecurityError');
    });
    // Plant a real entry first so the iteration has something to find
    setCachedKey('alice@x.com', 'k1', 'sk-A');
    expect(() => clearAllCachedKeys('alice@x.com')).not.toThrow();
  });

  it('sweepCachedKeys swallows the error', () => {
    Storage.prototype.removeItem = vi.fn(() => {
      throw new Error('SecurityError');
    });
    setCachedKey('alice@x.com', 'k-orphan', 'sk-A');
    expect(() => sweepCachedKeys('alice@x.com', new Set())).not.toThrow();
  });
});
