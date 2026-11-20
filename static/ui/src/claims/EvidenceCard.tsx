import { useRef } from 'react';
import type { ClaimResult } from '@core/model';
import type { PageContact } from '../../../../src/resolvers/contract';
import { shortSha, suggestionStatement } from '@core/wording';
import { COVERAGE_LABEL, KIND_FOR_CLAIM, KIND_LABEL, STATUS_PHRASE, StatusIcon, formatIndexTime, isSafePermalink } from '../status';
import { useClaimActions } from './actions';

const ROLE_LABEL: Record<PageContact['role'], string> = { owner: 'page owner', last_editor: 'last editor', creator: 'page creator' };

/**
 * Evidence for one claim. All repo and page text is rendered as React text. Spans are used for layout
 * so the same markup is valid inside a paragraph (hover card) and in the byline list.
 */
export function EvidenceDetails({ result, showHeading = true }: { result: ClaimResult; showHeading?: boolean }) {
  const { report, openLink, draftJira, contacts } = useClaimActions();
  const jiraButton = useRef<HTMLButtonElement>(null);
  const kind = KIND_FOR_CLAIM[result.claim.type];
  const coverage = report.limits.coverage[kind];

  return (
    <span className="ev">
      {showHeading && (
        <span className={`ev-heading ev-${result.verdict}`}>
          <StatusIcon verdict={result.verdict} /> {STATUS_PHRASE[result.verdict]}
        </span>
      )}
      <span className="ev-statement">{result.statement}</span>
      {result.evidence.slice(0, 4).map((evidence) => (
        <span className="ev-item" key={evidence.id}>
          {evidence.file !== undefined && evidence.line !== undefined && (
            isSafePermalink(evidence.permalink) ? (
              <button
                type="button"
                className="ev-link"
                onClick={() => openLink(evidence.permalink as string)}
              >
                {evidence.file}:{evidence.line}
                <span className="sr-only"> (opens on GitHub)</span>
              </button>
            ) : (
              <span className="ev-loc">
                {evidence.file}:{evidence.line}
              </span>
            )
          )}
          {evidence.snippet !== undefined && evidence.snippet !== '' && <code className="ev-snippet">{evidence.snippet}</code>}
          <span className="ev-id" title="Evidence ID. The Rovo agent and MCP tools return the same ID.">
            <span className="sr-only">Evidence ID </span>
            {evidence.id}
          </span>
        </span>
      ))}
      {result.verdict === 'contradicted' && result.suggestion !== undefined && (
        <span className="ev-fix" data-testid="suggested-edit">
          {suggestionStatement({ claim: result.claim.raw, kind: result.suggestion.kind, ...(result.suggestion.replacement !== undefined ? { replacement: result.suggestion.replacement } : {}) })}
        </span>
      )}
      {result.verdict === 'contradicted' && contacts !== undefined && contacts.length > 0 && (
        <span className="ev-ask" data-testid="who-to-ask">
          <span className="ev-ask-label">Who to ask:</span>{' '}
          {contacts.map((contact, i) => (
            <span key={contact.accountId}>
              {i > 0 && ', '}
              {contact.displayName} ({ROLE_LABEL[contact.role]})
            </span>
          ))}
        </span>
      )}
      {result.verdict === 'unknown' && (
        <span className="ev-note">
          Coverage for {KIND_LABEL[kind]} in this index: {COVERAGE_LABEL[coverage]}.
        </span>
      )}
      <span className="ev-meta">
        {report.repo.fullName}@{shortSha(report.repo.sha)} · indexed {formatIndexTime(report.repo.indexedAt)}
        {report.stale ? ' · index may be stale' : ''}
      </span>
      {result.verdict === 'contradicted' && (
        <button type="button" ref={jiraButton} className="btn btn-small" onClick={() => draftJira(result, jiraButton.current)}>
          Draft Jira task
        </button>
      )}
    </span>
  );
}
