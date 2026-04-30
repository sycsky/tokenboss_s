import { describe, it, expect, beforeAll } from 'vitest';

process.env.SESSION_SECRET = 'test-secret-32bytes-min-aaaaaaaaaaa';
process.env.SQLITE_PATH = ':memory:';

import { init, db } from '../store.js';

beforeAll(() => {
  init();
});

describe('usage_attribution table — schema', () => {
  it('exists with the required columns + types', () => {
    const cols = db
      .prepare(`PRAGMA table_info(usage_attribution)`)
      .all() as { name: string; type: string; notnull: number; pk: number }[];
    const byName = new Map(cols.map((c) => [c.name, c]));
    expect(byName.get('requestId')?.pk).toBe(1);
    expect(byName.get('requestId')?.type).toBe('TEXT');
    expect(byName.get('userId')?.notnull).toBe(1);
    expect(byName.get('userId')?.type).toBe('TEXT');
    expect(byName.get('source')?.notnull).toBe(1);
    expect(byName.get('sourceMethod')?.notnull).toBe(1);
    expect(byName.get('model')).toBeDefined();
    expect(byName.get('capturedAt')?.notnull).toBe(1);
    expect(byName.get('capturedAt')?.type).toBe('TEXT');
  });

  it('rejects source / sourceMethod longer than 32 chars (CHECK constraint)', () => {
    const baseInsert = (source: string, sourceMethod: string, model: string | null) =>
      db.prepare(
        `INSERT INTO usage_attribution (requestId, userId, source, sourceMethod, model, capturedAt) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run('tb-aaaaaaaa', 'u_x', source, sourceMethod, model, new Date().toISOString());
    expect(() => baseInsert('a'.repeat(40), 'header', 'gpt-4o')).toThrow();
    expect(() => baseInsert('openclaw', 'a'.repeat(40), 'gpt-4o')).toThrow();
    expect(() => baseInsert('openclaw', 'header', 'a'.repeat(200))).toThrow();
  });

  it('has the user+time index for soft-join queries (PK index for requestId is implicit, not duplicated)', () => {
    const idx = db
      .prepare(`PRAGMA index_list(usage_attribution)`)
      .all() as { name: string }[];
    const names = new Set(idx.map((i) => i.name));
    // We rely on SQLite's implicit PK index for requestId lookups; only
    // need to verify our explicit secondary index for soft-join.
    expect(names.has('idx_attribution_user_time')).toBe(true);
  });
});
