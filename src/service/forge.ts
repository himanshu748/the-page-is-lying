/**
 * The one real check service wiring: Task A's extractor, Task B's storage and fetch, Task C's pipeline.
 * The macro and byline resolvers (`resolvers/defaultBackend.ts`) and the Rovo actions and MCP tools
 * (`actions/service.ts`) all build their service from here.
 */
import { forgeEnqueue, forgeFetch, forgeKvs } from '../storage/forge';
import type { CheckDeps } from './check';
import { createClaimExtractor } from './extractor';
import { createIndexLoader } from './indexLoader';

export function forgeCheckDeps(): CheckDeps {
  return {
    indexLoader: createIndexLoader({ kvs: forgeKvs(), fetch: forgeFetch, now: Date.now, enqueue: forgeEnqueue }),
    extractor: createClaimExtractor(),
    clock: { now: () => new Date() },
  };
}
