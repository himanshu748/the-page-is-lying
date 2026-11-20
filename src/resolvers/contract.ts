/**
 * Payload shapes shared by the UI resolvers (src/resolvers/ui.ts) and the Custom UI (static/ui/src).
 * Types only, so the UI bundle imports nothing at runtime from here.
 */
import type { AuditEnvelope } from '../actions/auditSpace';
import type { PageContact } from '../actions/contacts';
import type { Coverage, IndexKind, Report } from '../core/model';

export type { AuditEnvelope, AuditedPage } from '../actions/auditSpace';
export type { PageContact } from '../actions/contacts';

export interface PageInfo {
  id: string;
  /** Quoted from the page. Rendered as text only. */
  title: string;
  version: number;
}

/** Result of a check. `report` is also present on `indexing` and `rate_limited` when a stale index answered. */
export type CheckResponse =
  | { state: 'ready'; report: Report; page?: PageInfo }
  | { state: 'indexing'; report?: Report }
  | { state: 'rate_limited'; retryAfterSeconds?: number; report?: Report }
  | { state: 'repo_not_found' }
  | { state: 'no_repo' }
  | { state: 'error'; message: string };

export interface CheckBodyPayload {
  /** ADF of the bodied macro (extension.macro.body). Capped at 400 KB. */
  adf: unknown;
  contentId?: string;
  config?: { repoUrl?: string; ref?: string };
}

export interface CheckPagePayload {
  contentId: string;
}

export interface SettingsView {
  repoUrl: string;
  ref: string;
  serviceHosts: string[];
  jiraProjectId: string;
  jiraIssueTypeId: string;
  /** True when a token is stored. The token itself is never returned. */
  tokenSaved: boolean;
}

export interface SaveSettingsPayload {
  repoUrl: string;
  ref?: string;
  serviceHosts?: string[];
  jiraProjectId?: string;
  jiraIssueTypeId?: string;
  /** Write-only. Omit to keep the stored token. */
  token?: string;
  clearToken?: boolean;
}

export type SaveSettingsResponse =
  | { ok: true; settings: SettingsView }
  | { ok: false; error: 'forbidden' | 'invalid'; message: string };

export interface IndexStatus {
  state: 'none' | 'indexing' | 'ready' | 'error';
  ref?: string;
  sha?: string;
  indexedAt?: string;
  filesIndexed?: number;
  filesSkipped?: number;
  truncated?: boolean;
  coverage?: Record<IndexKind, Coverage>;
  /** Short reason code or message, no repo text. */
  lastError?: string;
}

export type IndexNowResponse = { ok: true } | { ok: false; error: 'forbidden' | 'invalid'; message: string };

export interface JiraTarget {
  projectId: string;
  issueTypeId: string;
}

export interface BylineProperties {
  title: string;
  tooltip: string;
}

export interface PageContactsPayload {
  contentId: string;
}

/** Owner, last editor and creator of the page. Empty when they cannot be read. */
export interface PageContactsResponse {
  contacts: PageContact[];
}

/** Space drift page. `audit` is the same `pil.agent.audit.v1` result the audit-space tool returns. */
export type DriftResponse =
  | { state: 'ready'; audit: AuditEnvelope }
  | { state: 'indexing' }
  | { state: 'no_repo' }
  | { state: 'repo_not_found' }
  | { state: 'rate_limited' }
  | { state: 'error'; message: string };
