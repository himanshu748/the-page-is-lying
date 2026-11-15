/**
 * cli rules (PLAN.md 7.2).
 *
 * Index conventions assumed from Task B (see report): `bin`/`command` entries carry the program and its
 * subcommand path; `script` entries (package.json scripts) and `make_target` entries are matched by the last
 * element of `subcommands`, or by `program` when `subcommands` is empty.
 */
import type { Claim, ClaimResult, CliClaim, CliEntry, Evidence, RepoIndex } from '../model';
import {
  alternativesDetail,
  contradictedCliFlagStatement,
  contradictedGenericStatement,
  verifiedStatement,
} from '../wording';
import { describeClaim, makeEvidence, sanitizeUntrusted, toResult } from './evidence';
import { rankNames } from './nearest';
import { absenceEvidence, coverageReason, unknownResult, type MatchContext } from './results';

const PACKAGE_MANAGERS = new Set(['npm', 'yarn', 'pnpm', 'bun']);
const SCRIPT_SHORTCUTS = new Set(['start', 'test', 'stop', 'restart']);
const PACKAGE_MANAGER_BUILTINS = new Set([
  'install', 'i', 'ci', 'add', 'remove', 'update', 'upgrade', 'publish', 'pack', 'audit', 'init', 'link', 'login', 'exec', 'dlx', 'x',
]);
const ALWAYS_DEFINED_FLAGS = new Set(['--help', '-h', '--version', '-V']);

