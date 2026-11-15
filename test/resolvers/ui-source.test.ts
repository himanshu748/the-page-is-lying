import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const uiSrc = join(import.meta.dirname, '..', '..', 'static', 'ui', 'src');

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files(full, out);
    else out.push(full);
  }
  return out;
}

describe('static/ui/src source rules', () => {
  const sources = files(uiSrc).filter((f) => /\.(ts|tsx)$/.test(f));

  it('finds the UI sources', () => {
    expect(sources.length).toBeGreaterThan(10);
  });

  it('never injects raw HTML', () => {
    for (const file of sources) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|document\.write/);
    }
  });

  it('imports @forge/bridge only through bridge.ts', () => {
    for (const file of sources.filter((f) => !f.endsWith('bridge.ts'))) {
      expect(readFileSync(file, 'utf8'), file).not.toContain("'@forge/bridge'");
    }
  });
});
