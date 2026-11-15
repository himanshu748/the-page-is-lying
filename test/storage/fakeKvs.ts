import type { KvsBatchResult, KvsLike, Ttl } from '../../src/storage/kvs';

const KEY_RE = /^(?!\s+$)[a-zA-Z0-9:._\s#-]{1,500}$/;
export const MAX_VALUE_BYTES = 240 * 1024;

export interface Op {
  op: 'get' | 'set' | 'delete' | 'batchSet' | 'batchGet' | 'batchDelete' | 'getSecret' | 'setSecret' | 'deleteSecret';
  keys: string[];
}

/** In-memory KVS that enforces the key regex and the 240 KiB value limit and records every call. */
export class FakeKvs implements KvsLike {
  readonly data = new Map<string, unknown>();
  readonly secrets = new Map<string, unknown>();
  readonly ttls = new Map<string, Ttl>();
  readonly ops: Op[] = [];
  failBatchSet = false;

  private check(key: string, value?: unknown): void {
    if (!KEY_RE.test(key)) throw new Error(`invalid KVS key: ${key}`);
    if (value !== undefined && Buffer.byteLength(JSON.stringify(value)) > MAX_VALUE_BYTES) throw new Error(`value too large for ${key}`);
  }

  async get<T>(key: string): Promise<T | undefined> {
    this.ops.push({ op: 'get', keys: [key] });
    return structuredClone(this.data.get(key)) as T | undefined;
  }
  async set(key: string, value: unknown, options?: { ttl?: Ttl }): Promise<void> {
    this.check(key, value);
    this.ops.push({ op: 'set', keys: [key] });
    this.data.set(key, structuredClone(value));
    if (options?.ttl) this.ttls.set(key, options.ttl);
  }
  async delete(key: string): Promise<void> {
    this.ops.push({ op: 'delete', keys: [key] });
    this.data.delete(key);
  }
  async batchSet(items: Array<{ key: string; value: unknown; options?: { ttl?: Ttl } }>): Promise<KvsBatchResult> {
    for (const i of items) this.check(i.key, i.value);
    this.ops.push({ op: 'batchSet', keys: items.map((i) => i.key) });
    if (this.failBatchSet) return { successfulKeys: [], failedKeys: items.map((i) => ({ key: i.key })) };
    for (const i of items) this.data.set(i.key, structuredClone(i.value));
    return { successfulKeys: items.map((i) => ({ key: i.key })), failedKeys: [] };
  }
  async batchGet<T>(items: Array<{ key: string }>): Promise<{ successfulKeys: Array<{ key: string; value: T }>; failedKeys: unknown[] }> {
    this.ops.push({ op: 'batchGet', keys: items.map((i) => i.key) });
    const ok = items.filter((i) => this.data.has(i.key)).map((i) => ({ key: i.key, value: structuredClone(this.data.get(i.key)) as T }));
    return { successfulKeys: ok, failedKeys: [] };
  }
  async batchDelete(items: Array<{ key: string }>): Promise<KvsBatchResult> {
    this.ops.push({ op: 'batchDelete', keys: items.map((i) => i.key) });
    for (const i of items) this.data.delete(i.key);
    return { successfulKeys: items.map((i) => ({ key: i.key })), failedKeys: [] };
  }
  async getSecret<T>(key: string): Promise<T | undefined> {
    this.ops.push({ op: 'getSecret', keys: [key] });
    return this.secrets.get(key) as T | undefined;
  }
  async setSecret(key: string, value: unknown): Promise<void> {
    this.check(key);
    this.ops.push({ op: 'setSecret', keys: [key] });
    this.secrets.set(key, value);
  }
  async deleteSecret(key: string): Promise<void> {
    this.ops.push({ op: 'deleteSecret', keys: [key] });
    this.secrets.delete(key);
  }

  /** Keys written by set or batchSet, in order. */
  writeOrder(): string[] {
    return this.ops.filter((o) => o.op === 'set' || o.op === 'batchSet').flatMap((o) => o.keys);
  }
}
