import type { BlockContext, Candidate } from './context';
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
    } else if (collecting && !token.quoted && SUBCOMMAND_RE.test(value) && subcommands.length < MAX_SUBCOMMANDS) {
      subcommands.push(value);
    } else {
      collecting = false;
    }
  }
  return subcommands.length > 0 || flags.length > 0 ? { program, subcommands, flags } : null;
}

export function extractCli(ctx: BlockContext): Candidate[] {
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
  return out;
}
