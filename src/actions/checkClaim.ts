import type { AgentError } from '../core/model';

/**
 * Rovo action and MCP tool `check-claim` (Task E owns this file). Read-only.
 * Task 0 stub: returns a typed placeholder that never claims a verdict.
 */
export interface CheckClaimPayload {
  claim: string;
  page?: string;
  context?: { confluence?: { contentId?: string } };
}

export const handler = async (_payload: CheckClaimPayload): Promise<AgentError> => ({
  schema: 'pil.agent.error.v1',
  error: 'index_missing',
  message: 'No repository index is available yet. This is a scaffold placeholder, not a check result.',
});
