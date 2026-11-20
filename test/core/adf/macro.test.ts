import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hasRunbookMacro } from '../../../src/core/adf/macro';

const macro = (key: string, type = 'bodiedExtension') => ({ type, attrs: { extensionType: 'com.atlassian.ecosystem', extensionKey: key }, content: [] });
const doc = (...content: unknown[]) => ({ type: 'doc', content });

describe('hasRunbookMacro', () => {
  it('finds the macro in a page as Confluence stores it', () => {
    const page: unknown = JSON.parse(readFileSync('demo/confluence/payments-api-runbook.adf.json', 'utf8'));
    expect(hasRunbookMacro(page)).toBe(true);
  });

  it('matches the module key at the end of the extension key, at any depth', () => {
    expect(hasRunbookMacro(doc(macro('runbook-check')))).toBe(true);
    expect(hasRunbookMacro(doc(macro('app/env/static/runbook-check', 'extension')))).toBe(true);
    expect(hasRunbookMacro(doc({ type: 'layoutSection', content: [{ type: 'layoutColumn', content: [macro('app/env/static/runbook-check')] }] }))).toBe(true);
  });

  it('does not match other macros, look-alike keys, plain text or broken input', () => {
    expect(hasRunbookMacro(doc(macro('app/env/static/other-macro')))).toBe(false);
    expect(hasRunbookMacro(doc(macro('app/env/static/not-runbook-check')))).toBe(false);
    expect(hasRunbookMacro(doc({ type: 'paragraph', attrs: { extensionKey: 'runbook-check' }, content: [{ type: 'text', text: 'runbook-check' }] }))).toBe(false);
    expect(hasRunbookMacro(doc())).toBe(false);
    expect(hasRunbookMacro(undefined)).toBe(false);
    expect(hasRunbookMacro('runbook-check')).toBe(false);
  });
});
