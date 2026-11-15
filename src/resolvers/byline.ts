/**
 * Byline dynamicProperties (PLAN.md section 5.3). Reads cached counts only: no heavy work, never throws.
 */
import type { ReportCounts } from '../core/model';
import { getBackend } from './backend';
import type { BylineProperties } from './contract';

export type { BylineProperties };

const BASE_TITLE = 'Runbook check';
const BASE_TOOLTIP = "Check this page's claims against code";

export function titleFor(counts: ReportCounts | null): string {
  if (!counts || counts.claims === 0) return BASE_TITLE;
  if (counts.contradicted > 0) return `${BASE_TITLE}: ${counts.contradicted} contradicted`;
  if (counts.unknown > 0) return `${BASE_TITLE}: ${counts.unknown} no evidence`;
  return `${BASE_TITLE}: ${counts.verified} verified`;
}

interface DynamicPropsInput {
  extension?: { content?: { id?: unknown; version?: { number?: unknown } | unknown }; version?: unknown };
  content?: { id?: unknown };
}

function versionOf(input: DynamicPropsInput): number | undefined {
  const v = input.extension?.content?.version;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && v !== null && 'number' in v && typeof v.number === 'number') return v.number;
  return undefined;
}

export const dynamicProperties = async (input?: unknown): Promise<BylineProperties> => {
  const plain: BylineProperties = { title: BASE_TITLE, tooltip: BASE_TOOLTIP };
  try {
    const typed = (input ?? {}) as DynamicPropsInput;
    const id = typed.extension?.content?.id ?? typed.content?.id;
    if (typeof id !== 'string' && typeof id !== 'number') return plain;
    const contentId = String(id);
    if (!/^[0-9]{1,20}$/.test(contentId)) return plain;
    const backend = await getBackend();
    const version = versionOf(typed);
    const counts = await backend.getCounts(contentId, version);
    return { title: titleFor(counts), tooltip: BASE_TOOLTIP };
  } catch {
    return plain;
  }
};
