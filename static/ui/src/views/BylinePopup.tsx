import { useEffect, useMemo, useState } from 'react';
import type { ClaimResult, Verdict } from '@core/model';
import type { CheckResponse } from '../../../../src/resolvers/contract';
import { ClaimActionsContext } from '../claims/actions';
import { EvidenceDetails } from '../claims/EvidenceCard';
import { invoke, router, view } from '../bridge';
import { STATUS_LABEL, STATUS_PHRASE, StatusIcon } from '../status';
import { useJiraDraft } from '../useJiraDraft';
import { ReportHeader, StateNotice, useCheck, useContacts } from './common';

const ORDER: Verdict[] = ['contradicted', 'unknown', 'verified'];

export function BylinePopup() {
  const [contentId, setContentId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    view
      .getContext()
      .then((raw) => {
        const id = (raw as { extension?: { content?: { id?: unknown } } }).extension?.content?.id;
        if (id === undefined) setFailed(true);
        else setContentId(String(id));
      })
      .catch(() => setFailed(true));
  }, []);

  const load = useMemo(() => (contentId === null ? null : () => invoke<CheckResponse>('checkPage', { contentId })), [contentId]);
  const loaded = useCheck(load);

  return (
    <section aria-label="Runbook check for this page" data-testid="view-runbook-byline" className="view">
      {failed && (
        <p className="notice notice-error" role="alert">
          The page could not be identified.
        </p>
      )}
      {!failed && loaded.phase === 'loading' && (
        <p className="notice" role="status">
          Checking this page against code…
        </p>
      )}
      {loaded.phase === 'done' && <BylineResult response={loaded.response} pollingStopped={loaded.pollingStopped} contentId={contentId} />}
    </section>
  );
}

function BylineResult({ response, pollingStopped, contentId }: { response: CheckResponse; pollingStopped: boolean; contentId: string | null }) {
  const report = 'report' in response ? response.report : undefined;
  const pageTitle = response.state === 'ready' && response.page ? response.page.title : 'this page';
  const { draftJira, modal } = useJiraDraft(report, pageTitle);
  const contacts = useContacts(contentId, report);
  const actions = useMemo(
    () =>
      report
        ? {
            report,
            openLink: (url: string) => {
              void router.open(url);
            },
            draftJira,
            contacts,
          }
        : null,
    [report, draftJira, contacts],
  );

  const groups = useMemo(() => {
    const map: Record<Verdict, ClaimResult[]> = { contradicted: [], unknown: [], verified: [] };
    for (const result of report?.results ?? []) map[result.verdict].push(result);
    return map;
  }, [report]);

  return (
    <>
      {report && <ReportHeader report={report} />}
      <StateNotice response={response} pollingStopped={pollingStopped} />
      {report && report.counts.claims === 0 && (
        <p className="notice" role="status">
          No claims found on this page.
        </p>
      )}
      {actions && (
        <ClaimActionsContext.Provider value={actions}>
          {ORDER.filter((verdict) => groups[verdict].length > 0).map((verdict) => (
            <section key={verdict} className="group" aria-labelledby={`group-${verdict}`}>
              <h2 id={`group-${verdict}`} className={`ev-${verdict}`}>
                <StatusIcon verdict={verdict} /> {STATUS_PHRASE[verdict]} ({groups[verdict].length})
              </h2>
              <ul className="claim-list">
                {groups[verdict].map((result) => (
                  <li key={result.claim.id} className="claim-item" data-testid="byline-claim">
                    <span className="claim-item-head">
                      <code className={`claim-chip claim-${verdict}`}>{result.claim.raw}</code>
                      <span className="claim-label">{STATUS_LABEL[verdict]}</span>
                    </span>
                    <EvidenceDetails result={result} showHeading={false} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {modal}
        </ClaimActionsContext.Provider>
      )}
    </>
  );
}
