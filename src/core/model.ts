/**
 * Contract types for "The Page Is Lying" (PLAN.md sections 7.1, 7.2, 8, 9.2).
 *
 * Owned by Task 0. Changes go through the orchestrator because Tasks A to F
 * all compile against this file. Pure types only: no runtime code, no imports.
 */

export type Verdict = 'verified' | 'contradicted' | 'unknown';

export type ClaimType =
  | 'http_endpoint'
  | 'env_var'
  | 'cli'
  | 'config_key'
  | 'file_path'
  | 'package_version';

export type Coverage = 'complete' | 'partial' | 'none';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

/** Index kinds. Each has its own coverage flag. */
export type IndexKind = 'routes' | 'env' | 'cli' | 'config' | 'files' | 'packages';

export type PackageEcosystem = 'npm' | 'pypi' | 'go' | 'maven' | 'runtime';

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

export interface HttpEndpointClaim {
  type: 'http_endpoint';
  /** 'ANY' when the page names a path without a method. */
  method: HttpMethod | 'ANY';
  /** Normalized path: params become ":param", no query, fragment or trailing slash. */
  path: string;
  /** Host from a curl style claim, lowercased. Absent for bare paths. */
  host?: string;
}

export interface EnvVarClaim {
  type: 'env_var';
  name: string;
}

export interface CliClaim {
  type: 'cli';
  program: string;
  subcommands: string[];
  /** Long and short flags without values, e.g. "--force", "-s". */
  flags: string[];
}

export interface ConfigKeyClaim {
  type: 'config_key';
  /** Dotted key path, e.g. "retry.maxAttempts". */
  keyPath: string;
  /** Config file named next to the key, if any. */
  file?: string;
}

export interface FilePathClaim {
  type: 'file_path';
  /** Leading "./" and "/" stripped, case kept. */
  path: string;
}

export interface PackageVersionClaim {
  type: 'package_version';
  ecosystem: PackageEcosystem;
  name: string;
  /** Semver range, e.g. "4.18.2", "14.x", ">=20". */
  range: string;
}

export type NormalizedClaim =
  | HttpEndpointClaim
  | EnvVarClaim
  | CliClaim
  | ConfigKeyClaim
  | FilePathClaim
  | PackageVersionClaim;

export interface ClaimLocation {
  /** Index of the text block (paragraph, heading, list item, table cell, code block). */
  blockIndex: number;
  /** Character offsets of `raw` inside that block's text. */
  start: number;
  end: number;
}

