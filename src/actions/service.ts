import type { AgentError, Report } from '../core/model';
import { createAgentService } from '../service/agentService';
import { forgeCheckDeps } from '../service/forge';

/**
 * Service adapter between the Rovo actions and the check service (Task C, `src/service`).
 *
 * The handlers only know this interface. `getCheckService()` wraps the real pipeline. The stub
 * answers `index_missing`, which the handlers turn into a typed error and never into a verdict.
 */
export type ServiceOutcome = { ok: true; report: Report } | { ok: false; reason: AgentError['error'] };

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

let shared: CheckService | undefined;

/** The real service, shared with the macro and byline (see src/service/forge.ts). Built once per function instance. */
export function getCheckService(): CheckService {
  shared ??= createAgentService(forgeCheckDeps());
  return shared;
}
