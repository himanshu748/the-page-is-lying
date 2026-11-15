import type { ReasonCode, Report } from '../core/model';

/**
 * Service adapter between the Rovo actions and the check service (Task C, `src/service`).
 *
 * The handlers only know this interface. Integration replaces `getCheckService()` with a thin
 * wrapper around the real `checkDocument` / `checkClaim` (see docs/agent-eval.md, "Integration").
 * Until then the stub answers `index_missing`, which the handlers turn into a typed error and
 * never into a verdict.
 */
export type ServiceOutcome = { ok: true; report: Report } | { ok: false; reason: ReasonCode };

export interface CheckService {
  /** Check every claim in a Confluence page body (Atlassian Document Format, already parsed from JSON). */
  checkDocument(input: { adf: unknown; pageId: string }): Promise<ServiceOutcome>;
  /**
   * Check one claim written as free text, for example "POST /v1/charge".
   * Must answer `{ ok: false, reason: 'not_a_checkable_claim' }` when the text parses into no claim.
   * `pageId` selects a per-page repository override when present.
   */
  checkClaim(input: { claimText: string; pageId?: string }): Promise<ServiceOutcome>;
}

export const stubCheckService: CheckService = {
  checkDocument: () => Promise.resolve({ ok: false, reason: 'index_missing' }),
  checkClaim: () => Promise.resolve({ ok: false, reason: 'index_missing' }),
};

/** Integration point: return the real Task C service here. */
export function getCheckService(): CheckService {
  return stubCheckService;
}
