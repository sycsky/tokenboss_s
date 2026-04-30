import { describe, it, expect, beforeAll } from 'vitest';

process.env.SESSION_SECRET = 'test-secret-32bytes-min-aaaaaaaaaaa';
process.env.SQLITE_PATH = ':memory:';

import { init, db } from '../store.js';

beforeAll(() => {
  init();
});

describe('usage_attribution table — schema', () => {
  it('exists with the required columns', () => {
    const cols = db.prepare(`PRAGMA table_info(usage_attribution)`).all() as { name: string; type: string; notnull: number; pk: number }[];
    const byName = new Map(cols.map((c) => [c.name, c]));
    expect(byName.get('request_id')?.pk).toBe(1);
    expect(byName.get('user_id')?.notnull).toBe(1);
    expect(byName.get('source')?.notnull).toBe(1);
    expect(byName.get('source_method')?.notnull).toBe(1);
    expect(byName.get('model')).toBeDefined();
    expect(byName.get('captured_at')?.notnull).toBe(1);
  });

  it('rejects source longer than 32 chars (CHECK constraint)', () => {
    expect(() =>
      db.prepare(
        `INSERT INTO usage_attribution (request_id, user_id, source, source_method, model, captured_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run('tb-aa', 'u_x', 'a'.repeat(40), 'header', 'gpt-4o', new Date().toISOString()),
    ).toThrow();
  });

  it('has the user_id+captured_at index for soft-join queries', () => {
    const idx = db.prepare(`PRAGMA index_list(usage_attribution)`).all() as { name: string }[];
    const names = new Set(idx.map((i) => i.name));
    expect(names.has('idx_attribution_user_time')).toBe(true);
    expect(names.has('idx_attribution_request_id')).toBe(true);
  });
});
