import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

async function lint(code: string, filePath: string) {
  const eslint = new ESLint({ cwd: import.meta.dirname + '/../..' });
  const [result] = await eslint.lintText(code, { filePath });
  return result?.messages ?? [];
}

describe('src/core purity rule', () => {
  it('rejects @forge/api imports under src/core', async () => {
    const messages = await lint("import { kvs } from '@forge/api';\nexport const x = kvs;\n", 'src/core/_probe.ts');
    expect(messages.some((m) => m.ruleId === 'no-restricted-imports')).toBe(true);
  });

  it('rejects node network modules under src/core', async () => {
    const messages = await lint("import https from 'node:https';\nexport const x = https;\n", 'src/core/_probe.ts');
    expect(messages.some((m) => m.ruleId === 'no-restricted-imports')).toBe(true);
  });

  it('allows @forge/api outside src/core', async () => {
    const messages = await lint("import { kvs } from '@forge/api';\nexport const x = kvs;\n", 'src/storage/_probe.ts');
    expect(messages.some((m) => m.ruleId === 'no-restricted-imports')).toBe(false);
  });
});
