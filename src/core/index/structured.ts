/**
 * Parsers for structured repo files that keep line numbers: lenient JSON, YAML (via the
 * `yaml` package with a LineCounter) and a small TOML reader. All of them are total: they
 * return undefined instead of throwing, bound their depth and never evaluate content.
 */
import { LineCounter, isMap, isScalar, isSeq, parseAllDocuments } from 'yaml';
import type { Node as YamlNode } from 'yaml';

// ---------------------------------------------------------------------------
// Generic tree
// ---------------------------------------------------------------------------

export type TreeNode =
  | { kind: 'map'; line: number; entries: Array<{ key: string; line: number; value: TreeNode }> }
  | { kind: 'seq'; line: number; items: TreeNode[] }
  | { kind: 'scalar'; line: number; value: string | number | boolean | null };

const MAX_DEPTH = 40;

export function mapGet(node: TreeNode | undefined, key: string): { line: number; value: TreeNode } | undefined {
  if (!node || node.kind !== 'map') return undefined;
  const hit = node.entries.find((e) => e.key === key);
  return hit ? { line: hit.line, value: hit.value } : undefined;
}

export function scalarString(node: TreeNode | undefined): string | undefined {
  if (!node || node.kind !== 'scalar' || node.value === null) return undefined;
  return String(node.value);
}

// ---------------------------------------------------------------------------
// Lenient JSON with line numbers (accepts comments and trailing commas)
// ---------------------------------------------------------------------------

