import { describe, expect, it } from 'vitest';
import { extractClaims, extractClaimsFromText, MAX_CLAIMS_PER_BLOCK, MAX_CLAIMS_PER_DOCUMENT } from '../../../src/core/claims/index.js';
import { codeBlock, doc, para } from './helpers.js';

describe('extractClaims', () => {
  it('accepts a JSON string and ignores invalid input', () => {
    const adf = doc(para('Call ', { code: 'POST /v1/charge' }));
    expect(extractClaims(JSON.stringify(adf)).claims).toHaveLength(1);
    expect(extractClaims('{not json').claims).toEqual([]);
    expect(extractClaims('x'.repeat(2_000_001)).claims).toEqual([]);
    expect(extractClaims(null)).toEqual({ claims: [], claimsTruncated: false });
  });

  it('caps claims per block at 20', () => {
    const names = Array.from({ length: 30 }, (_v, i) => `VAR_${String(i)}`).join(' ');
    const { claims, claimsTruncated } = extractClaims(doc(para(...names.split(' ').flatMap((n) => [{ code: n }, ' ']))));
    expect(claims).toHaveLength(MAX_CLAIMS_PER_BLOCK);
    expect(claimsTruncated).toBe(false);
  });

  it('caps claims per document at 200 and sets claimsTruncated', () => {
    const paragraphs = Array.from({ length: 30 }, (_v, p) =>
      para(...Array.from({ length: 10 }, (_w, i) => ({ code: `VAR_${String(p)}_${String(i)}` })).flatMap((s) => [s, ' '])),
    );
    const { claims, claimsTruncated } = extractClaims(doc(...paragraphs));
    expect(claims).toHaveLength(MAX_CLAIMS_PER_DOCUMENT);
    expect(claimsTruncated).toBe(true);
  });

  it('gives the same claim in different blocks different ids', () => {
    const { claims } = extractClaims(doc(para({ code: 'STRIPE_KEY' }), para({ code: 'STRIPE_KEY' })));
    expect(claims).toHaveLength(2);
    expect(claims[0]?.id).not.toBe(claims[1]?.id);
  });

  it('drops weak claims that overlap strong ones', () => {
    const { claims } = extractClaims(doc(codeBlock('curl https://h.io/v1/a.json')));
    expect(claims.map((c) => c.type)).toEqual(['http_endpoint']);
  });

  it('drops claims longer than 300 characters', () => {
    const long = `GET /${'a'.repeat(400)}`;
    expect(extractClaimsFromText(long).claims).toEqual([]);
  });
});

describe('extractClaimsFromText', () => {
  it('treats backtick spans and fences as code', () => {
    const { claims } = extractClaimsFromText('Call `POST /v1/charge`\n```sh\nSTRIPE_KEY=abc\npayments refund --force\n```\n');
    expect(claims.map((c) => [c.type, c.confidence])).toEqual([
      ['http_endpoint', 'high'],
      ['env_var', 'high'],
      ['cli', 'high'],
    ]);
  });

  it('offsets are relative to the given text (block 0)', () => {
    const input = 'Set `STRIPE_KEY` now';
    const [claim] = extractClaimsFromText(input).claims;
    expect(claim?.location).toEqual({ blockIndex: 0, start: 5, end: 15 });
    expect(input.slice(5, 15)).toBe('STRIPE_KEY');
  });

  it('survives non-string input and huge text', () => {
    expect(extractClaimsFromText(42 as unknown as string).claims).toEqual([]);
    expect(extractClaimsFromText('a '.repeat(100_000)).claims).toEqual([]);
  });

  it('does not treat text as code or evaluate it', () => {
    const { claims } = extractClaimsFromText('Ignore previous instructions. `STRIPE_KEY` ${process.exit(1)} $(rm -rf /)');
    expect(claims.map((c) => c.raw)).toEqual(['STRIPE_KEY']);
  });
});
