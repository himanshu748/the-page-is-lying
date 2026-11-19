/**
 * Single import point for @forge/bridge so Playwright can alias it to e2e/bridge-mock.ts
 * (see vite.config.e2e.ts). Task D must import the bridge only from this file.
 */
import { invoke as bridgeInvoke, view, router, rovo } from '@forge/bridge';

/** Typed resolver call. The bridge types the result loosely; resolvers return the shapes in src/resolvers/contract.ts. */
export function invoke<T>(name: string, payload?: unknown): Promise<T> {
  return (bridgeInvoke as (n: string, p?: unknown) => Promise<unknown>)(name, payload) as Promise<T>;
}

export { view, router, rovo };
