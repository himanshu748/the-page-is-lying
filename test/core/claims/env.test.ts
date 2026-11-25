import { describe, expect, it } from 'vitest';
import type { NormalizedClaim } from '../../../src/core/model.js';
import { allFromText, codeBlock, doc, fromAdf, fromText } from './helpers.js';

const env = (name: string): NormalizedClaim => ({ type: 'env_var', name });

describe('env_var extraction', () => {
  it.each<[string, string, string[]]>([
    ['code span', 'Set `STRIPE_KEY` first.', ['STRIPE_KEY']],
    ['code span assignment', 'Run `PAYMENTS_API_KEY=abc payments serve`', ['PAYMENTS_API_KEY']],
    ['export in code span', 'Run `export DATABASE_URL=postgres://x`', ['DATABASE_URL']],
    ['dollar in prose', 'Read $DATABASE_URL at start.', ['DATABASE_URL']],
    ['braces in prose', 'Read ${DATABASE_URL:-x} at start.', ['DATABASE_URL']],
    ['export in prose', 'Please export API_TOKEN before running.', ['API_TOKEN']],
    ['process.env', 'The code reads process.env.PAYMENTS_API_KEY.', ['PAYMENTS_API_KEY']],
    ['process.env bracket', "The code reads process.env['LOG_LEVEL'].", ['LOG_LEVEL']],
    ['os.environ', "Python reads os.environ['LOG_LEVEL'].", ['LOG_LEVEL']],
    ['digits', 'Set `S3_BUCKET_2` first.', ['S3_BUCKET_2']],
    ['stop-listed name with explicit cue', 'Use $HTTP_OK here.', ['HTTP_OK']],
    ['two vars', 'Set `A_B` and `C_D`.', ['A_B', 'C_D']],
    ['single name with process.env', 'It reads process.env.PORT.', ['PORT']],
    ['single name with a dollar', 'Listen on $PORT.', ['PORT']],
    ['single name exported', 'export HOST=localhost before starting.', ['HOST']],
  ])('%s', (_name, input, expected) => {
    expect(fromText(input, 'env_var')).toEqual(expected.map(env));
  });

  it.each<[string, string]>([
    ['prose constant', 'The HTTP_OK status is fine.'],
    ['plain prose all caps', 'See MAX_RETRIES in the docs.'],
    ['stop-listed code span', 'Returns `HTTP_OK` on success.'],
    ['no underscore', 'Set `STRIPE` first.'],
    ['lowercase', 'Set `stripe_key` first.'],
    ['mixed case', 'Set `Stripe_Key` first.'],
    ['embedded in a longer identifier', 'Set `my_STRIPE_KEY` first.'],
    ['code span with extra words', 'Run `see MAX_RETRIES here`'],
    ['prose assignment', 'Use FOO_BAR=1 maybe.'],
    ['version-like constants', 'Use `UTF_8` encoding.'],
    ['too long', `Set \`${'A'.repeat(40)}_${'B'.repeat(40)}\` first.`],
  ])('negative: %s', (_name, input) => {
    expect(fromText(input, 'env_var')).toEqual([]);
  });

  it('KEY=value lines in code blocks', () => {
    const adf = doc(codeBlock('# .env\nSTRIPE_KEY=abc\nexport DATABASE_URL=x\nLOG_LEVEL = debug\nMAX_RETRIES'));
    expect(fromAdf(adf, 'env_var')).toEqual([env('STRIPE_KEY'), env('DATABASE_URL'), env('MAX_RETRIES')]);
  });

  it('records the name offsets, not the cue', () => {
    const [claim] = allFromText('Read $DATABASE_URL now.');
    expect(claim?.raw).toBe('DATABASE_URL');
    expect(claim?.confidence).toBe('medium');
  });
});
