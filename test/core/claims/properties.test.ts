import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { walkAdf } from '../../../src/core/adf/walk.js';
import { normalizeFilePath } from '../../../src/core/claims/files.js';
import { normalizeHttpPath } from '../../../src/core/claims/http.js';
import { extractClaims, extractClaimsFromText } from '../../../src/core/claims/index.js';
import { normalizeRange } from '../../../src/core/claims/packages.js';
import { MAX_BLOCK_TEXT } from '../../../src/core/adf/walk.js';

const NUM_RUNS = 1000;
const SEED = process.env['FC_SEED'] !== undefined ? Number(process.env['FC_SEED']) : (Date.now() ^ (Math.random() * 0xffffffff)) | 0;
const params = { numRuns: NUM_RUNS, seed: SEED };

beforeAll(() => {
  // Re-run a failure with FC_SEED=<seed> npm test
  console.log(`[fast-check] seed=${String(SEED)} runs=${String(NUM_RUNS)}`);
});

const FRAGMENTS = [
  'POST', 'GET', 'DELETE', ' ', ' ', '/', '/v1/charge', '/v2/payments/{id}', '`', '```\n', '\n', '$', '${', 'export ', 'STRIPE_KEY', 'A_B', '=',
  '--force', '--since=24h', '-s', 'npm run ', 'curl -X POST ', 'https://api.example.com/v1/x?y=1#z', 'src/routes.ts', '../', '..', './', 'a/../b.ts',
  'config/default.yaml', 'retry.maxAttempts', 'express@4.18.2', 'Node.js 20 or later', 'stripe 14.x', 'payments refund ', '<id>', ':id', '#', '|', '&&', '"', "'",
];
const fragmentText = fc.array(fc.oneof(fc.constantFrom(...FRAGMENTS), fc.string({ maxLength: 8 })), { maxLength: 40 }).map((p) => p.join(''));
const anyText = fc.oneof(fc.string({ unit: 'binary', maxLength: 300 }), fragmentText);

const adfNode: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  node: fc.oneof(
    { depthSize: 'small', maxDepth: 5 },
    fc.record({ type: fc.constant('text'), text: anyText, marks: fc.option(fc.array(fc.record({ type: fc.constantFrom('code', 'strong', 'link') })), { nil: undefined }) }),
    fc.record({ type: fc.constant('hardBreak') }),
    fc.record({
      type: fc.constantFrom('doc', 'paragraph', 'heading', 'codeBlock', 'bulletList', 'listItem', 'table', 'tableRow', 'tableCell', 'blockquote', 'panel', 'bodiedExtension', 'mention'),
      content: fc.array(tie('node'), { maxLength: 4 }),
    }),
    fc.anything(),
  ),
})).node;

function checkClaims(blocks: { blockIndex: number; text: string }[], claims: ReturnType<typeof extractClaims>['claims']): void {
  const ids = new Set<string>();
  for (const claim of claims) {
    const block = blocks.find((b) => b.blockIndex === claim.location.blockIndex);
    expect(block).toBeDefined();
    expect(block?.text.slice(claim.location.start, claim.location.end)).toBe(claim.raw);
    expect(claim.raw.length).toBeGreaterThan(0);
    expect(claim.type).toBe(claim.normalized.type);
    expect(claim.id).toMatch(/^c_[0-9a-f]{8}$/);
    ids.add(claim.id);
    if (claim.normalized.type === 'http_endpoint') {
      expect(normalizeHttpPath(claim.normalized.path)).toBe(claim.normalized.path);
    }
    if (claim.normalized.type === 'file_path') {
      expect(claim.normalized.path.split('/')).not.toContain('..');
      expect(normalizeFilePath(claim.normalized.path)).toBe(claim.normalized.path);
    }
    if (claim.normalized.type === 'package_version') {
      expect(normalizeRange(claim.normalized.range)).toBe(claim.normalized.range);
    }
  }
  expect(ids.size).toBe(claims.length);
}

