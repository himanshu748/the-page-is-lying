import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..');
const BANNED = /\b(wrong|safe)\b/i;

function walk(dir: string, accept: (file: string) => boolean, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, accept, out);
    else if (accept(full)) out.push(full);
  }
  return out;
}

/** String literal and template text of a TS/TSX file, plus JSX text. Comments are ignored. */
function userFacingText(source: string): string[] {
  const noComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const found: string[] = [];
  for (const m of noComments.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
    found.push(m[1] ?? m[2] ?? m[3] ?? '');
  }
  for (const m of noComments.matchAll(/>([^<>{}\n]+)</g)) found.push(m[1] ?? '');
  return found;
}

const targets: { file: string; mode: 'literals' | 'whole' }[] = [
  { file: join(root, 'src/core/wording.ts'), mode: 'literals' },
  ...walk(join(root, 'static/ui/src'), (f) => f.endsWith('.tsx')).map((file) => ({ file, mode: 'literals' as const })),
  { file: join(root, 'prompts/runbook-checker.md'), mode: 'whole' },
  ...walk(join(root, 'skills'), (f) => f.endsWith('SKILL.md')).map((file) => ({ file, mode: 'whole' as const })),
];

describe('banned words ("wrong", "safe")', () => {
  it('scans the expected files', () => {
    const names = targets.map((t) => relative(root, t.file));
    expect(names).toContain('src/core/wording.ts');
    expect(names).toContain('prompts/runbook-checker.md');
    expect(names.some((n) => n.endsWith('SKILL.md'))).toBe(true);
    expect(names.some((n) => n.endsWith('.tsx'))).toBe(true);
  });

  for (const target of targets) {
    it(`has no banned word in ${relative(root, target.file)}`, () => {
      const text = readFileSync(target.file, 'utf8');
      const chunks = target.mode === 'whole' ? [text] : userFacingText(text);
      const hits = chunks.filter((chunk) => BANNED.test(chunk));
      expect(hits).toEqual([]);
    });
  }

  it('the detector flags whole words only', () => {
    expect(BANNED.test('this is Wrong')).toBe(true);
    expect(BANNED.test('it is SAFE')).toBe(true);
    expect(BANNED.test('safeguard and wrongdoing')).toBe(false);
    expect(userFacingText("const a = 'is safe'; // wrong in a comment")).toEqual(['is safe']);
  });
});
