import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Report } from '@core/model';
import { shortSha } from '@core/wording';
import type { CheckResponse, PageContact, PageContactsResponse } from '../../../../src/resolvers/contract';
import { invoke, rovo } from '../bridge';
import { STATUS_LABEL, StatusIcon } from '../status';

/** "Who to ask" for a page. Loaded only when the report has a contradicted claim. Failures leave it empty. */
export function useContacts(contentId: string | null | undefined, report: Report | undefined): PageContact[] {
  const [contacts, setContacts] = useState<PageContact[]>([]);
  const needed = typeof contentId === 'string' && contentId !== '' && (report?.counts.contradicted ?? 0) > 0;
  useEffect(() => {
    if (!needed) return;
    let cancelled = false;
    invoke<PageContactsResponse>('getPageContacts', { contentId })
      .then((response) => {
        if (!cancelled && Array.isArray(response?.contacts)) setContacts(response.contacts);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [needed, contentId]);
  return contacts;
}

export const POLL_MS = 3000;
export const POLL_MAX_MS = 60_000;

export type Loaded = { phase: 'loading' } | { phase: 'done'; response: CheckResponse; pollingStopped: boolean };

/** Runs `load`, and while the answer is "indexing" polls every 3 s for up to 60 s. */
export function useCheck(load: (() => Promise<CheckResponse>) | null): Loaded {
  const [loaded, setLoaded] = useState<Loaded>({ phase: 'loading' });
  const loadRef = useRef(load);
  loadRef.current = load;
  const ready = load !== null;

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    const run = async (): Promise<void> => {
      let response: CheckResponse;
      try {
        response = await (loadRef.current as () => Promise<CheckResponse>)();
      } catch {
        response = { state: 'error', message: 'The check could not be reached. Reload the page to try again.' };
      }
      if (cancelled) return;
      const waiting = response.state === 'indexing';
      const expired = Date.now() - started >= POLL_MAX_MS;
      setLoaded({ phase: 'done', response, pollingStopped: waiting && expired });
      if (waiting && !expired) timer = setTimeout(() => void run(), POLL_MS);
    };
    void run();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [ready]);

  return loaded;
}

export function useRovo(): { enabled: boolean; ask: () => void } {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let active = true;
    void rovo
      .isEnabled()
      .then((value) => {
        if (active) setEnabled(value === true);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  const ask = useCallback(() => {
    void rovo
      .open({ type: 'forge', agentKey: 'runbook-checker', agentName: 'Runbook checker', prompt: 'Is this page still true?' })
      .catch(() => undefined);
  }, []);
  return { enabled, ask };
}

export function ReportHeader({ report }: { report: Report }) {
  const { enabled, ask } = useRovo();
  const { counts } = report;
  return (
    <header className="bar">
      <ul className="counts" aria-label="Claims by status">
        {(['verified', 'contradicted', 'unknown'] as const).map((verdict) => (
          <li key={verdict} className={`count count-${verdict}`}>
            <StatusIcon verdict={verdict} /> <strong>{counts[verdict]}</strong> {STATUS_LABEL[verdict]}
          </li>
        ))}
      </ul>
      <span className="repo">
        {report.repo.fullName}@{shortSha(report.repo.sha)}
      </span>
      {report.limits.claimsTruncated && (
        <span className="warn" role="status">
          Some content or claims were skipped because the check reached its limits.
        </span>
      )}
      {report.stale && (
        <span className="warn" role="status">
          Index may be stale: the repository has changed since it was indexed.
        </span>
      )}
      {enabled && (
        <button type="button" className="btn" onClick={ask}>
          Ask Runbook checker
        </button>
      )}
    </header>
  );
}

/** Notice for every non-ready state. Returns null for `ready`. */
export function StateNotice({ response, pollingStopped }: { response: CheckResponse; pollingStopped: boolean }): ReactNode {
  switch (response.state) {
    case 'ready':
      return null;
    case 'indexing':
      return (
        <p className="notice" role="status">
          {pollingStopped
            ? 'The repository is still being indexed. Reload the page in a minute.'
            : 'Indexing the repository. Checking against code starts when it finishes.'}
        </p>
      );
    case 'rate_limited':
      return (
        <p className="notice notice-warn" role="status">
          GitHub rate limit reached
          {response.retryAfterSeconds !== undefined ? `. Try again in about ${Math.ceil(response.retryAfterSeconds / 60)} minutes` : ''}.
          {response.report ? ' Showing the last index.' : ' No result is shown, and no claim counts as verified.'}
        </p>
      );
    case 'repo_not_found':
      return (
        <p className="notice notice-warn" role="alert">
          Repository not found, or it is private. Check the repository URL in the app settings.
        </p>
      );
    case 'no_repo':
      return (
        <p className="notice notice-warn" role="status">
          No repository is configured. A Confluence administrator can set one in the app settings.
        </p>
      );
    case 'error':
      return (
        <p className="notice notice-error" role="alert">
          {response.message}
        </p>
      );
  }
}
