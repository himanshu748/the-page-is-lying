import { useEffect, useMemo, useState } from 'react';
import type { Report } from '@core/model';
import type { CheckResponse } from '../../../../src/resolvers/contract';
import { ClaimActionsContext } from '../claims/actions';
import { EvidenceDetails } from '../claims/EvidenceCard';
import { invoke, router, view } from '../bridge';
import { AdfRenderer } from '../render/AdfRenderer';
import { asDoc, placeClaims } from '../render/adf';
import type { AdfNode } from '../render/adf';
import { STATUS_LABEL, StatusIcon } from '../status';
import { useJiraDraft } from '../useJiraDraft';
import { ReportHeader, StateNotice, useCheck, useContacts } from './common';

interface MacroContext {
  body: unknown;
  contentId: string | undefined;
  title: string | undefined;
  config: { repoUrl?: string; ref?: string };
}

function readContext(raw: unknown): MacroContext {
  const extension = ((raw as { extension?: Record<string, unknown> }).extension ?? {}) as {
    macro?: { body?: unknown; config?: Record<string, unknown> };
    content?: { id?: unknown; title?: unknown };
  };
  const config = extension.macro?.config ?? {};
  return {
    body: extension.macro?.body,
    contentId: extension.content?.id === undefined ? undefined : String(extension.content.id),
    title: typeof extension.content?.title === 'string' ? extension.content.title : undefined,
    config: {
      ...(typeof config['repoUrl'] === 'string' && config['repoUrl'] !== '' ? { repoUrl: config['repoUrl'] } : {}),
      ...(typeof config['ref'] === 'string' && config['ref'] !== '' ? { ref: config['ref'] } : {}),
    },
  };
}

export function MacroView() {
  const [context, setContext] = useState<MacroContext | null>(null);
  const [contextError, setContextError] = useState(false);

  useEffect(() => {
    view
      .getContext()
      .then((raw) => setContext(readContext(raw)))
      .catch(() => setContextError(true));
  }, []);

  const load = useMemo(
    () =>
      context === null
        ? null
        : () =>
            invoke<CheckResponse>('checkBody', {
              adf: context.body,
              ...(context.contentId ? { contentId: context.contentId } : {}),
              config: context.config,
            }),
    [context],
  );
  const loaded = useCheck(load);

  if (contextError) return <p className="notice notice-error" role="alert">The macro context could not be read.</p>;
  const doc = asDoc(context?.body);

  return (
    <section aria-label="Runbook check" data-testid="view-runbook-check" className="view">
      {loaded.phase === 'loading' ? (
        <p className="notice" role="status">
          Checking against code…
        </p>
      ) : (
        <MacroResult response={loaded.response} pollingStopped={loaded.pollingStopped} doc={doc} title={context?.title} contentId={context?.contentId} />
      )}
      {loaded.phase === 'loading' && doc && <AdfRenderer doc={doc} placements={{ byBlock: new Map(), unplaced: [] }} />}
    </section>
  );
}

function MacroResult({ response, pollingStopped, doc, title, contentId }: { response: CheckResponse; pollingStopped: boolean; doc: AdfNode | null; title: string | undefined; contentId: string | undefined }) {
  const report: Report | undefined = 'report' in response ? response.report : undefined;
  const pageTitle = response.state === 'ready' && response.page ? response.page.title : (title ?? 'this page');
  const { draftJira, modal } = useJiraDraft(report, pageTitle);
  const contacts = useContacts(contentId, report);
  const placements = useMemo(() => (doc && report ? placeClaims(doc, report.results) : { byBlock: new Map(), unplaced: [] }), [doc, report]);
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

  const empty = doc === null ? <p className="notice">This macro has no body to check. Put the runbook text inside it.</p> : null;

  return (
    <>
      {report && <ReportHeader report={report} />}
      <StateNotice response={response} pollingStopped={pollingStopped} />
      {report && report.counts.claims === 0 && (
        <p className="notice" role="status">
          No claims found in this section. The check looks for endpoints, environment variables, commands, config keys, file paths and package versions.
        </p>
      )}
      {empty}
      {actions ? (
        <ClaimActionsContext.Provider value={actions}>
          {doc && <AdfRenderer doc={doc} placements={placements} />}
          {placements.unplaced.length > 0 && (
            <section aria-label="Claims not shown in the text" className="unplaced">
              <h2>Claims not shown in the text</h2>
              <ul>
                {placements.unplaced.map((result) => (
                  <li key={result.claim.id}>
                    <strong>
                      <StatusIcon verdict={result.verdict} /> {STATUS_LABEL[result.verdict]}
                    </strong>{' '}
                    <code>{result.claim.raw}</code>
                    <EvidenceDetails result={result} showHeading={false} />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {modal}
        </ClaimActionsContext.Provider>
      ) : (
        doc && <AdfRenderer doc={doc} placements={placements} />
      )}
    </>
  );
}
