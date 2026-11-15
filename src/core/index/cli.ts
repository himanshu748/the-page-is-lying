/**
 * CLI index builders: package.json bin and scripts, Makefile targets, commander, yargs,
 * argparse, click, cobra and the Go `flag` package, picocli.
 *
 * Conventions (documented for the matcher):
 * - package.json script `db:migrate` becomes program "npm", subcommands ["run", "db:migrate"],
 *   kind "script". For `test`, `start`, `stop` and `restart` an extra entry with subcommands
 *   [name] covers `npm test`. Script entries never list flags: arguments pass through.
 * - Makefile target `seed` becomes program "make", subcommands ["seed"], kind "make_target".
 * - A `bin` entry is program = bin name, subcommands [], kind "bin".
 * - Commands parsed from source are kind "command". Every command also lists "--help" and "-h".
 *   Programs whose name is not written in the source take the single `bin` name, else the
 *   package name, else the file base name.
 */
import type { CliEntry } from '../model';
import { mapGet, scalarString } from './structured';
import type { TreeNode } from './structured';
import { baseName, dirName, findClose, lineAt, lineStarts, snippetOf, splitArgs, splitLines, stringLiteral } from './text';
import type { Arg } from './text';
import type { IndexAcc } from './types';

const HELP = ['--help', '-h'];

function pushEntry(acc: IndexAcc, e: CliEntry, needsName = false): void {
  acc.cli.push(e);
  if (needsName) acc.cliRoots.push({ entry: e, needsName });
}

// ---------------------------------------------------------------------------
// package.json and Makefile
// ---------------------------------------------------------------------------

