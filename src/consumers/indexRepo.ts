/**
 * Async queue consumer `repo-index` (Task B owns this file).
 * Task 0 stub: accepts the event and does nothing.
 */
export interface IndexRepoEvent {
  body?: { repoKey?: string };
}

export const handler = async (_event: IndexRepoEvent): Promise<void> => {
  // Implemented in Task B.
};
