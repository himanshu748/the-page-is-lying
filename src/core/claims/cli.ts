import { overlaps, type BlockContext, type Candidate } from './context';
import { FILE_EXTENSIONS } from './files';
import { stripPrefix, tokenizeSegment, type Token } from './shell';

/** Well-known external tools. Their commands say nothing about the repo, so they are not claims. `curl` is handled by http.ts. */
const EXTERNAL_TOOLS: ReadonlySet<string> = new Set(
  `git docker docker-compose podman kubectl helm minikube psql mysql sqlite3 redis-cli mongosh aws gcloud az terraform ansible vagrant
   ssh scp sftp rsync sudo su cd ls cat echo printf grep egrep sed awk find mkdir rmdir rm cp mv chmod chown tar unzip zip gzip wget curl
   node nodejs deno bun npx tsc tsx python python3 pip pip3 pipx uv poetry pytest go java javac mvn gradle cargo rustc rustup ruby gem bundle
   php composer dotnet brew apt apt-get yum dnf apk systemctl service journalctl tail head less more vim vi nano code open export source set
   unset env kill pkill ps top df du ln touch date sleep nc ping dig nslookup openssl jq xargs tee sort uniq wc diff patch which man exit
   true false test jest vitest eslint prettier forge gh nginx tmux screen htop`
    .split(/\s+/)
    .filter((s) => s !== ''),
);

const YARN_BUILTINS: ReadonlySet<string> = new Set(
  `install i add remove rm upgrade up update publish init link unlink config cache global info list ls why outdated audit login logout pack
   exec dlx create dedupe import rebuild fetch store patch prune version workspace workspaces help bin dev-help`
    .split(/\s+/)
    .filter((s) => s !== ''),
);

const PROGRAM_RE = /^[a-z][a-z0-9_-]{0,39}$/;
const SUBCOMMAND_RE = /^[a-z][A-Za-z0-9:.-]{0,59}$/;
const FLAG_RE = /^-{1,2}[A-Za-z][A-Za-z0-9-]{0,39}$/;
const SCRIPT_RE = /^[A-Za-z0-9][A-Za-z0-9:_.@/-]{0,79}$/;
const MAX_SUBCOMMANDS = 4;

interface Parsed {
  program: string;
  subcommands: string[];
  flags: string[];
}

function parseRunner(program: string, args: Token[]): Parsed | null {
  const words = args.filter((t) => !t.quoted && !t.value.startsWith('-'));
  const first = words[0]?.value;
  if (first === undefined) return null;
  let script: string | undefined;
  if (first === 'run' || first === 'run-script') {
    script = words[1]?.value;
  } else if (program === 'npm') {
    if (['test', 'start', 'stop', 'restart'].includes(first)) script = first;
  } else if (!YARN_BUILTINS.has(first)) {
    script = first;
  }
  if (script === undefined || !SCRIPT_RE.test(script)) return null;
  return { program, subcommands: ['run', script], flags: [] };
}

function parseMake(args: Token[]): Parsed | null {
  const targets = args
    .filter((t) => !t.quoted && /^[A-Za-z0-9_.][A-Za-z0-9_.-]{0,59}$/.test(t.value))
    .map((t) => t.value)
    .slice(0, MAX_SUBCOMMANDS);
  return targets.length > 0 ? { program: 'make', subcommands: targets, flags: [] } : null;
}

/** `db.json` and `server.js` are arguments, not subcommands. */
function isFileToken(value: string): boolean {
  const name = value.split('/').pop() ?? value;
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return false;
  const ext = name.slice(dot + 1).toLowerCase();
  return FILE_EXTENSIONS.has(ext) || ext === 'json5';
}

function parseGeneric(program: string, args: Token[]): Parsed | null {
  const subcommands: string[] = [];
  const flags: string[] = [];
  let collecting = true;
  for (const token of args) {
    const value = token.value;
    if (!token.quoted && value === '--') break;
    const flag = token.quoted ? undefined : value.split('=')[0];
    if (flag !== undefined && FLAG_RE.test(flag)) {
      collecting = false;
      if (!flags.includes(flag)) flags.push(flag);
    } else if (collecting && !token.quoted && isFileToken(value)) {
      // `json-server db.json -s` — the file is an argument, and flags after it still count.
      collecting = false;
    } else if (collecting && !token.quoted && SUBCOMMAND_RE.test(value) && subcommands.length < MAX_SUBCOMMANDS) {
      subcommands.push(value);
    } else {
      collecting = false;
    }
  }
  return subcommands.length > 0 || flags.length > 0 ? { program, subcommands, flags } : null;
}

