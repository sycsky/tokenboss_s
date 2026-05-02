import { describe, it, expect, beforeEach } from 'vitest';
import { setCachedKey, getCachedKey, clearAllCachedKeys } from '../keyCache';

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