describe('properties', () => {
  it('never throws on arbitrary strings, and raw equals the substring at its offsets', () => {
    fc.assert(
      fc.property(anyText, (input) => {
        const { claims } = extractClaimsFromText(input);
        checkClaims([{ blockIndex: 0, text: input.slice(0, MAX_BLOCK_TEXT) }], claims);
      }),
      params,
    );
  });

  it('never throws on random ADF trees, and raw equals the block substring', () => {
    fc.assert(
      fc.property(adfNode, (adf) => {
        const { claims } = extractClaims(adf);
        checkClaims(walkAdf(adf), claims);
      }),
      params,
    );
  });

  it('extraction is deterministic', () => {
    fc.assert(
      fc.property(anyText, (input) => {
        expect(extractClaimsFromText(input)).toEqual(extractClaimsFromText(input));
      }),
      params,
    );
  });

  it('http path normalization is idempotent', () => {
    fc.assert(
      fc.property(anyText, (input) => {
        const once = normalizeHttpPath(input);
        expect(normalizeHttpPath(once)).toBe(once);
        expect(once.startsWith('/')).toBe(true);
      }),
      params,
    );
  });

  it('range normalization is idempotent', () => {
    fc.assert(
      fc.property(anyText, (input) => {
        const once = normalizeRange(input);
        expect(normalizeRange(once)).toBe(once);
      }),
      params,
    );
  });

  it('file path normalization is idempotent and never yields ".."', () => {
    const pathish = fc.array(fc.constantFrom('..', '.', '', 'a', 'b.ts', 'src', '...', '..x'), { maxLength: 8 }).map((p) => p.join('/'));
    fc.assert(
      fc.property(fc.oneof(pathish, anyText), (input) => {
        const once = normalizeFilePath(input);
        if (once === null) return;
        expect(once.split('/')).not.toContain('..');
        expect(once.startsWith('/')).toBe(false);
        expect(once.startsWith('./')).toBe(false);
        expect(normalizeFilePath(once)).toBe(once);
      }),
      params,
    );
  });

  it('every extracted file_path claim has no ".." segment, even in hostile input', () => {
    const hostile = fc.array(fc.constantFrom('../', '..', './', 'etc/', '/etc/passwd', 'a.ts', ' ', '`', '/', '%2e%2e/'), { maxLength: 20 }).map((p) => p.join(''));
    fc.assert(
      fc.property(hostile, (input) => {
        for (const claim of extractClaimsFromText(input).claims) {
          if (claim.normalized.type === 'file_path') expect(claim.normalized.path.split('/')).not.toContain('..');
        }
      }),
      params,
    );
  });

  const word = fc.stringMatching(/^[a-z]{1,8}$/);
  const segment = fc.stringMatching(/^[a-z][a-z0-9]{0,7}$/);

  it('finds generated endpoints embedded in random prose', () => {
    const method = fc.constantFrom('GET', 'POST', 'PUT', 'PATCH', 'DELETE');
    fc.assert(
      fc.property(fc.array(word, { maxLength: 5 }), method, fc.array(segment, { minLength: 1, maxLength: 4 }), fc.array(word, { maxLength: 5 }), fc.boolean(), (before, m, segs, after, asCode) => {
        const path = '/' + segs.join('/');
        const endpoint = `${m} ${path}`;
        const text = `${before.join(' ')} ${asCode ? '`' + endpoint + '`' : endpoint}${asCode ? '' : '.'} ${after.join(' ')}`;
        const found = extractClaimsFromText(text).claims.filter((c) => c.normalized.type === 'http_endpoint');
        expect(found.map((c) => c.normalized)).toContainEqual({ type: 'http_endpoint', method: m, path });
      }),
      params,
    );
  });

  it('finds generated env vars embedded in random prose (cue and code mark)', () => {
    const name = fc.tuple(fc.stringMatching(/^[A-Z]{1,5}$/), fc.stringMatching(/^[A-Z0-9]{1,6}$/)).map(([a, b]) => `V${a}_${b}`);
    fc.assert(
      fc.property(fc.array(word, { maxLength: 5 }), name, fc.array(word, { maxLength: 5 }), (before, n, after) => {
        const prose = extractClaimsFromText(`${before.join(' ')} $${n} ${after.join(' ')}`).claims;
        expect(prose.map((c) => c.normalized)).toContainEqual({ type: 'env_var', name: n });
        const adf = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: before.join(' ') + ' ' }, { type: 'text', text: n, marks: [{ type: 'code' }] }, { type: 'text', text: ' ' + after.join(' ') }] }] };
        expect(extractClaims(adf).claims.map((c) => c.normalized)).toContainEqual({ type: 'env_var', name: n });
      }),
      params,
    );
  });

  it('finds generated CLI flags embedded in random prose', () => {
    const program = segment.map((s) => `zz${s}`);
    const flag = fc.stringMatching(/^[a-z][a-z-]{1,8}[a-z]$/).map((s) => `--${s}`);
    fc.assert(
      fc.property(fc.array(word, { maxLength: 5 }), program, segment, fc.array(flag, { minLength: 1, maxLength: 3 }), fc.array(word, { maxLength: 5 }), (before, prog, sub, flags, after) => {
        const text = `${before.join(' ')} \`${prog} zz${sub} ${flags.join(' ')}\` ${after.join(' ')}`;
        const found = extractClaimsFromText(text).claims.map((c) => c.normalized);
        const unique = [...new Set(flags)];
        expect(found).toContainEqual({ type: 'cli', program: prog, subcommands: [`zz${sub}`], flags: unique });
      }),
      params,
    );
  });
});
