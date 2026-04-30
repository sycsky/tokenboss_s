import { describe, it, expect, beforeAll } from 'vitest';

process.env.SESSION_SECRET = 'test-secret-32bytes-min-aaaaaaaaaaa';
process.env.SQLITE_PATH = ':memory:';

import { init, db } from '../store.js';

beforeAll(() => {
  init();
});

import {
  insertAttribution,
  getAttributionByRequestIds,
  getAttributionsForJoin,
} from '../store.js';

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

describe('attribution helpers', () => {
  it('insertAttribution + getAttributionByRequestIds round-trip', () => {
    const now = new Date().toISOString();
    insertAttribution({
      requestId: 'tb-r-1',
      userId: 'u_alice',
      source: 'openclaw',
      sourceMethod: 'header',
      model: 'gpt-5.4-mini',
      capturedAt: now,
    });
    insertAttribution({
      requestId: 'tb-r-2',
      userId: 'u_alice',
      source: 'hermes',
      sourceMethod: 'ua',
      model: 'gpt-5.4',
      capturedAt: now,
    });
    insertAttribution({
      requestId: 'tb-r-3',
      userId: 'u_bob',
      source: 'other',
      sourceMethod: 'fallback',
      model: 'gpt-5.5',
      capturedAt: now,
    });

    const got = getAttributionByRequestIds(['tb-r-1', 'tb-r-3', 'tb-missing']);
    expect(got.size).toBe(2);
    expect(got.get('tb-r-1')?.source).toBe('openclaw');
    expect(got.get('tb-r-3')?.source).toBe('other');
    expect(got.get('tb-missing')).toBeUndefined();
  });

  it('insertAttribution is idempotent on duplicate requestId (INSERT OR IGNORE)', () => {
    const now = new Date().toISOString();
    insertAttribution({
      requestId: 'tb-dup', userId: 'u_alice', source: 'openclaw', sourceMethod: 'header', model: 'm', capturedAt: now,
    });
    // Second insert with same requestId but different source should be a no-op.
    insertAttribution({
      requestId: 'tb-dup', userId: 'u_alice', source: 'hermes', sourceMethod: 'header', model: 'm', capturedAt: now,
    });
    const got = getAttributionByRequestIds(['tb-dup']);
    expect(got.get('tb-dup')?.source).toBe('openclaw'); // first wins
  });

  it('getAttributionsForJoin filters by user + model + time window', () => {
    const t0 = new Date('2026-04-30T12:00:00Z').toISOString();
    const t3 = new Date('2026-04-30T12:00:03Z').toISOString();
    const t10 = new Date('2026-04-30T12:00:10Z').toISOString();

    insertAttribution({ requestId: 'tb-j-1', userId: 'u_join', source: 'openclaw', sourceMethod: 'header', model: 'gpt-5.4', capturedAt: t0 });
    insertAttribution({ requestId: 'tb-j-2', userId: 'u_join', source: 'hermes', sourceMethod: 'header', model: 'gpt-5.4', capturedAt: t3 });
    insertAttribution({ requestId: 'tb-j-3', userId: 'u_join', source: 'codex', sourceMethod: 'header', model: 'gpt-5.4', capturedAt: t10 });
    insertAttribution({ requestId: 'tb-j-4', userId: 'u_join', source: 'codex', sourceMethod: 'header', model: 'gpt-4o-mini', capturedAt: t3 });
    insertAttribution({ requestId: 'tb-j-5', userId: 'u_other', source: 'openclaw', sourceMethod: 'header', model: 'gpt-5.4', capturedAt: t3 });

    // Window: t0 → t3+5s = 12:00:08; u_join + model gpt-5.4
    const rows = getAttributionsForJoin('u_join', ['gpt-5.4'], t0, '2026-04-30T12:00:08.000Z');
    const ids = new Set(rows.map((r) => r.requestId));
    expect(ids.has('tb-j-1')).toBe(true); // in window, matching model+user
    expect(ids.has('tb-j-2')).toBe(true);
    expect(ids.has('tb-j-3')).toBe(false); // capturedAt > window end
    expect(ids.has('tb-j-4')).toBe(false); // wrong model
    expect(ids.has('tb-j-5')).toBe(false); // wrong user
  });

  it('getAttributionByRequestIds returns empty Map for empty input (guard)', () => {
    expect(getAttributionByRequestIds([]).size).toBe(0);
  });

  it('getAttributionsForJoin returns empty array for empty models (guard)', () => {
    expect(
      getAttributionsForJoin('u_x', [], '2026-04-30T00:00:00Z', '2026-04-30T01:00:00Z'),
    ).toEqual([]);
  });
});
