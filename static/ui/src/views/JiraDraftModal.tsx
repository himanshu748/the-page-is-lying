import { useEffect, useRef, useState } from 'react';
import type { ClaimResult, Report } from '@core/model';
import { jiraDraftDescription, jiraDraftSummary } from '@core/wording';
import type { JiraTarget } from '../../../../src/resolvers/contract';

export interface JiraDraft {
  summary: string;
  description: string;
}

/** Deterministic issue text from the result (no LLM). */
export function buildJiraDraft(result: ClaimResult, report: Report, pageTitle: string): JiraDraft {
  return {
    summary: jiraDraftSummary({ claim: result.claim.raw }),
    description: jiraDraftDescription({
      claim: result.claim.raw,
      statement: result.statement,
      page: pageTitle,
      repo: report.repo.fullName,
      sha: report.repo.sha,
    }),
  };
}

export function buildCreateUrl(siteUrl: string, target: JiraTarget, draft: JiraDraft): string {
  const query = new URLSearchParams({
    pid: target.projectId,
    issuetype: target.issueTypeId,
    summary: draft.summary,
    description: draft.description,
  });
  return `${siteUrl.replace(/\/$/, '')}/secure/CreateIssueDetails!init.jspa?${query.toString()}`;
}

interface Props {
  draft: JiraDraft;
  target: JiraTarget | null;
  onClose: () => void;
  onOpenCreate: () => void;
}

/** Preview only. Nothing is sent anywhere until the user clicks "Open Jira create screen", which just navigates. */
export function JiraDraftModal({ draft, target, onClose, onOpenCreate }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');
  const fullText = `${draft.summary}\n\n${draft.description}`;

  useEffect(() => {
    heading.current?.focus();
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fullText);
      setCopied('done');
    } catch {
      setCopied('failed');
    }
  };

  return (
    <div className="modal-backdrop">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="jira-draft-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <h2 id="jira-draft-title" tabIndex={-1} ref={heading}>
          Draft Jira task
        </h2>
        <p className="muted">Nothing is created from here. This is the exact text, ready to copy or to open in Jira.</p>
        <h3>Summary</h3>
        <pre className="draft" data-testid="jira-summary">{draft.summary}</pre>
        <h3>Description</h3>
        <pre className="draft" data-testid="jira-description">{draft.description}</pre>
        <div className="row">
          <button type="button" className="btn" onClick={() => void copy()}>
            Copy text
          </button>
          <button type="button" className="btn" disabled={target === null} onClick={onOpenCreate}>
            Open Jira create screen
          </button>
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Close
          </button>
        </div>
        <p role="status" className="muted">
          {copied === 'done' && 'Copied to the clipboard.'}
          {copied === 'failed' && 'Copy was blocked here. Select the text above and copy it.'}
          {target === null && 'Set a Jira project id and issue type id in the app settings to enable the create screen link.'}
        </p>
      </div>
    </div>
  );
}
