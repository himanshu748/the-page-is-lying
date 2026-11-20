/** Module key of the Runbook check macro in manifest.yml. */
export const RUNBOOK_MACRO_KEY = 'runbook-check';

const MAX_DEPTH = 40;
const MAX_NODES = 20_000;

/**
 * True when the document contains the Runbook check macro. Confluence stores a Forge macro as an
 * `extension` or `bodiedExtension` node whose `extensionKey` is `<app id>/<environment id>/static/<module key>`.
 */
export function hasRunbookMacro(adf: unknown): boolean {
  let budget = MAX_NODES;
  const visit = (node: unknown, depth: number): boolean => {
    if (typeof node !== 'object' || node === null || depth > MAX_DEPTH || budget-- <= 0) return false;
    const { type, attrs, content } = node as { type?: unknown; attrs?: { extensionKey?: unknown }; content?: unknown };
    if (type === 'extension' || type === 'bodiedExtension') {
      const key = attrs?.extensionKey;
      if (typeof key === 'string' && (key === RUNBOOK_MACRO_KEY || key.endsWith(`/${RUNBOOK_MACRO_KEY}`))) return true;
    }
    return Array.isArray(content) && content.some((child) => visit(child, depth + 1));
  };
  return visit(adf, 0);
}