interface ProgramHit {
  name: string;
  at: number;
  arguments?: string;
}

/** The program named by the nearest preceding `Usage: name` or `name [options]` line. */
function usageBefore(text: string, index: number): ProgramHit | undefined {
  const before = text.slice(0, index);
  const hits: ProgramHit[] = [];
  const usage = /Usage:[ \t]*([a-z][a-z0-9_-]{0,39})\b(.*)/g;
  const bracket = /(?:^|\n)[ \t]*(?:[$%>][ \t]+)?([a-z][a-z0-9_-]{0,39})[ \t]+((?:[a-z][A-Za-z0-9:.-]*[ \t]+)*\[.*)/g;
  for (const re of [usage, bracket]) {
    for (const m of before.matchAll(re)) {
      const name = m[1];
      if (name === undefined || EXTERNAL_TOOLS.has(name) || !PROGRAM_RE.test(name)) continue;
      hits.push({ name, at: m.index, arguments: m[2] ?? '' });
    }
  }
  hits.sort((a, b) => a.at - b.at);
  return hits[hits.length - 1];
}

/** First cell of an option table: flags joined by "or", commas, and bracketed placeholders. */
function flagsInCell(cell: string): string[] | undefined {
  const cleaned = cell.replace(/`/g, '').replace(/\[[^\]]*\]/g, ' ').replace(/\([^)]*\)/g, ' ');
  const tokens = cleaned.split(/[\s,]+/).filter((token) => token !== '' && token.toLowerCase() !== 'or' && token.toLowerCase() !== 'and');
  if (tokens.length === 0) return undefined;
  const flags: string[] = [];
  for (const token of tokens) {
    if (!FLAG_RE.test(token)) return undefined;
    if (!flags.includes(token)) flags.push(token);
  }
  return flags;
}

function pushFlag(out: Candidate[], start: number, flag: string, program: string, high: boolean): void {
  const range = { start, end: start + flag.length };
  if (out.some((candidate) => overlaps(candidate, range))) return;
  out.push({ ...range, high, normalized: { type: 'cli', program, subcommands: [], flags: [flag] } });
}

/** Limit default claims to the literal cell of a Markdown table with a Default header. */
function extractTableDefaults(ctx: BlockContext, out: Candidate[], source: { text: string; offset: number }): void {
  const tables = /^( *\|[^\n]*\|)\r?\n *\|(?: *:?-{3,}:? *\|)+ *(?:\r?\n|$)((?: *\|[^\n]*\| *(?:\r?\n|$))+)/gm;
  for (const table of ctx.text.matchAll(tables)) {
    const header = table[1];
    const body = table[2];
    if (header === undefined || body === undefined || header.includes('\\|')) continue;
    const headers = header.trim().slice(1, -1).split('|');
    const column = headers.findIndex((cell) => /^defaults?$/i.test(cell.trim()));
    if (column < 1) continue;
    const usage = usageBefore(source.text, source.offset + table.index);
    if (usage === undefined) continue;
    const words = (usage.arguments ?? '').trim().split(/\s+/).filter(Boolean);
    const optionStart = words.findIndex((arg) => /^[<[(-]/.test(arg));
    const subcommands = optionStart === -1 ? words : words.slice(0, optionStart);
    if (subcommands.length > MAX_SUBCOMMANDS || subcommands.some((arg) => !/^[a-z][A-Za-z0-9:.-]*$/.test(arg))) continue;
    const bodyStart = table.index + table[0].length - body.length;
    for (const row of body.matchAll(/^ *\|([^\n]*?)\| *\r?$/gm)) {
      const interior = row[1];
      if (interior === undefined || interior.includes('\\|')) continue;
      const cells = interior.split('|');
      if (cells.length !== headers.length) continue;
      const first = cells[0];
      const cell = cells[column];
      if (first === undefined || cell === undefined) continue;
      const flags = flagsInCell(first);
      const literal = /^\s*(?:`([A-Za-z0-9_.:/-]+)`|([A-Za-z0-9_.:/-]+))\s*$/.exec(cell);
      const value = literal?.[1] ?? literal?.[2];
      if (flags === undefined || value === undefined || /^-+$/.test(value)) continue;
      const cellStart = row[0].indexOf('|') + 1 + cells.slice(0, column).reduce((sum, part) => sum + part.length + 1, 0);
      const start = bodyStart + row.index + cellStart + cell.indexOf(value);
      out.push({
        start,
        end: start + value.length,
        high: true,
        normalized: { type: 'cli', program: usage.name, subcommands, flags, defaultValue: value },
      });
    }
  }
}

/**
 * Option tables (`| -p or --port |`) and `Usage:` glossaries (`  -source  Location`).
 * Each flag is its own claim so one wrong flag does not hide the others.
 */
function extractGlossary(ctx: BlockContext, out: Candidate[], source: { text: string; offset: number }): void {
  const text = ctx.text;
  const rows = /^\|([^|\n]*)\|/gm;
  for (const m of text.matchAll(rows)) {
    const cell = m[1] ?? '';
    const flags = flagsInCell(cell);
    const program = usageBefore(source.text, source.offset + m.index)?.name;
    if (flags === undefined || program === undefined) continue;
    const cellStart = m.index + 1;
    let from = 0;
    for (const flag of flags) {
      const at = cell.indexOf(flag, from);
      if (at === -1) continue;
      from = at + flag.length;
      pushFlag(out, cellStart + at, flag, program, inCodeFlag(ctx, cellStart + at, flag.length));
    }
  }

  for (const region of ctx.codeRegions) {
    const body = text.slice(region.start, region.end);
    const hits: ProgramHit[] = [];
    for (const m of body.matchAll(/Usage:\s*([a-z][a-z0-9_-]{0,39})/g)) {
      const name = m[1];
      if (name === undefined || EXTERNAL_TOOLS.has(name) || !PROGRAM_RE.test(name)) continue;
      hits.push({ name, at: m.index });
    }
    if (hits.length === 0) continue;
    const lines = /^[ \t]*(-{1,2}[A-Za-z][A-Za-z0-9-]{0,39})\b.*$/gm;
    for (const m of body.matchAll(lines)) {
      const flag = m[1];
      if (flag === undefined || !FLAG_RE.test(flag)) continue;
      const at = region.start + m.index + (m[0].length - m[0].trimStart().length);
      const program = [...hits].reverse().find((hit) => hit.at < m.index)?.name ?? hits[0]?.name;
      if (program === undefined) continue;
      pushFlag(out, at, flag, program, true);
    }
  }
}

function inCodeFlag(ctx: BlockContext, start: number, length: number): boolean {
  return ctx.codeRegions.some((region) => start >= region.start && start + length <= region.end);
}

export function extractCli(ctx: BlockContext, source = { text: ctx.text, offset: 0 }): Candidate[] {
  const out: Candidate[] = [];
  for (const segment of ctx.segments) {
    for (const command of tokenizeSegment(segment)) {
      const tokens = stripPrefix(command.tokens);
      const first = tokens[0];
      const last = tokens[tokens.length - 1];
      if (!first || !last || first.quoted) continue;
      const program = first.value;
      if (!PROGRAM_RE.test(program)) continue;
      const args = tokens.slice(1);
      let parsed: Parsed | null;
      if (program === 'npm' || program === 'yarn' || program === 'pnpm') {
        parsed = parseRunner(program, args);
      } else if (program === 'make') {
        parsed = parseMake(args);
      } else if (EXTERNAL_TOOLS.has(program)) {
        parsed = null;
      } else {
        parsed = parseGeneric(program, args);
      }
      if (!parsed) continue;
      out.push({
        start: first.start,
        end: last.end,
        high: true,
        normalized: { type: 'cli', program: parsed.program, subcommands: parsed.subcommands, flags: parsed.flags },
      });
    }
  }
  extractGlossary(ctx, out, source);
  extractTableDefaults(ctx, out, source);
  return out;
}