export function parseJsonTree(text: string): TreeNode | undefined {
  let i = 0;
  let line = 1;
  const n = text.length;
  let steps = 0;

  const fail = Symbol('fail');

  function skip(): void {
    for (;;) {
      const c = text[i];
      if (c === '\n') {
        line++;
        i++;
      } else if (c === ' ' || c === '\t' || c === '\r' || c === '\ufeff') i++;
      else if (c === '/' && text[i + 1] === '/') {
        while (i < n && text[i] !== '\n') i++;
      } else if (c === '/' && text[i + 1] === '*') {
        i += 2;
        while (i < n && !(text[i] === '*' && text[i + 1] === '/')) {
          if (text[i] === '\n') line++;
          i++;
        }
        i += 2;
      } else return;
    }
  }

  function str(): string {
    // text[i] is the opening quote
    i++;
    let out = '';
    while (i < n) {
      const c = text[i] as string;
      if (c === '"') {
        i++;
        return out;
      }
      if (c === '\\') {
        const e = text[i + 1];
        i += 2;
        if (e === 'n') out += '\n';
        else if (e === 't') out += '\t';
        else if (e === 'u') {
          const hex = text.slice(i, i + 4);
          out += /^[0-9a-fA-F]{4}$/.test(hex) ? String.fromCharCode(parseInt(hex, 16)) : '';
          i += 4;
        } else out += e ?? '';
        continue;
      }
      if (c === '\n') throw fail;
      out += c;
      i++;
    }
    throw fail;
  }

  function value(depth: number): TreeNode {
    if (depth > MAX_DEPTH || ++steps > 2_000_000) throw fail;
    skip();
    const startLine = line;
    const c = text[i];
    if (c === '{') {
      i++;
      const entries: Array<{ key: string; line: number; value: TreeNode }> = [];
      for (;;) {
        skip();
        if (text[i] === '}') {
          i++;
          break;
        }
        if (text[i] !== '"') throw fail;
        const keyLine = line;
        const key = str();
        skip();
        if (text[i] !== ':') throw fail;
        i++;
        const v = value(depth + 1);
        entries.push({ key, line: keyLine, value: v });
        skip();
        if (text[i] === ',') i++;
        else if (text[i] !== '}') throw fail;
      }
      return { kind: 'map', line: startLine, entries };
    }
    if (c === '[') {
      i++;
      const items: TreeNode[] = [];
      for (;;) {
        skip();
        if (text[i] === ']') {
          i++;
          break;
        }
        items.push(value(depth + 1));
        skip();
        if (text[i] === ',') i++;
        else if (text[i] !== ']') throw fail;
      }
      return { kind: 'seq', line: startLine, items };
    }
    if (c === '"') return { kind: 'scalar', line: startLine, value: str() };
    const m = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i, i + 40));
    if (!m) throw fail;
    i += m[0].length;
    const tok = m[0];
    return {
      kind: 'scalar',
      line: startLine,
      value: tok === 'true' ? true : tok === 'false' ? false : tok === 'null' ? null : Number(tok),
    };
  }

  try {
    const root = value(0);
    skip();
    return i >= n ? root : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// YAML with line numbers (multi-document aware)
// ---------------------------------------------------------------------------

export function parseYamlTrees(text: string): TreeNode[] | undefined {
  try {
    const lc = new LineCounter();
    const docs = parseAllDocuments(text, { lineCounter: lc, prettyErrors: false, uniqueKeys: false });
    const docList = Array.isArray(docs) ? docs : [docs];
    const out: TreeNode[] = [];
    for (const doc of docList) {
      if (doc.errors.length > 0 || !doc.contents) continue;
      const tree = convert(doc.contents as YamlNode, lc, 0);
      if (tree) out.push(tree);
    }
    return out;
  } catch {
    return undefined;
  }
}

function lineOf(node: YamlNode | null | undefined, lc: LineCounter): number {
  const start = node?.range?.[0];
  return start === undefined ? 1 : lc.linePos(start).line;
}

function convert(node: unknown, lc: LineCounter, depth: number): TreeNode | undefined {
  if (depth > MAX_DEPTH) return undefined;
  if (isMap(node)) {
    const entries: Array<{ key: string; line: number; value: TreeNode }> = [];
    for (const pair of node.items) {
      const keyNode = pair.key as YamlNode | null;
      const key = isScalar(keyNode) ? String(keyNode.value) : undefined;
      if (key === undefined) continue;
      const v = convert(pair.value, lc, depth + 1) ?? { kind: 'scalar' as const, line: lineOf(keyNode, lc), value: null };
      entries.push({ key, line: lineOf(keyNode, lc), value: v });
    }
    return { kind: 'map', line: lineOf(node as unknown as YamlNode, lc), entries };
  }
  if (isSeq(node)) {
    const items: TreeNode[] = [];
    for (const item of node.items) {
      const v = convert(item, lc, depth + 1);
      if (v) items.push(v);
    }
    return { kind: 'seq', line: lineOf(node as unknown as YamlNode, lc), items };
  }
  if (isScalar(node)) {
    const v = node.value;
    const value = typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null ? v : String(v);
    return { kind: 'scalar', line: lineOf(node as unknown as YamlNode, lc), value };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Minimal TOML reader (tables, key = value, string arrays) for pyproject.toml
// ---------------------------------------------------------------------------

export interface TomlValue {
  line: number;
  /** Scalar string value, or the raw string items of an array. */
  str?: string;
  items?: Array<{ line: number; value: string }>;
}

/** Map of "table.path.key" to value. Only strings and arrays of strings are kept. */
export function parseTomlLite(text: string): Map<string, TomlValue> {
  const out = new Map<string, TomlValue>();
  const lines = text.split(/\r\n|\r|\n/);
  let table = '';
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] as string;
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const t = /^\[\[?\s*([^\]]+?)\s*\]\]?\s*(?:#.*)?$/.exec(trimmed);
    if (t) {
      table = (t[1] as string).replace(/\s*\.\s*/g, '.').replace(/"/g, '');
      continue;
    }
    const kv = /^("[^"]+"|'[^']+'|[A-Za-z0-9_.-]+)\s*=\s*(.*)$/.exec(trimmed);
    if (!kv) continue;
    const key = (kv[1] as string).replace(/^["']|["']$/g, '');
    let rest = kv[2] as string;
    const fullKey = table === '' ? key : `${table}.${key}`;
    const startLine = i + 1;
    if (rest.startsWith('[')) {
      // gather until brackets balance (strings only, bounded)
      let buf = rest;
      let j = i;
      while (!balanced(buf) && j + 1 < lines.length && j - i < 500) {
        j++;
        buf += `\n${lines[j] as string}`;
      }
      const items: Array<{ line: number; value: string }> = [];
      const bufLines = buf.split('\n');
      bufLines.forEach((bl, idx) => {
        for (const m of bl.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)) {
          items.push({ line: startLine + idx, value: (m[1] ?? m[2]) as string });
        }
      });
      out.set(fullKey, { line: startLine, items });
      i = j;
    } else {
      rest = rest.replace(/\s+#.*$/, '').trim();
      const s = /^"((?:[^"\\]|\\.)*)"$|^'([^']*)'$/.exec(rest);
      if (s) out.set(fullKey, { line: startLine, str: (s[1] ?? s[2]) as string });
      else out.set(fullKey, { line: startLine });
    }
  }
  return out;
}

function balanced(s: string): boolean {
  let depth = 0;
  let inStr: string | undefined;
  for (const c of s) {
    if (inStr) {
      if (c === inStr) inStr = undefined;
      continue;
    }
    if (c === '"' || c === "'") inStr = c;
    else if (c === '[') depth++;
    else if (c === ']') depth--;
  }
  return depth <= 0;
}
