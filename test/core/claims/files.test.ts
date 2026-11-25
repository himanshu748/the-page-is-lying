import { describe, expect, it } from 'vitest';
import { normalizeFilePath } from '../../../src/core/claims/files.js';
import type { NormalizedClaim } from '../../../src/core/model.js';
import { allFromText, fromText } from './helpers.js';

const file = (path: string): NormalizedClaim => ({ type: 'file_path', path });

describe('normalizeFilePath', () => {
  it.each<[string, string | null]>([
    ['./scripts/seed.sh', 'scripts/seed.sh'],
    ['/src/routes.ts', 'src/routes.ts'],
    ['src//a/./b.ts', 'src/a/b.ts'],
    ['Src/Routes.ts', 'Src/Routes.ts'],
    ['src/', 'src/'],
    ['../secret.txt', null],
    ['a/../b', null],
    ['..', null],
    ['', null],
    ['/', null],
    ['.', null],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeFilePath(input)).toBe(expected);
  });
});

describe('file_path extraction', () => {
  it.each<[string, string, string[]]>([
    ['code span', 'See `src/routes.ts`.', ['src/routes.ts']],
    ['prose', 'See src/routes.ts for details.', ['src/routes.ts']],
    ['line suffix dropped', 'See `src/routes.ts:88`.', ['src/routes.ts']],
    ['leading ./', 'Run `./scripts/seed.sh`', ['scripts/seed.sh']],
    ['config file', 'Edit config/default.yaml first.', ['config/default.yaml']],
    ['single segment file', 'Edit `package.json`.', ['package.json']],
    ['directory', 'Look in `src/handlers/`', ['src/handlers/']],
    ['dotfile', 'Copy `.env.example` to `.env`', ['.env.example', '.env']],
    ['known names', 'Use `Dockerfile` and docker/Makefile', ['Dockerfile', 'docker/Makefile']],
    ['path as a flag value', 'Run `node --config=config/app.toml`', ['config/app.toml']],
    ['case kept', 'Open `Src/Routes.TS`', ['Src/Routes.TS']],
    ['two in one sentence', 'Move a/b.ts to c/d.ts.', ['a/b.ts', 'c/d.ts']],
    ['bare filename in code', 'Open `db.json`.', ['db.json']],
  ])('%s', (_name, input, expected) => {
    expect(fromText(input, 'file_path')).toEqual(expected.map(file));
  });

  it.each<[string, string]>([
    ['url', 'See https://example.com/docs/guide.md for more.'],
    ['system path', 'Edit /etc/hosts.conf and /usr/local/x.sh'],
    ['parent segment', 'Open `../../secret.json`'],
    ['embedded parent segment', 'Open `a/../b.json`'],
    ['product name', 'Needs Node.js and Vue.js.'],
    ['sentence end', 'It works. Then stop.'],
    ['version', 'Use version 1.2.3'],
    ['email', 'Mail dev@example.com'],
    ['no extension', 'either/or and/or w/o'],
    ['unknown extension', 'Open `data/file.zzzz`'],
    ['home dir', 'Open ~/notes.md'],
    ['variable', 'Open $HOME/notes.md'],
    ['bare filename in prose', 'The server looks for 404.html at runtime.'],
    ['created bare filename', 'Create `db.json` with the sample data.'],
    ['created nested path', 'Generate `fixtures/db.json` before starting the server.'],
    ['written nested path', 'The command writes output/report.json when it finishes.'],
  ])('negative: %s', (_name, input) => {
    expect(fromText(input, 'file_path')).toEqual([]);
  });

  it('does not let a previous sentence suppress a repository path', () => {
    expect(fromText('Create the fixture. Then open `src/routes.ts`.', 'file_path')).toEqual([
      file('src/routes.ts'),
    ]);
  });

  it('suppresses every generated path in the same sentence', () => {
    expect(fromText('Generate `a.json` and `fixtures/b.json`.', 'file_path')).toEqual([]);
  });

  it.each([
    'Generate files using `scripts/generate.ts`.',
    'Generate files from `src/routes.ts`.',
    'The output is defined in `src/routes.ts`.',
  ])('keeps source files in generation instructions: %s', (input) => {
    expect(fromText(input, 'file_path')).toEqual([
      file(input.includes('generate.ts') ? 'scripts/generate.ts' : 'src/routes.ts'),
    ]);
  });

  it('is high confidence in code and medium in prose', () => {
    expect(allFromText('See `a/b.ts`').map((c) => c.confidence)).toEqual(['high']);
    expect(allFromText('See a/b.ts').map((c) => c.confidence)).toEqual(['medium']);
  });

  it('does not report a path inside an http endpoint claim', () => {
    expect(fromText('Call `GET /v1/files/openapi.json`', 'file_path')).toEqual([]);
  });
});
