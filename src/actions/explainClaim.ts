import type { AgentError, ReportCounts } from '../core/model';
import { AGENT_DATA_NOTICE } from '../core/wording';
import type { AgentExplanation } from './advice';
import { toAgentExplanation } from './advice';
import type { ActionEnvelope } from './envelope';
import { LIMITS, buildError, errorFromReason, toCounts, toRepo } from './envelope';
import type { ActionContext } from './input';
import { resolvePageId, validateClaim } from './input';
import type { CheckService } from './service';
import { getCheckService } from './service';

/**
 * Rovo action and MCP tool `explain-claim` (actionVerb GET, read-only).
 * Runs the same deterministic check as `check-claim` and adds how the verdict was reached: what the text
 * was read as, which rule decided, which part of the index was searched and how complete it is.
 */
export interface ExplainClaimPayload {
  claim?: unknown;
  page?: unknown;
  context?: ActionContext;
}

export interface ExplainEnvelope {
  schema: 'pil.agent.explain.v1';
  dataNotice: string;
  repo: ActionEnvelope['repo'];
  counts: ReportCounts;
  explanations: AgentExplanation[];
}

export type ExplainClaimResult = ExplainEnvelope | (AgentError & { detail?: string });

export function createExplainClaimHandler(deps: { service: () => CheckService }) {
  return async (payload: ExplainClaimPayload): Promise<ExplainClaimResult> => {
    const payloadObject = typeof payload === 'object' && payload !== null ? payload : {};
    const claim = validateClaim(payloadObject.claim);
    if (!claim.ok) return buildError(claim.error, claim.detail);
    const page = resolvePageId(payloadObject.page, payloadObject.context, { required: false });
    if (!page.ok) return buildError(page.error, page.detail);

    try {
      const outcome = await deps.service().checkClaim(page.id === null ? { claimText: claim.claim } : { claimText: claim.claim, pageId: page.id });
      if (!outcome.ok) return errorFromReason(outcome.reason);
      const report = outcome.report;
      return {
        schema: 'pil.agent.explain.v1',
        dataNotice: AGENT_DATA_NOTICE,
        repo: toRepo(report),
        counts: toCounts(report.counts),
        explanations: report.results.slice(0, LIMITS.results).map((result) => toAgentExplanation(result, report)),
      };
    } catch {
      return buildError('internal_error');
    }
  };
}

export const handler = createExplainClaimHandler({ service: getCheckService });
