/**
 * The slice of the Forge KVS API this app uses, so storage code can run against a fake in
 * tests. The real binding lives in src/storage/forge.ts.
 */
export interface Ttl {
  value: number;
  unit: 'SECONDS' | 'MINUTES' | 'HOURS' | 'DAYS';
}

export interface KvsBatchResult {
  successfulKeys: unknown[];
  failedKeys: unknown[];
}

export interface KvsLike {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown, options?: { ttl?: Ttl }): Promise<void>;
  delete(key: string): Promise<void>;
  batchSet(items: Array<{ key: string; value: unknown; options?: { ttl?: Ttl } }>): Promise<KvsBatchResult>;
  batchGet<T>(items: Array<{ key: string }>): Promise<{ successfulKeys: Array<{ key: string; value: T }>; failedKeys: unknown[] }>;
  batchDelete(items: Array<{ key: string }>): Promise<KvsBatchResult>;
  getSecret<T>(key: string): Promise<T | undefined>;
  setSecret(key: string, value: unknown): Promise<void>;
  deleteSecret(key: string): Promise<void>;
}

export class StorageError extends Error {
  readonly code: 'write_failed' | 'index_corrupt' | 'invalid_settings';
  constructor(code: StorageError['code'], message: string) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
  }
}
