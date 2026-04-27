import { describe, it, expect, beforeEach } from 'vitest';
import {
  init,
  putApiKeyIndex,
  getUserIdByKeyHash,
  deleteApiKeyIndex,
} from '../store.js';

beforeEach(() => {
  process.env.SQLITE_PATH = ':memory:';
  init();
});

describe('api_key_index', () => {
  it('returns the userId for a known hash', () => {
    putApiKeyIndex({ userId: 'u_alice', newapiTokenId: 7, keyHash: 'h_alice_1' });
    expect(getUserIdByKeyHash('h_alice_1')).toBe('u_alice');
  });

  it('returns null for an unknown hash', () => {
    expect(getUserIdByKeyHash('nope')).toBeNull();
  });

  it('supports multiple keys per user', () => {
    putApiKeyIndex({ userId: 'u_bob', newapiTokenId: 1, keyHash: 'h1' });
    putApiKeyIndex({ userId: 'u_bob', newapiTokenId: 2, keyHash: 'h2' });
    expect(getUserIdByKeyHash('h1')).toBe('u_bob');
    expect(getUserIdByKeyHash('h2')).toBe('u_bob');
  });

  it('deletes by (userId, tokenId) without needing the hash', () => {
    putApiKeyIndex({ userId: 'u_eve', newapiTokenId: 9, keyHash: 'h_eve' });
    expect(getUserIdByKeyHash('h_eve')).toBe('u_eve');
    deleteApiKeyIndex('u_eve', 9);
    expect(getUserIdByKeyHash('h_eve')).toBeNull();
  });

  it('upserts on conflict (userId, tokenId)', () => {
    // Edge case: token id reused after a delete-and-recreate cycle. New hash
    // must replace the old row, not collide on the PK.
    putApiKeyIndex({ userId: 'u_dan', newapiTokenId: 5, keyHash: 'h_old' });
    putApiKeyIndex({ userId: 'u_dan', newapiTokenId: 5, keyHash: 'h_new' });
    expect(getUserIdByKeyHash('h_old')).toBeNull();
    expect(getUserIdByKeyHash('h_new')).toBe('u_dan');
  });

  it('delete is a no-op for unknown rows', () => {
    expect(() => deleteApiKeyIndex('u_ghost', 99)).not.toThrow();
  });
});
