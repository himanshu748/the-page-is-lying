import { useCallback, useEffect, useRef, useState } from 'react';
import { shortSha, suggestionStatement } from '@core/wording';
import type { AuditEnvelope, AuditedPage, DriftResponse } from '../../../../src/resolvers/contract';
import { invoke, router } from '../bridge';
import { StatusIcon, formatIndexTime, isSafePermalink } from '../status';

type Loaded = { phase: 'loading' } | { phase: 'done'; response: DriftResponse };

const STATE_TEXT: Record<Exclude<DriftResponse['state'], 'ready' | 'error'>, string> = {
  indexing: 'The repository index is still being built. Run the audit again in a minute.',
  no_repo: 'No repository is connected yet. A Confluence administrator can connect one in the app settings.',
  repo_not_found: 'The repository was not found, or it is private and no token is saved.',
  rate_limited: 'The code host is limiting requests right now. Run the audit again in a few minutes.',
};

/** Space page: ranks the most recently edited pages of this space by contradicted claims. */
export function DriftView() {
  const [loaded, setLoaded] = useState<Loaded>({ phase: 'loading' });

  const run = useCallback(() => {
    setLoaded({ phase: 'loading' });
    invoke<DriftResponse>('auditSpace')
      .then((response) => setLoaded({ phase: 'done', response }))
      .catch(() => setLoaded({ phase: 'done', response: { state: 'error', message: 'The space audit failed. Try again in a minute.' } }));
  }, []);

  // The audit reads up to 25 pages, so it must start once even when React runs effects twice in development.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    run();
  }, [run]);

  return (
    <main className="view drift" data-testid="view-runbook-drift">
      <div className="drift-head">
        <h1>Doc drift in this space</h1>
        <button type="button" className="btn" onClick={run} disabled={loaded.phase === 'loading'}>
          Run again
        </button>
      </div>
      {loaded.phase === 'loading' && (
        <p className="notice" role="status">
          Checking the pages of this space against code…
        </p>
      )}
      {loaded.phase === 'done' && loaded.response.state === 'ready' && <DriftResult audit={loaded.response.audit} />}
      {loaded.phase === 'done' && loaded.response.state !== 'ready' && (
        <p className={loaded.response.state === 'error' ? 'notice notice-error' : 'notice notice-warn'} role="alert">
          {loaded.response.state === 'error' ? loaded.response.message : STATE_TEXT[loaded.response.state]}
        </p>
      )}
    </main>
  );
}

function DriftResult({ audit }: { audit: AuditEnvelope }) {
  const { scope, totals } = audit;
  const drifted = audit.pages.filter((page) => page.counts.contradicted > 0);
  return (
    <>
      <ul className="drift-stats" aria-label="Space totals">
        <li>
          <strong>{drifted.length}</strong> of {audit.pages.length} pages with claims have a contradiction
        </li>
        <li className="count count-contradicted">
          <StatusIcon verdict="contradicted" /> <strong>{totals.contradicted}</strong> Contradicted
        </li>
        <li className="count count-verified">
          <StatusIcon verdict="verified" /> <strong>{totals.verified}</strong> Verified
        </li>
        <li className="count count-unknown">
          <StatusIcon verdict="unknown" /> <strong>{totals.unknown}</strong> No evidence
        </li>
      </ul>
      <p className="muted" data-testid="drift-scope">
        Checked the {scope.pagesChecked} most recently edited pages
        {scope.morePagesInSpace ? ` (the space has more than ${scope.maxPages})` : ''}
        {scope.pagesWithoutClaims > 0 ? `, ${scope.pagesWithoutClaims} without checkable claims` : ''}
        {scope.pagesSkipped > 0 ? `, ${scope.pagesSkipped} skipped because the body could not be read` : ''}
        {scope.pagesNotReached > 0 ? `, ${scope.pagesNotReached} not reached in the time allowed` : ''}
        {audit.repo ? `. Code: ${audit.repo.fullName}@${shortSha(audit.repo.sha)}, indexed ${formatIndexTime(audit.repo.indexedAt)}${audit.repo.stale ? ', index may be stale' : ''}` : ''}.
      </p>
      {audit.pages.length === 0 ? (
        <p className="notice" role="status">
          No checkable claims were found in the pages of this space. The check looks for endpoints, environment variables, commands, config keys, file paths and package versions.
        </p>
      ) : (
        <ol className="drift-list">
          {audit.pages.map((page) => (
            <DriftPage key={page.id} page={page} />
          ))}
        </ol>
      )}
    </>
  );
}

function DriftPage({ page }: { page: AuditedPage }) {
  const { counts } = page;
  const open = () => void router.navigate(`/wiki/pages/viewpage.action?pageId=${page.id}`);
  return (
    <li className={counts.contradicted > 0 ? 'drift-page drift-page-bad' : 'drift-page'} data-testid="drift-page">
      <div className="drift-page-head">
        <button type="button" className="ev-link drift-title" onClick={open}>
          {page.untrustedTitle === '' ? `Page ${page.id}` : page.untrustedTitle}
        </button>
        <span className="drift-counts">
          <strong>{counts.contradicted}</strong> contradicted of {counts.claims} claims
          {counts.contradicted > 0 ? ` (${Math.round(page.driftRatio * 100)}%)` : ''}
          {page.claimsTruncated ? `. Only the first ${counts.claims} claims were checked: the page has more than the limit` : ''}
        </span>
      </div>
      <div
        className="drift-bar"
        role="img"
        aria-label={`${counts.contradicted} contradicted, ${counts.verified} verified, ${counts.unknown} with no evidence`}
      >
        <span className="drift-bar-contradicted" style={{ flexGrow: counts.contradicted }} />
        <span className="drift-bar-verified" style={{ flexGrow: counts.verified }} />
        <span className="drift-bar-unknown" style={{ flexGrow: counts.unknown }} />
      </div>
      {page.topContradictions.length > 0 && (
        <ul className="drift-claims">
          {page.topContradictions.map((fix) => {
            const first = fix.evidence[0];
            return (
              <li key={fix.claimId}>
                <code className="claim-chip claim-contradicted">{fix.untrustedClaimText}</code>
                <span className="ev-statement">{fix.statement}</span>
                {first !== undefined && first.file !== undefined && first.line !== undefined && (
                  <span className="drift-cite">
                    {isSafePermalink(first.permalink) ? (
                      <button type="button" className="ev-link" onClick={() => void router.open(first.permalink as string)}>
                        {first.file}:{first.line}
                        <span className="sr-only"> (opens on GitHub)</span>
                      </button>
                    ) : (
                      <span className="ev-loc">
                        {first.file}:{first.line}
                      </span>
                    )}{' '}
                    <span className="ev-id">{first.id}</span>
                  </span>
                )}
                {fix.suggestion.kind !== 'none' && (
                  <span className="ev-fix">
                    {suggestionStatement({
                      claim: fix.untrustedClaimText,
                      kind: fix.suggestion.kind,
                      ...(fix.suggestion.untrustedReplacement !== undefined ? { replacement: fix.suggestion.untrustedReplacement } : {}),
                    })}
                  </span>
                )}
              </li>
            );
          })}
          {counts.contradicted > page.topContradictions.length && (
            <li className="muted">
              {counts.contradicted - page.topContradictions.length} more on the page. Open it and choose Runbook check for the full list.
            </li>
          )}
        </ul>
      )}
    </li>
  );
}
