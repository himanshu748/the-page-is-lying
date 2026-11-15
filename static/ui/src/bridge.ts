/**
 * Single import point for @forge/bridge so Playwright can alias it to e2e/bridge-mock.ts
 * (see vite.config.e2e.ts). Task D must import the bridge only from this file.
 */
import { invoke, view, router, rovo } from '@forge/bridge';

export { invoke, view, router, rovo };
