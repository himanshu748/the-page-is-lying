/**
 * buildRepoIndex: (path, text) files -> RepoIndex with per-kind coverage (PLAN.md 7.3).
 * Pure: no network, no Forge, nothing from the repo is executed.
 */
import type { CliEntry, Coverage, IndexKind, IndexStats, RepoIndex, RepoRef } from '../model';
import { indexConfigTree, isConfigCandidate } from './config';
import {
  finalizeCli,
  indexArgparse,
  indexClick,
  indexCommander,
  indexGoCli,
  indexMakefile,
  indexPackageCli,
  indexPicocli,
  indexYargs,
} from './cli';
import { indexCompose, indexEnvExample, indexEnvInCode, indexKubernetes, isComposeFile, isEnvExampleFile } from './env';
import { indexGoMod, indexGradle, indexPackageJson, indexPom, indexPyproject, indexRequirements, pyprojectScripts } from './packages';
import { indexGoRoutes, indexJavaRoutes, indexJsRoutes, indexOpenApi, indexPythonRoutes, looksLikeOpenApi, maskFor, resolveRoutes } from './routes';
import { parseJsonTree, parseYamlTrees } from './structured';
import type { TreeNode } from './structured';
import { baseName, extOf, snippetOf, splitLines } from './text';
import { newAcc } from './types';
import type { IndexAcc, RepoFile } from './types';

export const MAX_ENTRIES_PER_KIND = 20000;
export const MAX_TREE_PATHS = 20000;
const MAX_STRUCTURED_BYTES = 200_000;

const JS_EXT = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts']);
/** Source languages we do not parse. Their presence makes routes, env and cli partial. */
const UNSUPPORTED_SOURCE = new Set(['rs', 'php', 'cs', 'scala', 'swift', 'cpp', 'cc', 'c', 'm', 'ex', 'exs', 'erl', 'clj', 'dart', 'lua', 'pl', 'rb', 'kt', 'kts', 'groovy']);

export interface IndexContext {
  repo: RepoRef;
  stats: IndexStats;
  /** Every path in the snapshot, including skipped and binary files. Defaults to the text files seen. */
  treePaths?: string[];
}

export interface IndexBuilder {
  addFile(file: RepoFile): void;
  finish(ctx: IndexContext): RepoIndex;
}

export function createIndexBuilder(): IndexBuilder {
  const acc = newAcc([]);
  const seen: string[] = [];
  const pending: RepoFile[] = [];
  return {
    addFile(file) {
      seen.push(file.path);
      pending.push(file);
    },
    finish(ctx) {
      const paths = ctx.treePaths ?? seen;
      for (const p of paths) acc.paths.add(p);
      for (const p of seen) acc.paths.add(p);
      for (const f of pending) indexFile(acc, f);
      pending.length = 0;
      return finishIndex(acc, ctx, paths);
    },
  };
}

export function buildRepoIndex(files: Iterable<RepoFile>, ctx: IndexContext): RepoIndex {
  const b = createIndexBuilder();
  for (const f of files) b.addFile(f);
  return b.finish(ctx);
}

function guard(acc: IndexAcc, kinds: IndexKind[], fn: () => void): void {
  try {
    fn();
  } catch {
    for (const k of kinds) acc.partial[k] = true;
  }
}

