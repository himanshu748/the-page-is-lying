import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Forge's bundler does not map `./x.js` to `./x.ts`: a relative import with a .js extension breaks `forge deploy`. */
function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe('bundler-safe imports', () => {
  it('no relative import under src ends in .js', () => {
    const bad = files(join(import.meta.dirname, '..', '..', 'src')).filter((f) => /from\s+'\.{1,2}\/[^']*\.js'/.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
});
