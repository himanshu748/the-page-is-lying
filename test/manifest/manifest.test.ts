import { existsSync, readFileSync } from 'node:fs';
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

const ACTION_KEYS = ['audit-space', 'check-claim', 'check-page', 'explain-claim', 'suggest-fix'];

describe('manifest.yml contract', () => {
  it('declares every module key from PLAN.md section 4', () => {
    expect(keys('macro')).toEqual(['runbook-check']);
    expect(keys('confluence:contentBylineItem')).toEqual(['runbook-byline']);
    expect(keys('confluence:globalSettings')).toEqual(['runbook-settings']);
    expect(keys('confluence:spacePage')).toEqual(['runbook-drift']);
    expect(keys('rovo:agent')).toEqual(['runbook-checker']);
    expect(keys('action').sort()).toEqual(ACTION_KEYS);
    expect(keys('rovo:skill')).toEqual(['runbook-checker-skill']);
    expect(keys('rovo:mcp')).toEqual(['runbook-checker-mcp']);
    expect(keys('consumer')).toEqual(['repo-index-consumer']);
    expect(keys('function').sort()).toEqual(
      ['audit-space-fn', 'byline-props', 'check-claim-fn', 'check-page-fn', 'explain-claim-fn', 'index-repo-fn', 'suggest-fix-fn', 'ui-resolver'].sort(),
    );
  });

  it('binds the packaged skill to the agent, which is how a Rovo agent gets to use it', () => {
    expect(mod('rovo:agent')[0]?.['skills']).toEqual(['runbook-checker-skill']);
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
    expect([...manifest.permissions.scopes].sort()).toEqual(['read:confluence-user', 'read:page:confluence', 'storage:app']);
  });

  it('declares exactly the declared egress hosts (changing egress forces a major version upgrade)', () => {
    const hosts = (manifest.permissions.external?.fetch?.backend ?? []).map((b) => (typeof b === 'string' ? b : b.address));
    expect([...hosts].sort()).toEqual(['api.bitbucket.org', 'api.github.com', 'bitbucket.org', 'codeload.github.com']);
  });
  it('keeps every manifest string at most 255 characters (Forge rejects longer ones)', () => {
    const tooLong: string[] = [];
    const visit = (value: unknown, path: string): void => {
      if (typeof value === 'string') {
        if (value.length > 255) tooLong.push(`${path} (${value.length})`);
      } else if (Array.isArray(value)) value.forEach((v, i) => visit(v, `${path}[${i}]`));
      else if (value !== null && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) visit(v, `${path}.${k}`);
      }
    };
    visit(manifest, 'manifest');
    expect(tooLong).toEqual([]);
  });

  it('declares at most one rovo:mcp module, with at most 50 tools whose keys are under 64 characters', () => {
    expect(mod('rovo:mcp').length).toBeLessThanOrEqual(1);
    for (const server of mod('rovo:mcp')) {
      const tools = server['tools'] as string[];
      expect(tools.length).toBeLessThanOrEqual(50);
      for (const tool of tools) expect(tool.length).toBeLessThan(64);
    }
  });

  it('exposes the same actions to the agent and to MCP, and every action has a description and inputs', () => {
    const mcpTools = new Set(mod('rovo:mcp').flatMap((s) => s['tools'] as string[]));
    const agentActions = new Set(mod('rovo:agent').flatMap((a) => a['actions'] as string[]));
    expect([...mcpTools].sort()).toEqual([...agentActions].sort());
    expect([...mcpTools].sort()).toEqual(ACTION_KEYS);
    for (const action of mod('action')) {
      expect(typeof action['description']).toBe('string');
      expect(typeof action['inputs']).toBe('object');
    }
  });

  it('gives the agent a prompt resource that exists and conversation starters for both demo questions', () => {
    const agent = mod('rovo:agent')[0];
    const prompt = agent?.['prompt'] as string;
    const match = /^resource:([^;]+);(.+)$/.exec(prompt);
    expect(match).not.toBeNull();
    const resource = manifest.resources.find((r) => r.key === match?.[1]);
    expect(resource).toBeDefined();
    expect(existsSync(join(import.meta.dirname, '..', '..', resource?.path ?? '', match?.[2] ?? ''))).toBe(true);
    const starters = (agent?.['conversationStarters'] as string[]).map((s) => s.toLowerCase());
    expect(starters).toContain('is this page still true?');
    expect(starters.some((s) => s.includes('can i still call') && s.includes('/v1/charge'))).toBe(true);
  });

  it('declares check-page with an optional page input and check-claim with a required claim input', () => {
    type Inputs = Record<string, { type: string; required: boolean }>;
    const action = (key: string) => mod('action').find((a) => a['key'] === key)?.['inputs'] as Inputs;
    expect(action('check-page')['page']).toMatchObject({ type: 'string', required: false });
    expect(action('check-claim')['claim']).toMatchObject({ type: 'string', required: true });
    expect(action('check-claim')['page']).toMatchObject({ type: 'string', required: false });
  });
});
