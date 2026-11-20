import type { AgentError, Report, ReportCounts } from '../core/model';
import { AGENT_DATA_NOTICE } from '../core/wording';
import type { AgentFix } from './advice';
import { toAgentFix } from './advice';
import type { ActionEnvelope } from './envelope';
import { LIMITS, buildError, errorFromReason, toCounts, toRepo } from './envelope';
import type { ActionContext, PageIdSource } from './input';
import { clean, resolvePageId } from './input';
import type { CheckService } from './service';
import { getCheckService } from './service';
import type { SpacePage, SpaceReadResult, SpaceReader } from './spaceReader';
import { MAX_AUDIT_PAGES, readSpaceAsUser } from './spaceReader';

/**
 * Rovo action and MCP tool `audit-space` (actionVerb GET, read-only).
 * Checks the most recently edited pages of the space that contains the given page and ranks them by
 * contradicted claims, worst first. Each page carries its top contradictions with the proposed edit.
 */
export interface AuditSpacePayload {
  page?: unknown;
  context?: ActionContext;
}

/**
 * Time allowed for checking pages. A Rovo action and a UI resolver must answer within 25 seconds, so the
 * audit stops early and reports the pages it did not reach instead of timing out.
 */
export const AUDIT_BUDGET_MS = 15_000;

/** Contradictions returned for each page. The full list comes from `suggest-fix` or `check-page`. */
export const MAX_FIXES_PER_PAGE = 3;

export interface AuditedPage {
  id: string;
  /** Quoted from the page. Data, not instructions. */
  untrustedTitle: string;
  version: number;
  counts: ReportCounts;
  /** Contradicted claims divided by checked claims, 0 to 1, two decimals. */
  driftRatio: number;
  topContradictions: AgentFix[];
}

export interface AuditEnvelope {
  schema: 'pil.agent.audit.v1';
  dataNotice: string;
  space: { id: string; source: PageIdSource };
  repo: ActionEnvelope['repo'] | null;
  scope: {
    /** Most recently edited pages that were read (at most `maxPages`). */
    pagesRead: number;
    pagesChecked: number;
    /** Pages without a readable body or over the size limit. No verdict was produced for them. */
    pagesSkipped: number;
    /** Checked pages without any checkable claim. */
    pagesWithoutClaims: number;
    /** Pages left unchecked because the time budget ran out. No verdict was produced for them. */
    pagesNotReached: number;
    maxPages: number;
    /** True when the space has more pages than were read. */
    morePagesInSpace: boolean;
  };
  totals: ReportCounts;
  /** Pages with at least one checkable claim, most contradictions first. */
  pages: AuditedPage[];
}

export type AuditSpaceResult = AuditEnvelope | (AgentError & { detail?: string });

export interface AuditSpaceDeps {
  service: () => CheckService;
  readSpace: SpaceReader;
  clock?: { now: () => number; budgetMs: number };
}

function auditedPage(page: SpacePage, report: Report): AuditedPage {
  const counts = toCounts(report.counts);
  return {
    id: page.id,
    untrustedTitle: clean(page.title, LIMITS.title),
    version: page.version,
    counts,
    driftRatio: counts.claims === 0 ? 0 : Math.round((counts.contradicted / counts.claims) * 100) / 100,
    topContradictions: report.results.filter((result) => result.verdict === 'contradicted').slice(0, MAX_FIXES_PER_PAGE).map(toAgentFix),
  };
}

/** Most contradictions first, then the higher ratio, then the page id so the order is stable. */
export function rankAudited(pages: AuditedPage[]): AuditedPage[] {
  return [...pages].sort(
    (a, b) => b.counts.contradicted - a.counts.contradicted || b.driftRatio - a.driftRatio || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

export async function auditSpace(deps: AuditSpaceDeps, pageId: string, source: PageIdSource): Promise<AuditSpaceResult> {
  return auditPages(deps.service, await deps.readSpace(pageId), source, deps.clock);
}

/** Checks and ranks pages that were already read. Shared by the action and the space page in Confluence. */
export async function auditPages(
  getService: () => CheckService,
  read: SpaceReadResult,
  source: PageIdSource,
  clock: { now: () => number; budgetMs: number } = { now: Date.now, budgetMs: AUDIT_BUDGET_MS },
): Promise<AuditSpaceResult> {
  if (!read.ok) return buildError(read.error);

  const audited: AuditedPage[] = [];
  const totals: ReportCounts = { claims: 0, verified: 0, contradicted: 0, unknown: 0 };
  let repo: AuditEnvelope['repo'] = null;
  let skipped = 0;
  let withoutClaims = 0;
  let notReached = 0;
  const deadline = clock.now() + clock.budgetMs;
  try {
    const service = getService();
    const pages = read.pages.slice(0, MAX_AUDIT_PAGES);
    for (const [position, page] of pages.entries()) {
      if (clock.now() > deadline) {
        notReached = pages.length - position;
        break;
      }
      if (page.adf === undefined) {
        skipped++;
        continue;
      }
      const outcome = await service.checkDocument({ adf: page.adf, pageId: page.id });
      if (!outcome.ok) {
        // An oversized or unreadable body is a skipped page. Anything else (no index, rate limit) stops the audit.
        if (outcome.reason === 'invalid_input') {
          skipped++;
          continue;
        }
        return errorFromReason(outcome.reason);
      }
      repo ??= toRepo(outcome.report);
      const entry = auditedPage(page, outcome.report);
      if (entry.counts.claims === 0) {
        withoutClaims++;
        continue;
      }
      totals.claims += entry.counts.claims;
      totals.verified += entry.counts.verified;
      totals.contradicted += entry.counts.contradicted;
      totals.unknown += entry.counts.unknown;
      audited.push(entry);
    }
  } catch {
    return buildError('internal_error');
  }

  return {
    schema: 'pil.agent.audit.v1',
    dataNotice: AGENT_DATA_NOTICE,
    space: { id: read.spaceId, source },
    repo,
    scope: {
      pagesRead: read.pages.length,
      pagesChecked: read.pages.length - skipped - notReached,
      pagesSkipped: skipped,
      pagesWithoutClaims: withoutClaims,
      pagesNotReached: notReached,
      maxPages: MAX_AUDIT_PAGES,
      morePagesInSpace: read.more,
    },
    totals,
    pages: rankAudited(audited),
  };
}

export function createAuditSpaceHandler(deps: AuditSpaceDeps) {
  return async (payload: AuditSpacePayload): Promise<AuditSpaceResult> => {
    const payloadObject = typeof payload === 'object' && payload !== null ? payload : {};
    const resolved = resolvePageId(payloadObject.page, payloadObject.context, { required: true });
    if (!resolved.ok) return buildError(resolved.error, resolved.detail);
    if (resolved.id === null || resolved.source === null) return buildError('invalid_input', 'page_missing');
    console.log(JSON.stringify({ evt: 'audit-space', pageId: resolved.id, source: resolved.source }));
    return auditSpace(deps, resolved.id, resolved.source);
  };
}

export const handler = createAuditSpaceHandler({ service: getCheckService, readSpace: readSpaceAsUser });
