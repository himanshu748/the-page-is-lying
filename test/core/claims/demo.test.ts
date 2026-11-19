import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractClaims } from '../../../src/core/claims/index.js';
import { walkAdf } from '../../../src/core/adf/walk.js';
import type { NormalizedClaim } from '../../../src/core/model.js';

function load(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../../fixtures/claims/${name}`, import.meta.url), 'utf8')) as unknown;
}

const expectedSecond: NormalizedClaim[] = [
  { type: 'http_endpoint', method: 'GET', path: '/v2/payments/:param' },
  { type: 'env_var', name: 'STRIPE_KEY' },
  { type: 'cli', program: 'npm', subcommands: ['run', 'db:migrate'], flags: [] },
  { type: 'cli', program: 'payments', subcommands: ['refund'], flags: ['--force'] },
  { type: 'cli', program: 'ledgerctl', subcommands: ['reconcile'], flags: ['--since'] },
];

describe('demo runbook (PLAN.md 10.2)', () => {
  it('yields exactly the six expected claims, in page order', () => {
    const { claims, claimsTruncated } = extractClaims(load('payments-runbook.adf.json'));
    expect(claimsTruncated).toBe(false);
    expect(claims.map((c) => c.raw)).toEqual([
      'POST /v1/charge',
      'GET /v2/payments/{id}',
      'STRIPE_KEY',
      'npm run db:migrate',
      'payments refund <paymentId> --force',
      'ledgerctl reconcile --since 24h',
    ]);
    expect(claims.map((c) => c.type)).toEqual(['http_endpoint', 'http_endpoint', 'env_var', 'cli', 'cli', 'cli']);
    expect(claims.map((c) => c.normalized)).toEqual([
      { type: 'http_endpoint', method: 'POST', path: '/v1/charge' },
      ...expectedSecond,
    ]);
    expect(claims.every((c) => c.confidence === 'high')).toBe(true);
  });

  it('the fixed page changes only claim 1', () => {
    const { claims } = extractClaims(load('payments-runbook-fixed.adf.json'));
    expect(claims).toHaveLength(6);
    expect(claims[0]?.raw).toBe('POST /v2/payments');
    expect(claims[0]?.normalized).toEqual({ type: 'http_endpoint', method: 'POST', path: '/v2/payments' });
    expect(claims.slice(1).map((c) => c.normalized)).toEqual(expectedSecond);
  });

  it('locations point at the exact substring of the walked block', () => {
    const adf = load('payments-runbook.adf.json');
    const blocks = walkAdf(adf);
    for (const claim of extractClaims(adf).claims) {
      const block = blocks[claim.location.blockIndex];
      expect(block?.text.slice(claim.location.start, claim.location.end)).toBe(claim.raw);
    }
  });

  it('ids are stable across runs and unique', () => {
    const adf = load('payments-runbook.adf.json');
    const a = extractClaims(adf).claims.map((c) => c.id);
    const b = extractClaims(adf).claims.map((c) => c.id);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
    for (const id of a) expect(id).toMatch(/^c_[0-9a-f]{8}$/);
  });

  it('claim 1 keeps its id only when it is unchanged (the fixed page gets a new id)', () => {
    const before = extractClaims(load('payments-runbook.adf.json')).claims;
    const after = extractClaims(load('payments-runbook-fixed.adf.json')).claims;
    expect(after[0]?.id).not.toBe(before[0]?.id);
    expect(after[1]?.id).toBe(before[1]?.id);
  });
});
