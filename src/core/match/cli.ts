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
import { describeClaim, makeEvidence, makeSuggestion, sanitizeUntrusted, toResult } from './evidence';
import { rankNames } from './nearest';
import { absenceEvidence, coverageReason, unknownResult, type MatchContext } from './results';

const PACKAGE_MANAGERS = new Set(['npm', 'yarn', 'pnpm', 'bun']);
const SCRIPT_SHORTCUTS = new Set(['start', 'test', 'stop', 'restart']);
const PACKAGE_MANAGER_BUILTINS = new Set([
  'install', 'i', 'ci', 'add', 'remove', 'update', 'upgrade', 'publish', 'pack', 'audit', 'init', 'link', 'login', 'exec', 'dlx', 'x',
]);
const ALWAYS_DEFINED_FLAGS = new Set(['--help', '-h', '--version', '-V']);
const NODE_RUNTIME_FLAGS = new Set(['--inspect', '--inspect-brk', '--require', '-r']);

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
    // The same command line with the defined script or target in place of the missing one.
    makeSuggestion(names.map((candidate) => editCommand(claim.raw, n.program, [name], candidate) ?? swapToken(n, name, candidate)), top ? evidence[0] : undefined),
  );
}

/** The claim's command line with one token replaced. Flags are kept. */
function swapToken(n: CliClaim, from: string, to: string): string {
  const subs = n.subcommands.some((token) => token === from) ? n.subcommands.map((token) => (token === from ? to : token)) : [...n.subcommands, to];
  return [n.program, ...subs, ...n.flags].join(' ');
}

/**
 * The command as the page wrote it, with the tokens in `remove` (in order) replaced by `insert`, or dropped
 * when `insert` is empty. Every other token stays, so arguments and flag values the normalized claim does not
 * keep (`<paymentId>`, `--amount 500`) are not lost from the proposed edit. The search starts after the
 * program, so `deploy deploy` edits the subcommand and not the executable. Undefined when a token is not in
 * the text.
 */
