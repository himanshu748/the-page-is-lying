import type {
  CliEntry,
  ConfigEntry,
  EnvEntry,
  HttpMethod,
  IndexKind,
  PackageEntry,
  RouteEntry,
} from '../model';

/** One text file from a repo snapshot. `text` is untrusted data. */
export interface RepoFile {
  /** Repo-relative posix path without a leading slash. */
  path: string;
  text: string;
}

export type ReceiverKind = 'root' | 'sub' | 'plugin';

/** A router or app object that routes are registered on. */
export interface Receiver {
  file: string;
  name: string;
  kind: ReceiverKind;
  framework: string;
  /** Bound to an Express import, whose GET routes also handle HEAD. */
  implicitHead?: true;
  /** Own prefix (Koa `prefix`, Flask `url_prefix`, FastAPI `prefix`, Hono `basePath`), or null if unresolved. */
  ownPrefix: string | null;
}

export interface RouteDef {
  file: string;
  line: number;
  snippet: string;
  method: HttpMethod | 'ANY';
  path: string;
  recv: string;
  framework: string;
}

export interface Mount {
  file: string;
  /** Name of the parent receiver in `file`. */
  parent: string;
  /** Literal mount prefix, or null when the runtime determines the prefix. */
  prefix: string | null;
  /** Flask registration replaces the blueprint default when given a prefix. */
  replaceOwnPrefix?: boolean;
  /** Local receiver name, resolved later against receivers in the same file. */
  local?: string;
  /** Import target as written; resolved later against the repo file list. */
  importSpec?: string;
  /** Python module and name for `from module import name`. */
  pyImport?: { module: string; name: string };
}

/** Everything the per-file builders write into. */
export interface IndexAcc {
  paths: Set<string>;
  routes: RouteEntry[];
  routeDefs: RouteDef[];
  receivers: Receiver[];
  mounts: Mount[];
  /** Files whose route registrations cannot be trusted (nested closures we do not model). */
  taintedRouteFiles: Set<string>;
  env: EnvEntry[];
  cli: CliEntry[];
  /** Root CLI entries whose program name is resolved after all files are seen. */
  cliRoots: Array<{ entry: CliEntry; needsName: boolean }>;
  config: ConfigEntry[];
  configFiles: string[];
  packages: PackageEntry[];
  manifestsParsed: number;
  partial: Record<IndexKind, boolean>;
  /** Names declared under package.json "bin" or pyproject scripts: bin name -> file hint. */
  binNames: string[];
  packageName?: string;
  /** Set when at least one static item of that kind was seen, used for none vs complete. */
  sawStaticEnv: boolean;
}

export function newAcc(paths: Iterable<string>): IndexAcc {
  return {
    paths: new Set(paths),
    routes: [],
    routeDefs: [],
    receivers: [],
    mounts: [],
    taintedRouteFiles: new Set(),
    env: [],
    cli: [],
    cliRoots: [],
    config: [],
    configFiles: [],
    packages: [],
    manifestsParsed: 0,
    partial: { routes: false, env: false, cli: false, config: false, files: false, packages: false },
    binNames: [],
    sawStaticEnv: false,
  };
}
