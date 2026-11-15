import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ClaimResult, Report } from '@core/model';
import type { JiraTarget } from '../../../src/resolvers/contract';
import { invoke, router, view } from './bridge';
import { JiraDraftModal, buildCreateUrl, buildJiraDraft } from './views/JiraDraftModal';
import type { JiraDraft } from './views/JiraDraftModal';

/** Owns the Jira draft modal state for a view. Returns the opener and the modal element. */
export function useJiraDraft(report: Report | undefined, pageTitle: string): { draftJira: (result: ClaimResult, opener: HTMLElement | null) => void; modal: ReactNode } {
  const [draft, setDraft] = useState<JiraDraft | null>(null);
  const [target, setTarget] = useState<JiraTarget | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  const draftJira = useCallback(
    (result: ClaimResult, from: HTMLElement | null) => {
      if (!report) return;
      // The hover card hides when focus moves to the modal, so return focus to the claim itself.
      opener.current = from?.closest('.claim-wrap')?.querySelector<HTMLElement>('button.claim') ?? from;
      setDraft(buildJiraDraft(result, report, pageTitle));
      void invoke<JiraTarget | null>('getJiraTarget')
        .then(setTarget)
        .catch(() => setTarget(null));
    },
    [report, pageTitle],
  );

  const close = () => {
    setDraft(null);
    const el = opener.current;
    if (el) setTimeout(() => el.focus(), 0);
  };

  const openCreate = () => {
    if (!draft || !target) return;
    void view
      .getContext()
      .then((context) => {
        const siteUrl = String((context as { siteUrl?: unknown }).siteUrl ?? '');
        return router.open(buildCreateUrl(siteUrl, target, draft));
      })
      .catch(() => undefined);
  };

  const modal = draft ? <JiraDraftModal draft={draft} target={target} onClose={close} onOpenCreate={openCreate} /> : null;
  return { draftJira, modal };
}