function editCommand(raw: string, program: string, remove: readonly string[], insert: string, keepAssignment = false): string | undefined {
  const tokens = raw.trim().split(/\s+/);
  const at: number[] = [];
  let from = tokens.indexOf(program) + 1;
  for (const wanted of remove) {
    const isFlag = wanted.startsWith('-');
    const found = tokens.findIndex((token, i) => i >= from && (token === wanted || (isFlag && token.startsWith(`${wanted}=`))));
    if (found === -1) return undefined;
    at.push(found);
    from = found + 1;
  }
  const first = at[0];
  if (first === undefined) return undefined;
  const drop = new Set(at);
  const assigned = keepAssignment && tokens[first]?.includes('=') ? tokens[first].slice(tokens[first].indexOf('=')) : '';
  return tokens.flatMap((token, i) => (i === first && insert !== '' ? [insert + assigned] : drop.has(i) ? [] : [token])).join(' ');
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
  const samePath = (entry: CliEntry): boolean =>
    entry.subcommands.length === subs.length && entry.subcommands.every((sub, i) => sub === subs[i]);
  const matched = programEntries.filter(samePath);
  if (n.defaultValue !== undefined) {
    const commands = matched.filter((entry) => entry.kind === 'command');
    const definitions = commands.flatMap((entry) => n.flags.flatMap((flag) => {
      const definition = entry.flagDefaults?.[flag];
      return definition === undefined ? [] : [{ ...definition, file: entry.file }];
    }));
    const definition = definitions[0];
    if (commands.length !== 1 || definition === undefined || definitions.length !== n.flags.length ||
        definitions.some((entry) => entry.value !== definition.value)) {
      return unknownResult(claim, ctx, 'cli_default_unresolved');
    }
    const stated = typeof definition.value === 'number' && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(n.defaultValue)
      ? Number(n.defaultValue)
      : n.defaultValue;
    if (definition.value === stated) {
      return toResult(claim, 'verified', 'cli_default_matches', verifiedStatement({ claim: text, file: definition.file, line: definition.line }), [
        makeEvidence(index, 'match', definition),
      ]);
    }
    return toResult(
      claim,
      'contradicted',
      'cli_default_mismatch',
      contradictedGenericStatement({
        claim: text,
        detail: `The option declaration in ${sanitizeUntrusted(definition.file)}:${definition.line} specifies ${sanitizeUntrusted(String(definition.value))}.`,
      }),
      [makeEvidence(index, 'nearest', definition)],
    );
  }
  // A package.json bin and the parser that implements it are one command. Cite the source entry.
  const target = matched.find((entry) => entry.kind === 'command' && entry.flags.some((flag) => !ALWAYS_DEFINED_FLAGS.has(flag))) ?? matched.find((entry) => entry.kind === 'command') ?? matched[0];
  const coverage = index.coverage.cli;
  const hasSubcommandEntries = programEntries.some((entry) => entry.subcommands.length > 0);
  const knownFlags = (): Set<string> => {
    const known = new Set<string>();
    for (const entry of matched) for (const flag of entry.flags) known.add(flag);
    if (subs.length > 0) {
      for (const entry of programEntries) {
        if (entry.subcommands.length === 0) for (const flag of entry.flags) known.add(flag);
      }
    }
    return known;
  };

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
      makeSuggestion(
        names.map((candidate) => editCommand(claim.raw, n.program, subs, candidate) ?? `${n.program} ${candidate}`),
        top ? evidence[0] : undefined,
      ),
    );
  }

  const known = knownFlags();
  const undefinedFlags = n.flags.filter((flag) => !known.has(flag) && !ALWAYS_DEFINED_FLAGS.has(flag));
  if (undefinedFlags.length === 0) {
    return toResult(claim, 'verified', 'cli_defined', verifiedStatement({ claim: text, file: target.file, line: target.line }), [
      makeEvidence(index, 'match', target),
    ]);
  }
  const unsupportedFlags = undefinedFlags.filter((flag) => !(target.passesUnknownFlags && NODE_RUNTIME_FLAGS.has(flag)));
  const missing = unsupportedFlags[0];
  if (missing === undefined) {
    return unknownResult(claim, ctx, 'dynamic_definition', 'cli', [makeEvidence(index, 'nearest', target)]);
  }
  const incompleteDefinition = matched.some((entry) => entry.flagsComplete === false);
  const incompleteRoot = subs.length > 0 && programEntries.some(
    (entry) => entry.subcommands.length === 0 && entry.flagsComplete === false,
  );
  if (coverage !== 'complete' && (target.flagsComplete !== true || incompleteDefinition || incompleteRoot)) {
    return unknownResult(claim, ctx, coverageReason(coverage), 'cli', [makeEvidence(index, 'nearest', target)]);
  }
  // The command without any flag the code does not define, so the proposed edit is not itself contradicted.
  // The defined flags the page does not already use are the alternatives.
  const kept = [n.program, ...n.subcommands, ...n.flags.filter((flag) => !unsupportedFlags.includes(flag))];
  const withoutFlag = editCommand(claim.raw, n.program, unsupportedFlags, '') ?? kept.join(' ');
  const withFlag = (flag: string): string => editCommand(claim.raw, n.program, unsupportedFlags, flag) ?? [...kept, flag].join(' ');
  const unused = target.flags.filter((flag) => !n.flags.includes(flag));
  const otherSpelling = missing.startsWith('--') ? missing.slice(1) : `-${missing}`;
  const correctedFlag = unsupportedFlags.length === 1 && unused.includes(otherSpelling) ? otherSpelling : undefined;
  const correctedLine = correctedFlag === undefined ? undefined : target.flagLines?.[correctedFlag];
  const definition = makeEvidence(index, 'nearest', correctedLine === undefined ? target : { file: target.file, line: correctedLine });
  const repairs = [withoutFlag, ...unused.map(withFlag)];
  if (correctedFlag !== undefined) {
    repairs.unshift(editCommand(claim.raw, n.program, unsupportedFlags, correctedFlag, true) ?? withFlag(correctedFlag));
  }
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
      line: correctedLine ?? target.line,
    }),
    [definition, ...declaredFlagEvidence(index, target).filter((item) => item.id !== definition.id), absenceEvidence(ctx, 'cli')],
    makeSuggestion(repairs, definition),
  );
}

/** Where the command's real flags are declared (up to two), so the citation shows what the code does define. */
function declaredFlagEvidence(index: RepoIndex, target: CliEntry): Evidence[] {
  const lines = Object.values(target.flagLines ?? {})
    .filter((line) => line !== target.line)
    .sort((a, b) => a - b);
  return [...new Set(lines)].slice(0, 2).map((line) => makeEvidence(index, 'nearest', { file: target.file, line }));
}