function isPlaceholder(token: string): boolean {
  return /^[<[${(]/.test(token) || token.includes('{') || token.includes('}');
}

function entryName(entry: CliEntry): string {
  return entry.subcommands.length > 0 ? (entry.subcommands[entry.subcommands.length - 1] ?? entry.program) : entry.program;
}

function matchTargetRunner(
  claim: Claim,
  n: CliClaim,
  ctx: MatchContext,
  kind: 'script' | 'make_target',
  name: string,
  label: string,
): ClaimResult {
  const { index } = ctx;
  const entries = index.cli.filter((entry) => entry.kind === kind);
  const hit = entries.find((entry) => entryName(entry) === name);
  if (hit) {
    return toResult(claim, 'verified', 'script_defined', verifiedStatement({ claim: describeClaim(n), file: hit.file, line: hit.line }), [
      makeEvidence(index, 'match', hit),
    ]);
  }
  const coverage = index.coverage.cli;
  if (coverage !== 'complete') return unknownResult(claim, ctx, coverageReason(coverage), 'cli');
  if (entries.length === 0) return unknownResult(claim, ctx, kind === 'script' ? 'manifest_missing' : 'program_not_in_repo', 'cli');
  const names = rankNames(name, entries.map(entryName));
  const nearest = names
    .map((candidate) => entries.find((entry) => entryName(entry) === candidate))
    .filter((entry): entry is CliEntry => entry !== undefined);
  const top = nearest[0];
  const evidence = nearest.map((entry) => makeEvidence(index, 'nearest', entry));
  evidence.push(absenceEvidence(ctx, 'cli'));
  return toResult(
    claim,
    'contradicted',
    'script_not_defined',
    contradictedGenericStatement({
      claim: `${label} does not define ${sanitizeUntrusted(name)}`,
      detail: alternativesDetail({
        label: 'It defines',
        items: names,
        ...(top ? { file: top.file, line: top.line } : {}),
      }),
    }),
    evidence,
  );
}

export function matchCli(claim: Claim, n: CliClaim, ctx: MatchContext): ClaimResult {
  const { index } = ctx;
  const subs = n.subcommands.filter((token) => !isPlaceholder(token));

  if (PACKAGE_MANAGERS.has(n.program)) {
    const first = subs[0];
    let name: string | undefined;
    if (first === 'run' || first === 'run-script') name = subs[1];
    else if (first !== undefined && (SCRIPT_SHORTCUTS.has(first) || (n.program !== 'npm' && !PACKAGE_MANAGER_BUILTINS.has(first)))) name = first;
    if (name === undefined) return unknownResult(claim, ctx, 'program_not_in_repo', 'cli');
    const result = matchTargetRunner(claim, n, ctx, 'script', name, 'package.json');
    // `npm test` or `npm start` with no script falls back to the package manager default: not a contradiction.
    if (result.verdict === 'contradicted' && SCRIPT_SHORTCUTS.has(name) && first === name) {
      return unknownResult(claim, ctx, 'program_not_in_repo', 'cli');
    }
    return result;
  }

  if (n.program === 'make') {
    const target = subs[0];
    if (target === undefined) return unknownResult(claim, ctx, 'program_not_in_repo', 'cli');
    return matchTargetRunner(claim, n, ctx, 'make_target', target, 'Makefile');
  }

  const programEntries = index.cli.filter((entry) => entry.program === n.program && (entry.kind === 'bin' || entry.kind === 'command'));
  if (programEntries.length === 0) return unknownResult(claim, ctx, 'program_not_in_repo', 'cli');

  const text = describeClaim(n);
  const root = programEntries.find((entry) => entry.subcommands.length === 0);
  const target = programEntries.find(
    (entry) => entry.subcommands.length === subs.length && entry.subcommands.every((sub, i) => sub === subs[i]),
  );
  const coverage = index.coverage.cli;
  const hasSubcommandEntries = programEntries.some((entry) => entry.subcommands.length > 0);

  if (!target) {
    if (subs.length === 0) {
      // The program exists but only through subcommand entries. Its root is not parsed: cannot judge flags.
      return unknownResult(claim, ctx, 'dynamic_definition', 'cli');
    }
    // Without any subcommand entries the extra tokens may be positional arguments, not subcommands.
    if (!hasSubcommandEntries || coverage !== 'complete') {
      return unknownResult(claim, ctx, coverage === 'complete' ? 'dynamic_definition' : coverageReason(coverage), 'cli');
    }
    const defined = programEntries.filter((entry) => entry.subcommands.length > 0);
    const names = rankNames(subs.join(' '), defined.map((entry) => entry.subcommands.join(' ')));
    const nearest = names
      .map((candidate) => defined.find((entry) => entry.subcommands.join(' ') === candidate))
      .filter((entry): entry is CliEntry => entry !== undefined);
    const top = nearest[0];
    const evidence = nearest.map((entry) => makeEvidence(index, 'nearest', entry));
    evidence.push(absenceEvidence(ctx, 'cli'));
    return toResult(
      claim,
      'contradicted',
      'cli_subcommand_not_defined',
      contradictedGenericStatement({
        claim: `${[n.program, ...subs].join(' ')} is not a defined subcommand`,
        detail: alternativesDetail({ label: 'The program defines', items: names, ...(top ? { file: top.file, line: top.line } : {}) }),
      }),
      evidence,
    );
  }

  const known = new Set<string>([...target.flags, ...(root?.flags ?? [])]);
  const missing = n.flags.find((flag) => !known.has(flag) && !ALWAYS_DEFINED_FLAGS.has(flag));
  if (missing === undefined) {
    return toResult(claim, 'verified', 'cli_defined', verifiedStatement({ claim: text, file: target.file, line: target.line }), [
      makeEvidence(index, 'match', target),
    ]);
  }
  if (coverage !== 'complete') return unknownResult(claim, ctx, coverageReason(coverage), 'cli', [makeEvidence(index, 'nearest', target)]);
  return toResult(
    claim,
    'contradicted',
    'cli_flag_not_defined',
    contradictedCliFlagStatement({
      program: n.program,
      subcommand: subs.join(' '),
      flag: missing,
      defined: target.flags,
      file: target.file,
      line: target.line,
    }),
    [makeEvidence(index, 'nearest', target), ...declaredFlagEvidence(index, target), absenceEvidence(ctx, 'cli')],
  );
}

/** Where the command's real flags are declared (up to two), so the citation shows what the code does define. */
function declaredFlagEvidence(index: RepoIndex, target: CliEntry): Evidence[] {
  const lines = Object.values(target.flagLines ?? {})
    .filter((line) => line !== target.line)
    .sort((a, b) => a - b);
  return [...new Set(lines)].slice(0, 2).map((line) => makeEvidence(index, 'nearest', { file: target.file, line }));
}
