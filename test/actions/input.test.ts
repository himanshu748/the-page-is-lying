import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { clean, parsePageReference, resolvePageId, validateClaim } from '../../src/actions/input';

describe('validateClaim', () => {
  it('accepts a normal claim and strips control characters', () => {
    expect(validateClaim('POST /v1/charge')).toEqual({ ok: true, claim: 'POST /v1/charge' });
    expect(validateClaim('  STRIPE_KEY\u0000\u202E\n')).toEqual({ ok: true, claim: 'STRIPE_KEY' });
  });

  it('rejects missing, non-string, empty and over-long claims', () => {
    expect(validateClaim(undefined)).toMatchObject({ ok: false, detail: 'claim_missing' });
    expect(validateClaim(42)).toMatchObject({ ok: false, detail: 'claim_missing' });
    expect(validateClaim('  \u0007 ')).toMatchObject({ ok: false, detail: 'claim_empty' });
    expect(validateClaim('a'.repeat(301))).toMatchObject({ ok: false, detail: 'claim_too_long' });
    expect(validateClaim('a'.repeat(300))).toMatchObject({ ok: true });
    expect(validateClaim('a'.repeat(100_000))).toMatchObject({ ok: false, detail: 'claim_too_long' });
  });

  it('never returns control characters', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 300 }), (text) => {
        const r = validateClaim(text);
        if (r.ok) {
          // eslint-disable-next-line no-control-regex
          expect(/[\u0000-\u001F\u007F-\u009F]/.test(r.claim)).toBe(false);
          expect(r.claim.length).toBeLessThanOrEqual(300);
        }
      }),
      { numRuns: 500 },
    );
  });
});

describe('parsePageReference', () => {
  it('accepts a numeric id', () => {
    expect(parsePageReference('123456')).toEqual({ ok: true, id: '123456', source: 'input' });
  });

  it('extracts the id from a Confluence page URL', () => {
    const url = 'https://one-atlas-obka.atlassian.net/wiki/spaces/ENG/pages/98765/Payments+API+runbook';
    expect(parsePageReference(url)).toEqual({ ok: true, id: '98765', source: 'input' });
    expect(parsePageReference('https://x.atlassian.net/wiki/pages/viewpage.action?pageId=555')).toMatchObject({ ok: true, id: '555' });
  });

  it('rejects other hosts, other schemes and credentials', () => {
    expect(parsePageReference('https://evil.example.com/wiki/spaces/A/pages/1/T')).toMatchObject({ ok: false, detail: 'page_host_not_allowed' });
    expect(parsePageReference('http://x.atlassian.net/wiki/spaces/A/pages/1/T')).toMatchObject({ ok: false, detail: 'page_not_a_page_reference' });
    expect(parsePageReference('https://u:p@x.atlassian.net/wiki/spaces/A/pages/1/T')).toMatchObject({ ok: false });
    expect(parsePageReference('https://x.atlassian.net.evil.com/wiki/spaces/A/pages/1/T')).toMatchObject({ ok: false, detail: 'page_host_not_allowed' });
  });

  it('requires the payload site host when the context carries it', () => {
    const site = 'https://one-atlas-obka.atlassian.net/wiki/spaces/ENG/pages/1/T';
    expect(parsePageReference('https://other.atlassian.net/wiki/spaces/ENG/pages/2/T', site)).toMatchObject({ ok: false, detail: 'page_host_not_allowed' });
    expect(parsePageReference('https://one-atlas-obka.atlassian.net/wiki/spaces/ENG/pages/2/T', site)).toMatchObject({ ok: true, id: '2' });
  });

  it('rejects garbage, zero, leading zeros, long ids and long text', () => {
    for (const bad of ['', 'abc', '0', '012', '1'.repeat(20), '1; DROP', '../../etc/passwd', '123/../4']) {
      expect(parsePageReference(bad).ok).toBe(false);
    }
    expect(parsePageReference('x'.repeat(501))).toMatchObject({ ok: false, detail: 'page_too_long' });
  });

  it('only ever yields digit-only ids', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 200 }), (text) => {
        const r = parsePageReference(text);
        if (r.ok) expect(r.id).toMatch(/^[1-9][0-9]{0,18}$/);
      }),
      { numRuns: 500 },
    );
  });
});

describe('resolvePageId (context first)', () => {
  it('uses the context contentId even when the LLM input names another page', () => {
    const r = resolvePageId('999', { confluence: { contentId: '123' } }, { required: true });
    expect(r).toEqual({ ok: true, id: '123', source: 'context' });
  });

  it('does not even validate the input when the context has an id', () => {
    const r = resolvePageId('https://evil.example.com/x', { confluence: { contentId: '123' } }, { required: true });
    expect(r).toEqual({ ok: true, id: '123', source: 'context' });
  });

  it('falls back to validated input without context and reports source input', () => {
    expect(resolvePageId('456', undefined, { required: true })).toEqual({ ok: true, id: '456', source: 'input' });
    expect(resolvePageId(789, {}, { required: true })).toEqual({ ok: true, id: '789', source: 'input' });
  });

  it('ignores a malformed context id and uses the input', () => {
    expect(resolvePageId('456', { confluence: { contentId: 'abc' } }, { required: true })).toMatchObject({ ok: true, id: '456', source: 'input' });
  });

  it('requires a page when asked to, and allows none otherwise', () => {
    expect(resolvePageId(undefined, {}, { required: true })).toMatchObject({ ok: false, detail: 'page_missing' });
    expect(resolvePageId('', undefined, { required: false })).toEqual({ ok: true, id: null, source: null });
    expect(resolvePageId({ id: 1 }, undefined, { required: false })).toMatchObject({ ok: false });
  });
});

describe('clean', () => {
  it('strips controls and bidi marks, collapses line breaks and truncates with an ellipsis', () => {
    expect(clean('a\u0000b\u202Ec\nd', 50)).toBe('abc d');
    expect(clean('x'.repeat(20), 10)).toBe(`${'x'.repeat(9)}\u2026`);
    expect(clean('x'.repeat(20), 10).length).toBe(10);
  });
});
