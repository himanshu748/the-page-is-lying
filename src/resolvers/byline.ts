/**
 * Byline dynamicProperties (Task D owns this file).
 * Task 0 stub: always the plain title, never does heavy work.
 */
export interface BylineProperties {
  title: string;
  tooltip: string;
}

export const dynamicProperties = (): BylineProperties => ({
  title: 'Runbook check',
  tooltip: "Check this page's claims against code",
});
