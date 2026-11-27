const NAMED_CATCH_ALL = /^\*[A-Za-z_$][\w$]*$/;

/** Minimum segments consumed by a terminal wildcard. */
export function catchAllMinimumSegments(segment: string): 0 | 1 | undefined {
  if (segment === '*') return 0;
  if (NAMED_CATCH_ALL.test(segment)) return 1;
  if (segment.startsWith('{') && segment.endsWith('}') && NAMED_CATCH_ALL.test(segment.slice(1, -1))) return 0;
  return undefined;
}
