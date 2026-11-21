/**
 * The decision part of the repo-push webtrigger (manifest `repo-push`, function
 * `repo-push-fn`). Kept free of Forge imports so tests drive it with plain
 * objects; `repoPush.ts` binds it to the real queue.
 *
 * A push event only ever enqueues a rebuild of the repository already named in
 * the site settings: `repoKey` is computed from settings, never from the event
 * body, so a forged event cannot point the indexer at another repository.
 *
 * Authentication: `WEBHOOK_SECRET` (a forge variable) must be set before the
 * endpoint accepts anything. GitHub sends `X-Hub-Signature-256` (HMAC-SHA256
 * hex over the raw body); other senders (Bitbucket Cloud has no signatures)
 * pass the secret as the `secret` query parameter.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface WebtriggerRequest {
  body?: string;
  headers?: Record<string, string | string[] | undefined>;
  queryParameters?: Record<string, string | string[] | undefined>;
}

export type RepoPushResult =
  | { action: 'enqueue'; repoKey: string }
  | { action: 'reject'; status: number; why: string };

function header(headers: WebtriggerRequest['headers'], name: string): string | undefined {
  const v = headers?.[name] ?? headers?.[name.toLowerCase()] ??
    Object.entries(headers ?? {}).find(([k]) => k.toLowerCase() === name)?.[1];
  return Array.isArray(v) ? v[0] : v;
}

function timingEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function decideRepoPush(args: {
  req: WebtriggerRequest;
  repoKey: string | undefined;
  secret: string | undefined;
}): RepoPushResult {
  const { req, repoKey, secret } = args;
  if (secret === undefined || secret === '') {
    return { action: 'reject', status: 503, why: 'webhook_not_configured' };
  }
  if (repoKey === undefined) {
    return { action: 'reject', status: 409, why: 'no_settings' };
  }

  const signature = header(req.headers, 'x-hub-signature-256');
  if (signature !== undefined) {
    const digest = `sha256=${createHmac('sha256', secret).update(req.body ?? '', 'utf8').digest('hex')}`;
    if (timingEqual(signature, digest)) return { action: 'enqueue', repoKey };
    return { action: 'reject', status: 401, why: 'bad_signature' };
  }

  const q = req.queryParameters?.['secret'];
  const token = Array.isArray(q) ? q[0] : q;
  if (token !== undefined && timingEqual(token, secret)) {
    return { action: 'enqueue', repoKey };
  }
  return { action: 'reject', status: 401, why: 'bad_signature' };
}
