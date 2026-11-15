/**
 * YAML and JSON config key index with line numbers. Only object keys are indexed;
 * arrays are recorded as a key but not descended into.
 */
import { snippetOf, splitLines } from './text';
import type { TreeNode } from './structured';
import type { IndexAcc } from './types';

export const MAX_CONFIG_KEYS_PER_FILE = 2000;
export const MAX_CONFIG_KEYS_TOTAL = 20000;
const MAX_DEPTH = 8;

export function indexConfigTree(acc: IndexAcc, file: string, text: string, docs: TreeNode[]): void {
  const lines = splitLines(text);
  let count = 0;
  let truncated = false;
  const walk = (node: TreeNode, prefix: string, depth: number): void => {
    if (node.kind !== 'map') return;
    for (const e of node.entries) {
      if (count >= MAX_CONFIG_KEYS_PER_FILE || acc.config.length >= MAX_CONFIG_KEYS_TOTAL) {
        truncated = true;
        return;
      }
      const keyPath = prefix === '' ? e.key : `${prefix}.${e.key}`;
      acc.config.push({ file, line: e.line, snippet: snippetOf(lines, e.line), keyPath });
      count++;
      if (depth + 1 < MAX_DEPTH) walk(e.value, keyPath, depth + 1);
      else if (e.value.kind === 'map') truncated = true;
    }
  };
  for (const d of docs) walk(d, '', 0);
  acc.configFiles.push(file);
  if (truncated) acc.partial.config = true;
}

const SKIP_CONFIG_BASENAMES = /^(?:package(?:-lock)?\.json|npm-shrinkwrap\.json|composer\.lock|tsconfig[\w.-]*\.json|jsconfig\.json|renovate\.json|\.?prettierrc(?:\.json)?|\.eslintrc(?:\.json)?|yarn\.lock|pnpm-lock\.yaml|pnpm-workspace\.yaml)$/;

/** Whether a YAML/JSON file counts as application config (not tooling, CI, lockfiles or locale bundles). */
export function isConfigCandidate(path: string): boolean {
  const base = path.slice(path.lastIndexOf('/') + 1);
  if (SKIP_CONFIG_BASENAMES.test(base)) return false;
  if (/(^|\/)(?:\.github|\.circleci|\.gitlab|node_modules|locales?|i18n|__snapshots__|\.vscode|\.idea)\//.test(path)) return false;
  if (/\.(?:min|lock)\./.test(base)) return false;
  return true;
}
