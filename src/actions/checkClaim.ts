import type { AgentError } from '../core/model';
import type { ActionEnvelope } from './envelope';
import { buildEnvelope, buildError, errorFromReason } from './envelope';
import type { ActionContext } from './input';
import { resolvePageId, validateClaim } from './input';
import type { CheckService } from './service';
import { getCheckService } from './service';

/**
 * Rovo action and MCP tool `check-claim` (actionVerb GET, read-only).
 * The page is optional and only selects a per-page repository; the page body is not read.
 */
export interface CheckClaimPayload {
  claim?: unknown;
  page?: unknown;
  context?: ActionContext;
}

export interface CheckClaimDeps {
  service: () => CheckService;
}

export type CheckClaimResult = ActionEnvelope | (AgentError & { detail?: string });

export function createCheckClaimHandler(deps: CheckClaimDeps) {
  return async (payload: CheckClaimPayload): Promise<CheckClaimResult> => {
    const payloadObject = typeof payload === 'object' && payload !== null ? payload : {};
    const claim = validateClaim(payloadObject.claim);
    if (!claim.ok) return buildError(claim.error, claim.detail);

    const page = resolvePageId(payloadObject.page, payloadObject.context, { required: false });
    if (!page.ok) return buildError(page.error, page.detail);

    try {
      const outcome = await deps
        .service()
        .checkClaim(page.id === null ? { claimText: claim.claim } : { claimText: claim.claim, pageId: page.id });
      if (!outcome.ok) return errorFromReason(outcome.reason);
      return buildEnvelope(outcome.report);
    } catch {
      return buildError('internal_error');
    }
  };
}

export const handler = createCheckClaimHandler({ service: getCheckService });
