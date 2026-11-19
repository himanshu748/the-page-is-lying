/**
 * Adapter for the Rovo actions and MCP tools: `CheckService` (Task E) over the check pipeline (Task C).
 * Failures become a reason code and never a verdict. States that are not matcher reasons (`indexing`,
 * `no_repo`) are reported as `index_missing`: "no repository index is available yet".
 */
import type { CheckService, ServiceOutcome } from '../actions/service';
import { checkClaim, checkDocument, type CheckDeps, type CheckOutcome } from './check';

function toServiceOutcome(outcome: CheckOutcome): ServiceOutcome {
  if (outcome.ok) return { ok: true, report: outcome.report };
  if (outcome.error === 'indexing' || outcome.error === 'no_repo') return { ok: false, reason: 'index_missing' };
  return { ok: false, reason: outcome.error };
}

export function createAgentService(deps: CheckDeps): CheckService {
  return {
    // `pageId` only selects a per-page repository override, which this app does not have: the repository is the saved one.
    checkDocument: async ({ adf, pageId }) => toServiceOutcome(await checkDocument(deps, { adf, contentId: pageId })),
    checkClaim: async ({ claimText }) => toServiceOutcome(await checkClaim(deps, { text: claimText })),
  };
}