export function indexPackageCli(acc: IndexAcc, file: string, text: string, tree: TreeNode): void {
  const lines = splitLines(text);
  const pkgName = scalarString(mapGet(tree, 'name')?.value);
  const bin = mapGet(tree, 'bin');
  if (bin) {
    if (bin.value.kind === 'scalar') {
      const name = pkgName?.replace(/^@[^/]+\//, '') ?? baseName(dirName(file) || 'cli');
      acc.binNames.push(name);
      pushEntry(acc, { file, line: bin.line, snippet: snippetOf(lines, bin.line), program: name, subcommands: [], flags: [], kind: 'bin' });
    } else if (bin.value.kind === 'map') {
      for (const e of bin.value.entries) {
        acc.binNames.push(e.key);
        pushEntry(acc, { file, line: e.line, snippet: snippetOf(lines, e.line), program: e.key, subcommands: [], flags: [], kind: 'bin' });
      }
    }
  }
  const scripts = mapGet(tree, 'scripts');
  if (scripts && scripts.value.kind === 'map') {
    for (const s of scripts.value.entries) {
      const base = { file, line: s.line, snippet: snippetOf(lines, s.line), program: 'npm', flags: [] as string[], kind: 'script' as const };
      pushEntry(acc, { ...base, subcommands: ['run', s.key] });
      if (['test', 'start', 'stop', 'restart'].includes(s.key)) pushEntry(acc, { ...base, subcommands: [s.key] });
    }
  }
}

export function indexMakefile(acc: IndexAcc, file: string, text: string): void {
  const lines = splitLines(text);
  lines.forEach((raw, i) => {
    if (/^\s/.test(raw) || raw.startsWith('#')) return;
    if (/^-?include\b|^\$\(\s*(?:eval|foreach)/.test(raw)) {
      if (/^-?include\b/.test(raw)) acc.partial.cli = true;
      return;
    }
    const m = /^([A-Za-z0-9_][A-Za-z0-9_./ -]*?)\s*:(?![=:])/.exec(raw);
    if (!m) return;
    for (const t of (m[1] as string).split(/\s+/)) {
      if (t === '' || t.startsWith('.') || t.includes('%') || t.includes('$')) continue;
      pushEntry(acc, { file, line: i + 1, snippet: snippetOf(lines, i + 1), program: 'make', subcommands: [t], flags: [], kind: 'make_target' });
    }
  });
}

// ---------------------------------------------------------------------------
// Shared command state
// ---------------------------------------------------------------------------

interface Cmd {
  path: string[];
  flags: Set<string>;
  line: number;
  aliases: string[];
  version: boolean;
  name?: string;
  root: boolean;
}

function newCmd(path: string[], line: number, root: boolean): Cmd {
  return { path, flags: new Set(), line, aliases: [], version: false, root };
}

function dashWords(src: string): string[] {
  return [...src.matchAll(/(?:^|[\s,|'"])(--?[A-Za-z][\w-]*)/g)].map((m) => m[1] as string);
}

function emitCmds(acc: IndexAcc, file: string, original: string, cmds: Cmd[], rootName?: string): void {
  const lines = splitLines(original);
  for (const c of cmds) {
    const flags = [...c.flags, ...HELP, ...(c.version ? ['--version', '-V'] : [])];
    const unique = [...new Set(flags)];
    const program = rootName ?? '';
    const base = { file, line: c.line, snippet: snippetOf(lines, c.line), flags: unique, kind: 'command' as const };
    const e: CliEntry = { ...base, program, subcommands: c.path };
    pushEntry(acc, e, rootName === undefined || rootName === '');
    for (const a of c.aliases) {
      pushEntry(acc, { ...base, program, subcommands: [...c.path.slice(0, -1), a] }, rootName === undefined || rootName === '');
    }
  }
}

// ---------------------------------------------------------------------------
// commander
// ---------------------------------------------------------------------------

export function indexCommander(acc: IndexAcc, file: string, original: string, text: string): void {
  if (!/['"]commander['"]|\bnew\s+Command\s*\(/.test(text)) return;
  const starts = lineStarts(text);
  const vars = new Map<string, Cmd>();
  const all: Cmd[] = [];
  const mk = (path: string[], offset: number, root: boolean): Cmd => {
    const c = newCmd(path, lineAt(starts, offset), root);
    all.push(c);
    return c;
  };
  if (/\bimport\s*\{[^}]*\bprogram\b[^}]*\}\s*from\s*['"]commander['"]|\bconst\s*\{[^}]*\bprogram\b[^}]*\}\s*=\s*require\(\s*['"]commander['"]/.test(text)) {
    const idx = text.search(/\bprogram\b/);
    vars.set('program', mk([], idx === -1 ? 0 : idx, true));
  }
  type Ev = { idx: number; at: number; kind: 'new' | 'call'; assign?: string; recv?: string; method?: string; open: number };
  const events: Ev[] = [];
  for (const m of text.matchAll(/(?:\b(?:const|let|var)\s+([\w$]+)\s*(?::[^=\n]+)?=\s*)?new\s+(?:commander\s*\.\s*)?Command\s*\(/g)) {
    const ev: Ev = { idx: m.index, at: m.index, kind: 'new', open: m.index + m[0].length - 1 };
    if (m[1]) ev.assign = m[1];
    events.push(ev);
  }
  for (const m of text.matchAll(/(?:\b(?:const|let|var)\s+([\w$]+)\s*(?::[^=\n]+)?=\s*)?([\w$]+)?\s*\.\s*(command|option|requiredOption|addOption|name|alias|version|addCommand|executableDir)\s*\(/g)) {
    const ev: Ev = { idx: m.index, at: m.index + m[0].lastIndexOf(m[3] as string, m[0].length - 1), kind: 'call', method: m[3] as string, open: m.index + m[0].length - 1 };
    if (m[1]) ev.assign = m[1];
    if (m[2]) ev.recv = m[2];
    events.push(ev);
  }
  events.sort((a, b) => a.idx - b.idx);
  let current: Cmd | undefined;
  for (const ev of events) {
    const close = findClose(text, ev.open);
    const args: Arg[] = close === -1 ? [] : splitArgs(text.slice(ev.open + 1, close), ev.open + 1);
    if (ev.kind === 'new') {
      const c = mk([], ev.at, true);
      const nm = args[0]?.literal;
      if (nm !== undefined) c.name = nm;
      if (ev.assign) vars.set(ev.assign, c);
      current = c;
      continue;
    }
    let base: Cmd | undefined;
    if (ev.recv !== undefined) base = vars.get(ev.recv);
    else base = current;
    if (!base) {
      current = undefined;
      continue;
    }
    switch (ev.method) {
      case 'command': {
        const a0 = args[0];
        if (!a0 || a0.literal === undefined) {
          acc.partial.cli = true;
          break;
        }
        const name = a0.literal.trim().split(/\s+/)[0] ?? '';
        if (name === '') break;
        const child = mk([...base.path, name], ev.at, false);
        if (ev.assign) vars.set(ev.assign, child);
        // `.command(name, description)` declares an executable subcommand and returns the parent.
        const executable = args[1]?.literal !== undefined;
        if (executable) {
          current = base;
          acc.partial.cli = true; // its flags live in a separate executable
        } else current = child;
        continue;
      }
      case 'option':
      case 'requiredOption': {
        for (const f of dashWords(args[0]?.literal ?? '')) base.flags.add(f);
        if (args[0]?.literal === undefined) acc.partial.cli = true;
        break;
      }
      case 'addOption': {
        const m = /new\s+Option\s*\(\s*(['"])([^'"]*)\1/.exec(args[0]?.src ?? '');
        if (m) for (const f of dashWords(m[2] as string)) base.flags.add(f);
        else acc.partial.cli = true;
        break;
      }
      case 'name':
        if (args[0]?.literal !== undefined) base.name = args[0].literal;
        break;
      case 'alias':
        if (args[0]?.literal !== undefined) base.aliases.push(args[0].literal);
        break;
      case 'version':
        base.version = true;
        break;
      default:
        acc.partial.cli = true; // addCommand, executableDir
    }
    current = base;
  }
  if (all.length === 0) return;
  // Root commands: each root emits with its own name; children inherit the nearest root's name.
  const roots = all.filter((c) => c.root);
  if (roots.length === 0) return;
  const rootName = roots[0]?.name;
  for (const c of all) {
    if (c.root) c.path = [];
  }
  emitCmds(acc, file, original, all, rootName);
}

// ---------------------------------------------------------------------------
// yargs
// ---------------------------------------------------------------------------

function topLevelKeys(objSrc: string): Array<{ key: string; body: string }> {
  const out: Array<{ key: string; body: string }> = [];
  let depth = 0;
  const n = objSrc.length;
  let i = 0;
  while (i < n) {
    const c = objSrc[i] as string;
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      let j = i + 1;
      while (j < n && objSrc[j] !== q) j += objSrc[j] === '\\' ? 2 : 1;
      if (depth === 1) {
        const rest = objSrc.slice(j + 1).match(/^\s*:/);
        if (rest) out.push({ key: objSrc.slice(i + 1, j), body: valueBody(objSrc, j + 1 + rest[0].length) });
      }
      i = j + 1;
      continue;
    }
    if ('{[('.includes(c)) depth++;
    else if ('}])'.includes(c)) depth--;
    else if (depth === 1 && /[A-Za-z_$]/.test(c) && !/[\w$]/.test(objSrc[i - 1] ?? ' ')) {
      const m = /^([A-Za-z_$][\w$-]*)\s*:/.exec(objSrc.slice(i, i + 80));
      if (m) {
        out.push({ key: m[1] as string, body: valueBody(objSrc, i + m[0].length) });
        i += m[0].length;
        continue;
      }
    }
    i++;
  }
  return out;
}

function valueBody(src: string, from: number): string {
  const rest = src.slice(from);
  const ws = rest.length - rest.trimStart().length;
  const open = from + ws;
  if (src[open] === '{' || src[open] === '[') {
    const close = findClose(src, open);
    return close === -1 ? '' : src.slice(open, close + 1);
  }
  const q = src[open];
  if (q === '"' || q === "'" || q === '`') {
    let j = open + 1;
    while (j < src.length && src[j] !== q) j += src[j] === '\\' ? 2 : 1;
    return src.slice(open, j + 1);
  }
  return src.slice(open, open + 80);
}

export function indexYargs(acc: IndexAcc, file: string, original: string, text: string): void {
  if (!/['"]yargs(?:\/[\w-]+)?['"]/.test(text)) return;
  const starts = lineStarts(text);
  const root = newCmd([], 1, true);
  const cmds: Cmd[] = [root];
  const regions: Array<{ cmd: Cmd; from: number; to: number }> = [];
  let rootName: string | undefined;
  for (const m of text.matchAll(/\.\s*command\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const close = findClose(text, open);
    if (close === -1) continue;
    const inner = text.slice(open + 1, close);
    const args = splitArgs(inner, open + 1);
    const a0 = args[0];
    let names: string[] = [];
    if (a0?.literal !== undefined) names = [a0.literal];
    else if (a0?.src.startsWith('[')) names = [...a0.src.matchAll(/(['"])([^'"]*)\1/g)].map((x) => x[2] as string);
    else if (a0?.src.startsWith('{')) {
      const k = topLevelKeys(a0.src).find((x) => x.key === 'command');
      const lit = k ? stringLiteral(k.body.trim()) : undefined;
      if (lit !== undefined) names = [lit];
    }
    if (names.length === 0) {
      acc.partial.cli = true;
      continue;
    }
    const first = (names[0] as string).trim().split(/\s+/)[0] ?? '';
    if (first === '' || first === '$0' || first === '*') {
      regions.push({ cmd: root, from: open, to: close });
      continue;
    }
    const c = newCmd([first], lineAt(starts, m.index), false);
    if (a0?.src.startsWith('{')) {
      const b = topLevelKeys(a0.src).find((x) => x.key === 'builder');
      if (b?.body.startsWith('{')) {
        for (const k of topLevelKeys(b.body)) {
          c.flags.add(k.key.length === 1 ? `-${k.key}` : `--${k.key}`);
          const am = /\balias\s*:\s*(\[[^\]]*\]|(['"])[^'"]*\2)/.exec(k.body);
          if (am) for (const x of (am[1] as string).matchAll(/(['"])([^'"]*)\1/g)) c.flags.add((x[2] as string).length === 1 ? `-${x[2]}` : `--${x[2]}`);
        }
      }
    }
    c.aliases = names.slice(1).map((n) => n.trim().split(/\s+/)[0] ?? '').filter((n) => n !== '');
    cmds.push(c);
    regions.push({ cmd: c, from: open, to: close });
  }
  if (/\.\s*commandDir\s*\(/.test(text)) acc.partial.cli = true;
  const sn = /\.\s*scriptName\s*\(\s*(['"])([^'"]*)\1/.exec(text);
  if (sn) rootName = sn[2];
  root.version = true; // yargs defines --version by default
  const owner = (offset: number): Cmd => {
    let best: { cmd: Cmd; size: number } | undefined;
    for (const r of regions) {
      if (offset > r.from && offset < r.to && (!best || r.to - r.from < best.size)) best = { cmd: r.cmd, size: r.to - r.from };
    }
    return best?.cmd ?? root;
  };
  const optName = (n: string, into: Cmd): void => {
    into.flags.add(n.length === 1 ? `-${n}` : `--${n}`);
  };
  const aliasesIn = (body: string, into: Cmd): void => {
    const am = /\balias\s*:\s*(\[[^\]]*\]|(['"])[^'"]*\2)/.exec(body);
    if (am) for (const x of (am[1] as string).matchAll(/(['"])([^'"]*)\1/g)) optName(x[2] as string, into);
  };
  for (const m of text.matchAll(/\.\s*(option|options|boolean|string|number|count|array|demandOption)\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const close = findClose(text, open);
    if (close === -1) continue;
    const into = owner(m.index);
    const args = splitArgs(text.slice(open + 1, close), open + 1);
    const verb = m[1] as string;
    const a0 = args[0];
    if (!a0) continue;
    if (verb === 'options' || (verb === 'option' && a0.src.startsWith('{'))) {
      if (!a0.src.startsWith('{')) {
        acc.partial.cli = true;
        continue;
      }
      for (const k of topLevelKeys(a0.src)) {
        optName(k.key, into);
        aliasesIn(k.body, into);
      }
    } else if (a0.literal !== undefined) {
      optName(a0.literal, into);
      if (verb === 'option' && args[1]) aliasesIn(args[1].src, into);
    } else if (a0.src.startsWith('[')) {
      for (const x of a0.src.matchAll(/(['"])([^'"]*)\1/g)) optName(x[2] as string, into);
    } else acc.partial.cli = true;
  }
  if (cmds.length === 1 && root.flags.size === 0 && regions.length === 0) return;
  emitCmds(acc, file, original, cmds, rootName);
}

// ---------------------------------------------------------------------------
// Python: argparse and click
// ---------------------------------------------------------------------------

export function indexArgparse(acc: IndexAcc, file: string, original: string, text: string): void {
  if (!/\bargparse\b/.test(text)) return;
  const starts = lineStarts(text);
  const cmds = new Map<string, Cmd>();
  const subparsersOf = new Map<string, string>(); // subparsers var -> parser var
  const order: Cmd[] = [];
  let rootName: string | undefined;
  type Ev = { idx: number; re: RegExpMatchArray };
  const evs: Ev[] = [];
  const patterns: RegExp[] = [
    /(\w+)\s*=\s*(?:argparse\s*\.\s*)?ArgumentParser\s*\(/g,
    /(\w+)\s*=\s*(\w+)\s*\.\s*add_subparsers\s*\(/g,
    /(\w+)\s*=\s*(\w+)\s*\.\s*add_parser\s*\(/g,
    /(\w+)\s*=\s*(\w+)\s*\.\s*add_argument_group\s*\(/g,
    /\b(\w+)\s*\.\s*add_argument\s*\(/g,
  ];
  patterns.forEach((re, k) => {
    for (const m of text.matchAll(re)) evs.push({ idx: m.index + k / 10, re: m });
  });
  evs.sort((a, b) => a.idx - b.idx);
  const bodyArgs = (m: RegExpMatchArray): Arg[] => {
    const open = (m.index as number) + m[0].length - 1;
    const close = findClose(text, open);
    return close === -1 ? [] : splitArgs(text.slice(open + 1, close), open + 1);
  };
  for (const ev of evs) {
    const m = ev.re;
    const src = m[0];
    const line = (): number => lineAt(starts, m.index as number);
    if (/ArgumentParser\s*\($/.test(src)) {
      const args = bodyArgs(m);
      const c = newCmd([], line(), true);
      const prog = args.find((a) => /^prog\s*=/.test(a.src));
      const lit = prog ? stringLiteral(prog.src.replace(/^prog\s*=\s*/, '')) : undefined;
      if (lit !== undefined) c.name = lit;
      if (args.some((a) => /^parents\s*=/.test(a.src))) acc.partial.cli = true;
      cmds.set(m[1] as string, c);
      order.push(c);
      if (c.name !== undefined && rootName === undefined) rootName = c.name;
    } else if (/add_subparsers\s*\($/.test(src)) subparsersOf.set(m[1] as string, m[2] as string);
    else if (/add_parser\s*\($/.test(src)) {
      const args = bodyArgs(m);
      const parentParser = subparsersOf.get(m[2] as string);
      const parent = parentParser ? cmds.get(parentParser) : undefined;
      const nm = args[0]?.literal;
      if (!parent || nm === undefined) {
        acc.partial.cli = true;
        continue;
      }
      if (args.some((a) => /^parents\s*=/.test(a.src))) acc.partial.cli = true;
      const c = newCmd([...parent.path, nm], line(), false);
      const al = args.find((a) => /^aliases\s*=/.test(a.src));
      if (al) c.aliases = [...al.src.matchAll(/(['"])([^'"]*)\1/g)].map((x) => x[2] as string);
      cmds.set(m[1] as string, c);
      order.push(c);
    } else if (/add_argument_group\s*\($/.test(src)) {
      const parent = cmds.get(m[2] as string);
      if (parent) cmds.set(m[1] as string, parent);
    } else {
      const c = cmds.get(m[1] as string);
      if (!c) continue;
      const args = bodyArgs(m);
      const a0 = args[0];
      if (!a0) continue;
      if (a0.literal === undefined) {
        acc.partial.cli = true;
        continue;
      }
      for (const a of args) if (a.literal?.startsWith('-')) c.flags.add(a.literal.split(/[=\s]/)[0] as string);
    }
  }
  if (order.length === 0) return;
  emitCmds(acc, file, original, order, rootName);
}

export function indexClick(acc: IndexAcc, file: string, original: string, text: string): void {
  if (/\bimport\s+typer\b|\bfrom\s+typer\b/.test(text)) acc.partial.cli = true;
  if (!/\bclick\b/.test(text)) return;
  const starts = lineStarts(text);
  type Item = { idx: number; kind: 'deco' | 'def'; name: string; args?: Arg[] };
  const items: Item[] = [];
  for (const m of text.matchAll(/^[ \t]*@\s*([\w.]+)\s*(\()?/gm)) {
    let args: Arg[] = [];
    if (m[2]) {
      const open = m.index + m[0].length - 1;
      const close = findClose(text, open);
      if (close !== -1) args = splitArgs(text.slice(open + 1, close), open + 1);
    }
    items.push({ idx: m.index, kind: 'deco', name: m[1] as string, args });
  }
  for (const m of text.matchAll(/^[ \t]*(?:async\s+)?def\s+(\w+)/gm)) items.push({ idx: m.index, kind: 'def', name: m[1] as string });
  items.sort((a, b) => a.idx - b.idx);
  const groups = new Map<string, string[]>();
  const cmds: Cmd[] = [];
  let pending: Item[] = [];
  let rootName: string | undefined;
  for (const it of items) {
    if (it.kind === 'deco') {
      pending.push(it);
      continue;
    }
    const fn = it.name;
    const decos = pending;
    pending = [];
    let def: { parent: string[] | undefined; group: boolean; args: Arg[] } | undefined;
    for (const d of decos) {
      const m = /^(\w+)\.(group|command)$/.exec(d.name);
      if (!m) continue;
      if (m[1] === 'click') def = { parent: undefined, group: m[2] === 'group', args: d.args ?? [] };
      else if (groups.has(m[1] as string)) def = { parent: groups.get(m[1] as string), group: m[2] === 'group', args: d.args ?? [] };
    }
    if (!def) continue;
    const explicit = def.args.find((a) => a.literal !== undefined && !a.literal.startsWith('-') && !/^\w+\s*=/.test(a.src))?.literal ?? def.args.find((a) => /^name\s*=/.test(a.src))?.src.replace(/^name\s*=\s*/, '').replace(/^["']|["']$/g, '');
    const name = explicit ?? fn.replace(/_/g, '-');
    const path = def.parent ? [...def.parent, name] : [];
    const c = newCmd(path, lineAt(starts, it.idx), def.parent === undefined);
    if (def.parent === undefined && explicit !== undefined) c.name = explicit;
    for (const d of decos) {
      if (d.name === 'click.option') {
        let any = false;
        for (const a of d.args ?? []) {
          if (a.literal?.startsWith('-')) {
            any = true;
            for (const part of a.literal.split('/')) c.flags.add(part.trim().split(/\s+/)[0] as string);
          }
        }
        if (!any && (d.args ?? []).length > 0 && d.args?.[0]?.literal === undefined) acc.partial.cli = true;
      } else if (d.name === 'click.version_option') c.version = true;
    }
    if (def.group) groups.set(fn, path);
    cmds.push(c);
    if (def.parent === undefined && rootName === undefined) rootName = c.name;
  }
  if (/\.\s*add_command\s*\(/.test(text)) acc.partial.cli = true;
  if (cmds.length === 0) return;
  emitCmds(acc, file, original, cmds, rootName);
}

// ---------------------------------------------------------------------------
// Go: cobra (resolved across files of a package) and the flag package
// ---------------------------------------------------------------------------

interface CobraCmd {
  file: string;
  line: number;
  snippet: string;
  use: string;
  flags: Set<string>;
  persistent: Set<string>;
  parent?: string;
}

const cobraState = new WeakMap<IndexAcc, Map<string, Map<string, CobraCmd>>>();

function goFlagNames(method: string, args: Arg[]): string[] {
  const lit = (i: number): string | undefined => args[i]?.literal ?? (/^`[^`]*`$/.test(args[i]?.src ?? '') ? args[i]?.src.slice(1, -1) : undefined);
  const out: string[] = [];
  let nameIdx = 0;
  let short: string | undefined;
  if (/VarP$/.test(method)) {
    nameIdx = 1;
    short = lit(2);
  } else if (/Var$/.test(method)) nameIdx = 1;
  else if (/P$/.test(method) && method !== 'Parse') short = lit(1);
  const name = lit(nameIdx);
  if (name === undefined) return ['?'];
  out.push(`--${name}`);
  if (short !== undefined && short.length === 1) out.push(`-${short}`);
  return out;
}

export function indexGoCli(acc: IndexAcc, file: string, original: string, text: string): void {
  const starts = lineStarts(text);
  const lines = splitLines(original);
  const dir = dirName(file);
  if (/spf13\/cobra/.test(original)) {
    let byDir = cobraState.get(acc);
    if (!byDir) {
      byDir = new Map();
      cobraState.set(acc, byDir);
    }
    let cmds = byDir.get(dir);
    if (!cmds) {
      cmds = new Map();
      byDir.set(dir, cmds);
    }
    for (const m of text.matchAll(/\b(\w+)\s*:?=\s*&?cobra\s*\.\s*Command\s*\{/g)) {
      const open = m.index + m[0].length - 1;
      const close = findClose(text, open);
      const body = close === -1 ? '' : text.slice(open, close);
      const use = /\bUse\s*:\s*(?:"([^"]*)"|`([^`]*)`)/.exec(body);
      if (!use) {
        acc.partial.cli = true;
        continue;
      }
      const line = lineAt(starts, m.index);
      cmds.set(m[1] as string, {
        file,
        line,
        snippet: snippetOf(lines, line),
        use: (((use[1] ?? use[2]) as string).trim().split(/\s+/)[0]) ?? '',
        flags: new Set(),
        persistent: new Set(),
      });
    }
    for (const m of text.matchAll(/\b(\w+)\s*\.\s*(Persistent)?Flags\s*\(\s*\)\s*\.\s*(\w+)\s*\(/g)) {
      const c = cmds.get(m[1] as string);
      if (!c) continue;
      const open = m.index + m[0].length - 1;
      const close = findClose(text, open);
      const args = close === -1 ? [] : splitArgs(text.slice(open + 1, close), open + 1);
      for (const f of goFlagNames(m[3] as string, args)) {
        if (f === '?') acc.partial.cli = true;
        else (m[2] ? c.persistent : c.flags).add(f);
      }
    }
    for (const m of text.matchAll(/\b(\w+)\s*\.\s*AddCommand\s*\(/g)) {
      const open = m.index + m[0].length - 1;
      const close = findClose(text, open);
      const args = close === -1 ? [] : splitArgs(text.slice(open + 1, close), open + 1);
      for (const a of args) {
        const child = cmds.get(a.src.replace(/^&/, ''));
        if (child) child.parent = m[1] as string;
        else acc.partial.cli = true;
      }
    }
  }
  if (/"flag"/.test(original) && /\bflag\s*\.\s*\w+\s*\(/.test(text)) {
    const flags = new Set<string>();
    let first = Number.POSITIVE_INFINITY;
    for (const m of text.matchAll(/\bflag\s*\.\s*(\w+)\s*\(/g)) {
      if (['Parse', 'Parsed', 'Args', 'Arg', 'NArg', 'NFlag', 'Usage', 'PrintDefaults', 'Lookup', 'Set', 'Visit', 'VisitAll', 'NewFlagSet'].includes(m[1] as string)) continue;
      const open = m.index + m[0].length - 1;
      const close = findClose(text, open);
      const args = close === -1 ? [] : splitArgs(text.slice(open + 1, close), open + 1);
      for (const f of goFlagNames(m[1] as string, args)) {
        if (f === '?') acc.partial.cli = true;
        else flags.add(f);
      }
      first = Math.min(first, m.index);
    }
    if (flags.size > 0) {
      const line = lineAt(starts, first);
      const name = baseName(dir === '' ? 'main' : dir);
      pushEntry(acc, { file, line, snippet: snippetOf(lines, line), program: name, subcommands: [], flags: [...flags, ...HELP], kind: 'command' }, true);
    }
  }
  if (/\bos\s*\.\s*Args\b/.test(text) && !/spf13\/cobra|"flag"/.test(original)) acc.partial.cli = true;
}

/** Called once after all files: resolves cobra hierarchies and unnamed roots. */
export function finalizeCli(acc: IndexAcc): void {
  const byDir = cobraState.get(acc);
  if (byDir) {
    for (const cmds of byDir.values()) {
      const pathOf = (name: string): { chain: CobraCmd[] } | undefined => {
        const chain: CobraCmd[] = [];
        let cur: string | undefined = name;
        for (let i = 0; i < 10 && cur !== undefined; i++) {
          const c = cmds.get(cur);
          if (!c) return undefined;
          chain.unshift(c);
          cur = c.parent;
        }
        return { chain };
      };
      for (const name of cmds.keys()) {
        const r = pathOf(name);
        if (!r) continue;
        const { chain } = r;
        const self = chain[chain.length - 1] as CobraCmd;
        const root = chain[0] as CobraCmd;
        const flags = new Set<string>(self.flags);
        for (const c of chain) for (const f of c.persistent) flags.add(f);
        for (const f of HELP) flags.add(f);
        acc.cli.push({
          file: self.file,
          line: self.line,
          snippet: self.snippet,
          program: root.use,
          subcommands: chain.slice(1).map((c) => c.use),
          flags: [...flags],
          kind: 'command',
        });
      }
    }
  }
  const single = acc.binNames.length === 1 ? acc.binNames[0] : undefined;
  for (const r of acc.cliRoots) {
    if (r.entry.program !== '') continue;
    r.entry.program = single ?? acc.packageName?.replace(/^@[^/]+\//, '') ?? baseName(r.entry.file).replace(/\.[^.]+$/, '');
  }
}

// ---------------------------------------------------------------------------
// Java: picocli (single command per file only)
// ---------------------------------------------------------------------------

export function indexPicocli(acc: IndexAcc, file: string, original: string, text: string): void {
  if (!/picocli/.test(original)) return;
  const cmdRe = /@Command\s*\(([^)]*)\)/g;
  const found = [...text.matchAll(cmdRe)];
  if (found.length !== 1 || /\bsubcommands\s*=/.test(text)) {
    acc.partial.cli = true;
    return;
  }
  const m = found[0] as RegExpMatchArray;
  const nm = /\bname\s*=\s*"([^"]*)"/.exec(m[1] as string);
  const starts = lineStarts(text);
  const flags = new Set<string>(HELP);
  for (const o of text.matchAll(/@Option\s*\(([^)]*)\)/g)) {
    const names = /\bnames\s*=\s*(\{[^}]*\}|"[^"]*")/.exec(o[1] as string);
    if (!names) continue;
    for (const x of (names[1] as string).matchAll(/"([^"]*)"/g)) flags.add(x[1] as string);
  }
  const line = lineAt(starts, m.index ?? 0);
  pushEntry(acc, { file, line, snippet: snippetOf(splitLines(original), line), program: nm?.[1] ?? '', subcommands: [], flags: [...flags], kind: 'command' }, !nm);
}