function indexFile(acc: IndexAcc, file: RepoFile): void {
  const { path, text } = file;
  const base = baseName(path);
  const ext = extOf(path);

  if (UNSUPPORTED_SOURCE.has(ext)) {
    acc.partial.routes = true;
    acc.partial.cli = true;
    if (ext !== 'rb') acc.partial.env = true;
  }

  if (base === 'package.json') {
    guard(acc, ['packages', 'cli'], () => {
      const tree = parseJsonTree(text);
      if (!tree) {
        acc.partial.packages = true;
        acc.partial.cli = true;
        return;
      }
      indexPackageJson(acc, path, text, tree);
      indexPackageCli(acc, path, text, tree);
    });
    return;
  }
  if (/^requirements(?:[-_.][\w.-]*)?\.txt$/.test(base) || /(^|\/)requirements\/[\w.-]+\.txt$/.test(path)) {
    guard(acc, ['packages'], () => indexRequirements(acc, path, text));
    return;
  }
  if (base === 'pyproject.toml') {
    guard(acc, ['packages', 'cli'], () => {
      indexPyproject(acc, path, text);
      const lines = splitLines(text);
      for (const s of pyprojectScripts(text)) {
        acc.binNames.push(s.name);
        acc.cli.push({ file: path, line: s.line, snippet: snippetOf(lines, s.line), program: s.name, subcommands: [], flags: [], kind: 'bin' });
      }
    });
    return;
  }
  if (base === 'setup.py' || base === 'setup.cfg') {
    guard(acc, ['cli'], () => {
      const lines = splitLines(text);
      lines.forEach((l, i) => {
        const m = /['"]?([\w-]+)\s*=\s*[\w.]+:\w+['"]?\s*,?\s*$/.exec(l);
        if (m && /console_scripts|entry_points/.test(text)) {
          acc.binNames.push(m[1] as string);
          acc.cli.push({ file: path, line: i + 1, snippet: snippetOf(lines, i + 1), program: m[1] as string, subcommands: [], flags: [], kind: 'bin' });
        }
      });
    });
  }
  if (base === 'go.mod') {
    guard(acc, ['packages'], () => indexGoMod(acc, path, text));
    return;
  }
  if (base === 'pom.xml') {
    guard(acc, ['packages'], () => indexPom(acc, path, text));
    return;
  }
  if (base === 'build.gradle' || base === 'build.gradle.kts') {
    guard(acc, ['packages'], () => indexGradle(acc, path, text));
    return;
  }
  if (base === 'Makefile' || base === 'makefile' || base === 'GNUmakefile') {
    guard(acc, ['cli'], () => indexMakefile(acc, path, text));
    return;
  }
  if (isEnvExampleFile(base)) {
    guard(acc, ['env'], () => indexEnvExample(acc, path, text));
    return;
  }

  if (ext === 'yaml' || ext === 'yml' || ext === 'json') {
    if (text.length > MAX_STRUCTURED_BYTES) return;
    guard(acc, ['config', 'env', 'routes'], () => {
      let trees: TreeNode[] | undefined;
      if (ext === 'json') {
        const t = parseJsonTree(text);
        trees = t ? [t] : undefined;
      } else trees = parseYamlTrees(text);
      if (!trees) {
        if (!text.includes('{{') && isConfigCandidate(path)) acc.partial.config = true;
        return;
      }
      const spec = looksLikeOpenApi(trees);
      if (spec) {
        indexOpenApi(acc, path, text, spec);
        return;
      }
      if (ext !== 'json' && isComposeFile(base)) {
        indexCompose(acc, path, text, trees);
        return;
      }
      if (ext !== 'json' && indexKubernetes(acc, path, text, trees)) return;
      if (isConfigCandidate(path)) indexConfigTree(acc, path, text, trees);
    });
    return;
  }

  const code = JS_EXT.has(ext) || ext === 'py' || ext === 'go' || ext === 'java' || ext === 'kt' || ext === 'rb';
  if (!code) return;
  if (/\.d\.[mc]?ts$/.test(path)) return;
  guard(acc, ['routes', 'env', 'cli'], () => {
    const masked = ext === 'rb' ? text : maskFor(path, text);
    if (ext !== 'rb') {
      indexEnvInCode(acc, path, text, masked, ext);
    } else indexEnvInCode(acc, path, text, text, ext);
    if (JS_EXT.has(ext)) {
      indexJsRoutes(acc, path, text, masked);
      indexCommander(acc, path, text, masked);
      indexYargs(acc, path, text, masked);
    } else if (ext === 'py') {
      indexPythonRoutes(acc, path, text, masked);
      indexArgparse(acc, path, text, masked);
      indexClick(acc, path, text, masked);
    } else if (ext === 'go') {
      indexGoRoutes(acc, path, text, masked);
      indexGoCli(acc, path, text, masked);
    } else if (ext === 'java') {
      indexJavaRoutes(acc, path, text, masked);
      indexPicocli(acc, path, text, masked);
    }
  });
}

function cap<T>(arr: T[], acc: IndexAcc, kind: IndexKind): T[] {
  if (arr.length <= MAX_ENTRIES_PER_KIND) return arr;
  acc.partial[kind] = true;
  return arr.slice(0, MAX_ENTRIES_PER_KIND);
}

function byLocation<T extends { file: string; line: number }>(a: T, b: T): number {
  return a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line;
}

function cover(partial: boolean, empty: boolean, truncated: boolean): Coverage {
  if (partial || truncated) return 'partial';
  return empty ? 'none' : 'complete';
}

function finishIndex(acc: IndexAcc, ctx: IndexContext, treePaths: string[]): RepoIndex {
  resolveRoutes(acc);
  finalizeCli(acc);

  const uniq = <T extends object>(items: T[], key: (t: T) => string): T[] => {
    const seen = new Set<string>();
    return items.filter((i) => {
      const k = key(i);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };

  const routes = cap(uniq(acc.routes, (r) => `${r.method} ${r.path} ${r.file}:${r.line}`).sort(byLocation), acc, 'routes');
  const env = cap(uniq(acc.env, (e) => `${e.name} ${e.source} ${e.file}:${e.line}`).sort(byLocation), acc, 'env');
  const cli = cap(uniq<CliEntry>(acc.cli, (c) => `${c.program} ${c.subcommands.join(' ')} ${c.kind} ${c.file}:${c.line}`).sort(byLocation), acc, 'cli');
  const config = cap(acc.config.sort(byLocation), acc, 'config');
  const packages = cap(uniq(acc.packages, (p) => `${p.ecosystem} ${p.name} ${p.file}:${p.line}`).sort(byLocation), acc, 'packages');

  const uniquePaths = [...new Set(treePaths)].sort();
  const treeTruncated = uniquePaths.length > MAX_TREE_PATHS;
  const files = (treeTruncated ? uniquePaths.slice(0, MAX_TREE_PATHS) : uniquePaths).map((path) => ({ path }));
  const truncated = ctx.stats.truncated || treeTruncated;

  const coverage: Record<IndexKind, Coverage> = {
    routes: cover(acc.partial.routes, routes.length === 0, truncated),
    env: cover(acc.partial.env, !acc.sawStaticEnv && env.length === 0, truncated),
    cli: cover(acc.partial.cli, cli.length === 0, truncated),
    config: cover(acc.partial.config, acc.configFiles.length === 0, truncated),
    files: truncated ? 'partial' : 'complete',
    packages: cover(acc.partial.packages, acc.manifestsParsed === 0, truncated),
  };

  return {
    schema: 'pil.index.v1',
    repo: ctx.repo,
    stats: { ...ctx.stats, truncated },
    coverage,
    routes,
    env,
    cli,
    config,
    files,
    packages,
    configFiles: [...new Set(acc.configFiles)].sort(),
  };
}
