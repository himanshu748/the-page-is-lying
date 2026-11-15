import type { ClaimType, Coverage, IndexKind, Verdict } from '@core/model';
import { VERDICT_LABELS } from '@core/wording';

/** Short label shown next to every claim and count. Never colour alone. */
export const STATUS_LABEL: Record<Verdict, string> = VERDICT_LABELS;

/** Longer phrase used as the evidence card heading. */
export const STATUS_PHRASE: Record<Verdict, string> = {
  verified: 'Verified in code',
  contradicted: 'Contradicted by code',
  unknown: 'No evidence found',
};

export const KIND_FOR_CLAIM: Record<ClaimType, IndexKind> = {
  http_endpoint: 'routes',
  env_var: 'env',
  cli: 'cli',
  config_key: 'config',
  file_path: 'files',
  package_version: 'packages',
};

export const KIND_LABEL: Record<IndexKind, string> = {
  routes: 'HTTP routes',
  env: 'environment variables',
  cli: 'CLI commands',
  config: 'config keys',
  files: 'file paths',
  packages: 'package versions',
};

export const COVERAGE_LABEL: Record<Coverage, string> = {
  complete: 'complete',
  partial: 'partial',
  none: 'none',
};

/** Decorative icons: the text label always carries the meaning. */
export function StatusIcon({ verdict }: { verdict: Verdict }) {
  const common = { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true, focusable: false, className: `icon icon-${verdict}` } as const;
  if (verdict === 'verified') {
    return (
      <svg {...common}>
        <path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (verdict === 'contradicted') {
    return (
      <svg {...common}>
        <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M5.7 6.2a2.4 2.4 0 1 1 3.6 2c-.9.5-1.3 1-1.3 1.9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="8" cy="13" r="1.1" fill="currentColor" />
    </svg>
  );
}

export function formatIndexTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 40);
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/** Only permalinks on github.com are opened from the UI. */
export function isSafePermalink(url: string | undefined): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'github.com';
  } catch {
    return false;
  }
}
