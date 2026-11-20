import { createContext, useContext } from 'react';
import type { ClaimResult, Report } from '@core/model';
import type { PageContact } from '../../../../src/resolvers/contract';

export interface ClaimActions {
  report: Report;
  /** Opens a permalink with router.open. */
  openLink: (url: string) => void;
  /** Opens the Jira draft modal for a contradicted claim. */
  draftJira: (result: ClaimResult, opener: HTMLElement | null) => void;
  /** Page owner, last editor and creator, shown on contradicted claims. Empty until loaded or when unknown. */
  contacts?: PageContact[];
}

export const ClaimActionsContext = createContext<ClaimActions | null>(null);

export function useClaimActions(): ClaimActions {
  const value = useContext(ClaimActionsContext);
  if (!value) throw new Error('ClaimActionsContext is missing');
  return value;
}