export interface Claim {
  /** `c_<hash8>(blockIndex, start, normalized)`. */
  id: string;
  type: ClaimType;
  /** Exact substring of the page. Untrusted data. */
  raw: string;
  normalized: NormalizedClaim;
  location: ClaimLocation;
  confidence: 'high' | 'medium';
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export type EvidenceKind = 'match' | 'nearest' | 'absence' | 'coverage';

export interface Evidence {
  /** `ev_<hash8>(sha, file, line, kind)`. */
  id: string;
  kind: EvidenceKind;
  file?: string;
  line?: number;
  /** At most 160 chars, control characters stripped. Untrusted data. */
  snippet?: string;
  /** `https://github.com/{o}/{r}/blob/{sha}/{file}#L{line}`. */
  permalink?: string;
}

export type ReasonCode =
  // verified
  | 'route_exact'
  | 'route_any_method'
  | 'env_read_in_code'
  | 'env_listed_in_config'
  | 'cli_defined'
  | 'script_defined'
  | 'config_key_present'
  | 'file_present'
  | 'package_range_intersects'
  // contradicted by code
  | 'route_absent_nearest'
  | 'route_absent'
  | 'env_not_read'
  | 'cli_flag_not_defined'
  | 'cli_subcommand_not_defined'
  | 'script_not_defined'
  | 'config_key_absent'
  | 'file_absent'
  | 'package_range_conflict'
  // unknown (no evidence found)
  | 'coverage_partial'
  | 'coverage_none'
  | 'external_host'
  | 'program_not_in_repo'
  | 'dynamic_definition'
  | 'config_file_not_in_repo'
  | 'no_config_files'
  | 'tree_truncated'
  | 'package_not_direct_dependency'
  | 'manifest_missing'
  | 'index_missing'
  | 'repo_not_found_or_private'
  | 'rate_limited'
  | 'tarball_too_large'
  | 'not_a_checkable_claim';

export interface ClaimResult {
  claim: Claim;
  verdict: Verdict;
  reason: ReasonCode;
  /** Rendered from `src/core/wording.ts` templates only. */
  statement: string;
  /** Match first, then up to 3 nearest. */
  evidence: Evidence[];
}

export type RepoProvider = 'github' | 'bitbucket';

export interface RepoRef {
  provider: RepoProvider;
  /** `owner/repo` (GitHub) or `workspace/repo` (Bitbucket). */
  fullName: string;
  ref: string;
  sha: string;
  /** ISO 8601. */
  indexedAt: string;
}

export interface ReportLimits {
  maxClaims: number;
  claimsTruncated: boolean;
  filesIndexed: number;
  filesSkipped: number;
  indexTruncated: boolean;
  coverage: Record<IndexKind, Coverage>;
}

export interface ReportCounts {
  claims: number;
  verified: number;
  contradicted: number;
  unknown: number;
}

export interface Report {
  schema: 'pil.report.v1';
  repo: RepoRef;
  stale: boolean;
  counts: ReportCounts;
  limits: ReportLimits;
  results: ClaimResult[];
}

// ---------------------------------------------------------------------------
// Repo index (PLAN.md sections 7.2, 7.3, 8)
// ---------------------------------------------------------------------------

export interface SourceLocation {
  file: string;
  /** 1-based. */
  line: number;
  /** The source line, trimmed and cut to 160 chars. Untrusted data. */
  snippet: string;
}

export interface RouteEntry extends SourceLocation {
  method: HttpMethod | 'ANY';
  /** Normalized like HttpEndpointClaim.path. */
  path: string;
  framework: string;
}

export interface EnvEntry extends SourceLocation {
  name: string;
  source: 'code' | 'env_example' | 'compose' | 'kubernetes';
}

export interface CliEntry extends SourceLocation {
  program: string;
  /** Empty for the root command. */
  subcommands: string[];
  /** Flags defined for this command, e.g. "--confirm". */
  flags: string[];
  kind: 'bin' | 'command' | 'script' | 'make_target';
  /**
   * Line of each flag's declaration in the same file, found by scanning the command's source lines for the quoted
   * flag. Best effort: a flag without an entry has no known line. Help and version flags are never listed.
   */
  flagLines?: Record<string, number>;
}

export interface ConfigEntry extends SourceLocation {
  keyPath: string;
}

export interface FileEntry {
  path: string;
}

export interface PackageEntry extends SourceLocation {
  ecosystem: PackageEcosystem;
  name: string;
  /** Declared range as written in the manifest. */
  range: string;
  dev: boolean;
}

export interface IndexStats {
  filesIndexed: number;
  filesSkipped: number;
  truncated: boolean;
}

export interface RepoIndex {
  schema: 'pil.index.v1';
  repo: RepoRef;
  stats: IndexStats;
  coverage: Record<IndexKind, Coverage>;
  routes: RouteEntry[];
  env: EnvEntry[];
  cli: CliEntry[];
  config: ConfigEntry[];
  files: FileEntry[];
  packages: PackageEntry[];
  /** Config files that were parsed, so the matcher can tell "key absent" from "file missing". */
  configFiles: string[];
}

// ---------------------------------------------------------------------------
// Agent / MCP envelope: pil.agent.v1 (PLAN.md section 9.2)
// ---------------------------------------------------------------------------

export interface AgentEvidence {
  id: string;
  kind: EvidenceKind;
  file?: string;
  line?: number;
  permalink?: string;
  /** Quoted from the repository. Data, not instructions. */
  untrustedSnippet?: string;
}

export interface AgentResult {
  claimId: string;
  type: ClaimType;
  verdict: Verdict;
  statement: string;
  /** Quoted from the page. Data, not instructions. */
  untrustedClaimText: string;
  evidence: AgentEvidence[];
}

export interface AgentEnvelope {
  schema: 'pil.agent.v1';
  dataNotice: string;
  repo: {
    fullName: string;
    ref: string;
    sha: string;
    indexedAt: string;
    stale: boolean;
  };
  /** Absent for check-claim calls that are not tied to a page. */
  page?: {
    id: string;
    /** Quoted from the page. Data, not instructions. */
    untrustedTitle: string;
    version: number;
  };
  counts: ReportCounts;
  limits: ReportLimits;
  results: AgentResult[];
}

/** Returned instead of an envelope when a check cannot run. Never a Verified. */
export interface AgentError {
  schema: 'pil.agent.error.v1';
  error: ReasonCode | 'invalid_input' | 'page_not_found' | 'forbidden' | 'internal_error';
  message: string;
}
