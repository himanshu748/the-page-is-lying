import type { AgentError } from '../core/model';
import type { ActionEnvelope } from './envelope';
import { buildEnvelope, buildError, errorFromReason } from './envelope';
import type { ActionContext } from './input';
import { resolvePageId } from './input';
import type { PageReader } from './pageReader';
import { readPageAsUser } from './pageReader';
import type { CheckService } from './service';
import { getCheckService } from './service';

/**
 * Rovo action and MCP tool `check-page` (actionVerb GET, read-only).
 * Page id: Atlassian-provided context first, validated LLM input only as a fallback.
 */
export interface CheckPagePayload {
  page?: unknown;
  context?: ActionContext;
}

export interface CheckPageDeps {
  service: () => CheckService;
  readPage: PageReader;
}

export type CheckPageResult = ActionEnvelope | (AgentError & { detail?: string });

export function createCheckPageHandler(deps: CheckPageDeps) {
  return async (payload: CheckPagePayload): Promise<CheckPageResult> => {
    const payloadObject = typeof payload === 'object' && payload !== null ? payload : {};
    const resolved = resolvePageId(payloadObject.page, payloadObject.context, { required: true });
    if (!resolved.ok) return buildError(resolved.error, resolved.detail);
    if (resolved.id === null || resolved.source === null) return buildError('invalid_input', 'page_missing');

    const read = await deps.readPage(resolved.id);
    if (!read.ok) return buildError(read.error);

    try {
      const outcome = await deps.service().checkDocument({ adf: read.page.adf, pageId: read.page.id });
      if (!outcome.ok) return errorFromReason(outcome.reason);
      return buildEnvelope(outcome.report, {
        id: read.page.id,
        title: read.page.title,
        version: read.page.version,
        source: resolved.source,
      });
    } catch {
      return buildError('internal_error');
    }
  };
}

export const handler = createCheckPageHandler({ service: getCheckService, readPage: readPageAsUser });
