/**
 * Adapter between the UI resolvers and the rest of the app (Task C's check service, Task B's storage).
 * Resolvers only talk to this interface. Integration replaces `defaultBackend` with the real wiring
 * through `setBackend()` or by editing `defaultBackend.ts`.
 */
import type { ReportCounts } from '../core/model';
import type { CheckResponse, IndexStatus, PageInfo } from './contract';

export interface StoredSettings {
  repoUrl: string;
  ref: string;
  serviceHosts: string[];
  jiraProjectId: string;
  jiraIssueTypeId: string;
}

export interface CheckDocumentInput {
  adf: unknown;
  /** Optional per-macro repository override, already validated. */
  repoUrl?: string;
  ref?: string;
  contentId?: string;
}

export interface PageContent extends PageInfo {
  adf: unknown;
}

export interface UiBackend {
  /** Wire to Task C `checkDocument`. Must map storage and fetch failures to the non-ready states. */
  checkDocument(input: CheckDocumentInput): Promise<CheckResponse>;
  /** Read the page ADF as the calling user (`asUser().requestConfluence`). Null when not found or not visible. */
  readPage(contentId: string): Promise<PageContent | null>;
  /** True when the calling user administers Confluence. */
  isAdmin(accountId: string | undefined): Promise<boolean>;
  loadSettings(): Promise<StoredSettings>;
  /** `token` undefined keeps the stored one; `clearToken` removes it. Never returns the token. */
  saveSettings(settings: StoredSettings, token: { set?: string; clear?: boolean }): Promise<void>;
  hasToken(): Promise<boolean>;
  getIndexStatus(): Promise<IndexStatus>;
  /** Push `{repoKey}` to queue repo-index (Task B). */
  enqueueIndex(): Promise<void>;
  saveCounts(contentId: string, version: number, counts: ReportCounts): Promise<void>;
  /** `version` undefined means the latest stored counts for the page. */
  getCounts(contentId: string, version: number | undefined): Promise<ReportCounts | null>;
}

let current: UiBackend | undefined;

export function setBackend(backend: UiBackend | undefined): void {
  current = backend;
}

export async function getBackend(): Promise<UiBackend> {
  if (current) return current;
  const { defaultBackend } = await import('./defaultBackend');
  current = defaultBackend;
  return current;
}
