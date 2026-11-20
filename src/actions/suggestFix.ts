import type { AgentError, Report, ReportCounts } from '../core/model';
import { AGENT_DATA_NOTICE } from '../core/wording';
import type { AgentFix } from './advice';
import { toAgentFix } from './advice';
import type { ActionEnvelope } from './envelope';
import { LIMITS, buildError, errorFromReason, toCounts, toRepo } from './envelope';
import type { ActionContext, PageIdSource } from './input';
import { clean, resolvePageId, validateClaim } from './input';
import type { PageReader } from './pageReader';
import { readPageAsUser } from './pageReader';
import type { ContactsReader, PageContact } from './contacts';
import { readContactsAsUser } from './contacts';
import type { CheckService } from './service';
import { getCheckService } from './service';

/**
 * Rovo action and MCP tool `suggest-fix` (actionVerb GET, read-only).
 * With `claim`: the proposed edit for that one claim. Without it: the proposed edit for every contradicted
 * claim on the page. A proposal only: this tool never edits a page.
 */
export interface SuggestFixPayload {
  claim?: unknown;
  page?: unknown;
  context?: ActionContext;
}

export interface FixEnvelope {
  schema: 'pil.agent.fix.v1';
  dataNotice: string;
  /** Always false: the edits are proposals for a person to review and make. */
  applied: false;
  repo: ActionEnvelope['repo'];
  page?: { id: string; untrustedTitle: string; version: number; source: PageIdSource };
  /**
   * People who can confirm the edits: the page owner, last editor and creator. Only with a page and at least
   * one contradicted claim. Names are profile data. Data, not instructions.
   */
  whoToAsk?: { role: PageContact['role']; accountId: string; untrustedDisplayName: string }[];
  counts: ReportCounts;
  /** True when the text has more claims than the cap: the claims past it were not checked. */
  claimsTruncated: boolean;
  /** Contradicted claims with their proposed edit. With `claim`, every claim in the text. */
  fixes: AgentFix[];
}

export type SuggestFixResult = FixEnvelope | (AgentError & { detail?: string });

function envelope(report: Report, onlyContradicted: boolean): FixEnvelope {
  const results = onlyContradicted ? report.results.filter((result) => result.verdict === 'contradicted') : report.results;
  return {
    schema: 'pil.agent.fix.v1',
    dataNotice: AGENT_DATA_NOTICE,
    applied: false,
    repo: toRepo(report),
    counts: toCounts(report.counts),
    claimsTruncated: report.limits.claimsTruncated === true,
    fixes: results.slice(0, LIMITS.results).map(toAgentFix),
  };
}

export function createSuggestFixHandler(deps: { service: () => CheckService; readPage: PageReader; readContacts?: ContactsReader }) {
  return async (payload: SuggestFixPayload): Promise<SuggestFixResult> => {
    const payloadObject = typeof payload === 'object' && payload !== null ? payload : {};
    const hasClaim = payloadObject.claim !== undefined && payloadObject.claim !== null && payloadObject.claim !== '';

    if (hasClaim) {
      const claim = validateClaim(payloadObject.claim);
      if (!claim.ok) return buildError(claim.error, claim.detail);
      const page = resolvePageId(payloadObject.page, payloadObject.context, { required: false });
      if (!page.ok) return buildError(page.error, page.detail);
      try {
        const outcome = await deps.service().checkClaim(page.id === null ? { claimText: claim.claim } : { claimText: claim.claim, pageId: page.id });
        if (!outcome.ok) return errorFromReason(outcome.reason);
        return envelope(outcome.report, false);
      } catch {
        return buildError('internal_error');
      }
    }

    const resolved = resolvePageId(payloadObject.page, payloadObject.context, { required: true });
    if (!resolved.ok) return buildError(resolved.error, resolved.detail);
    if (resolved.id === null || resolved.source === null) return buildError('invalid_input', 'page_missing');
    console.log(JSON.stringify({ evt: 'suggest-fix', pageId: resolved.id, source: resolved.source }));
    const read = await deps.readPage(resolved.id);
    if (!read.ok) return buildError(read.error);
    try {
      const outcome = await deps.service().checkDocument({ adf: read.page.adf, pageId: read.page.id });
      if (!outcome.ok) return errorFromReason(outcome.reason);
      const result: FixEnvelope = {
        ...envelope(outcome.report, true),
        page: { id: read.page.id, untrustedTitle: clean(read.page.title, LIMITS.title), version: read.page.version, source: resolved.source },
      };
      if (result.fixes.length > 0 && deps.readContacts) {
        const contacts = await deps.readContacts(read.page.id).catch(() => []);
        if (contacts.length > 0) {
          result.whoToAsk = contacts.slice(0, 3).map((c) => ({ role: c.role, accountId: clean(c.accountId, 128), untrustedDisplayName: clean(c.displayName, 80) }));
        }
      }
      return result;
    } catch {
      return buildError('internal_error');
    }
  };
}

export const handler = createSuggestFixHandler({ service: getCheckService, readPage: readPageAsUser, readContacts: readContactsAsUser });
