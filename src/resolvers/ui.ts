import Resolver from '@forge/resolver';

/**
 * UI resolver shared by the macro, byline popup and settings page (Task D owns this file).
 * Task 0 stub: one placeholder resolver so the skeleton installs and renders.
 */
const resolver = new Resolver();

export interface PingResult {
  ok: true;
  app: 'the-page-is-lying';
}

resolver.define('ping', (): PingResult => ({ ok: true, app: 'the-page-is-lying' }));

export const handler = resolver.getDefinitions();
