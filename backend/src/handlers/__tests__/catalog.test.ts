import { describe, it, expect } from 'vitest';
import { catalogJsonHandler } from '../catalogJson.js';

describe('GET /api/catalog.json', () => {
  it('returns array of models with id and price', async () => {
    const res = await catalogJsonHandler({} as any);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(Array.isArray(body.models)).toBe(true);
    expect(body.models.length).toBeGreaterThan(0);
    expect(body.models[0]).toMatchObject({
      id: expect.any(String),
    });
    expect(body.generatedAt).toEqual(expect.any(String));
  });

  it('returns Content-Type application/json with CORS', async () => {
    const res = await catalogJsonHandler({} as any);
    expect(res.headers?.['Content-Type']).toBe('application/json');
    expect(res.headers?.['Access-Control-Allow-Origin']).toBe('*');
  });
});
