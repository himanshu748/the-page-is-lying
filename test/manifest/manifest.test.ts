import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface Manifest {
  app: { id: string; runtime: { name: string } };
  permissions: { scopes: string[]; external?: { fetch?: { backend?: (string | { address: string })[] } } };
  modules: Record<string, Record<string, unknown>[]>;
  resources: { key: string; path: string }[];
}

const manifest = parse(readFileSync(join(import.meta.dirname, '..', '..', 'manifest.yml'), 'utf8')) as Manifest;
const mod = (name: string) => manifest.modules[name] ?? [];
const keys = (name: string) => mod(name).map((m) => m['key'] as string);

describe('manifest.yml contract', () => {
  it('declares every module key from PLAN.md section 4', () => {
    expect(keys('macro')).toEqual(['runbook-check']);
    expect(keys('confluence:contentBylineItem')).toEqual(['runbook-byline']);
    expect(keys('confluence:globalSettings')).toEqual(['runbook-settings']);
    expect(keys('rovo:agent')).toEqual(['runbook-checker']);
    expect(keys('action').sort()).toEqual(['check-claim', 'check-page']);
    expect(keys('rovo:mcp')).toEqual(['runbook-checker-mcp']);
    expect(keys('consumer')).toEqual(['repo-index-consumer']);
    expect(keys('function').sort()).toEqual(
      ['byline-props', 'check-claim-fn', 'check-page-fn', 'index-repo-fn', 'ui-resolver'].sort(),
    );
  });

  it('uses a bodied macro and a settings page that acts as config', () => {
    expect(mod('macro')[0]?.['layout']).toBe('bodied');
    expect(mod('confluence:globalSettings')[0]?.['useAsConfig']).toBe(true);
  });

  it('keeps every action read-only (actionVerb GET)', () => {
    for (const action of mod('action')) expect(action['actionVerb']).toBe('GET');
  });

  it('points rovo:mcp tools and agent actions at existing action keys', () => {
    const actionKeys = new Set(keys('action'));
    for (const server of mod('rovo:mcp')) {
      const tools = server['tools'] as string[];
      expect(tools.length).toBeGreaterThan(0);
      for (const tool of tools) expect(actionKeys.has(tool)).toBe(true);
    }
    for (const agent of mod('rovo:agent')) {
      for (const action of agent['actions'] as string[]) expect(actionKeys.has(action)).toBe(true);
    }
  });

  it('points actions, consumers and macros at existing functions', () => {
    const fnKeys = new Set(keys('function'));
    for (const a of mod('action')) expect(fnKeys.has(a['function'] as string)).toBe(true);
    for (const c of mod('consumer')) expect(fnKeys.has(c['function'] as string)).toBe(true);
    for (const m of [...mod('macro'), ...mod('confluence:contentBylineItem'), ...mod('confluence:globalSettings')]) {
      const resolver = m['resolver'] as { function: string };
      expect(fnKeys.has(resolver.function)).toBe(true);
    }
  });

  it('keeps agent and MCP names at most 30 characters', () => {
    for (const agent of mod('rovo:agent')) expect((agent['name'] as string).length).toBeLessThanOrEqual(30);
    for (const server of mod('rovo:mcp')) expect((server['name'] as string).length).toBeLessThanOrEqual(30);
  });

  it('requests exactly the declared scopes', () => {
    expect([...manifest.permissions.scopes].sort()).toEqual(['read:page:confluence', 'storage:app']);
  });

  it('declares exactly the declared egress hosts (changing egress forces a major version upgrade)', () => {
    const hosts = (manifest.permissions.external?.fetch?.backend ?? []).map((b) => (typeof b === 'string' ? b : b.address));
    expect([...hosts].sort()).toEqual(['api.bitbucket.org', 'api.github.com', 'bitbucket.org', 'codeload.github.com']);
  });
});
