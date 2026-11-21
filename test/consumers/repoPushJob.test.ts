import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decideRepoPush } from '../../src/consumers/repoPushJob';

const SECRET = 'whsec_test_secret';
const KEY = 'gh:himanshu748%2Fpayments-api@main';
const BODY = '{"ref":"refs/heads/main"}';

function signed(body: string, secret: string = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;
}

describe('decideRepoPush', () => {
  it('rejects everything when WEBHOOK_SECRET is unset', () => {
    const r = decideRepoPush({
      req: { body: BODY, headers: { 'x-hub-signature-256': signed(BODY) } },
      repoKey: KEY,
      secret: undefined,
    });
    expect(r).toEqual({ action: 'reject', status: 503, why: 'webhook_not_configured' });
  });

  it('rejects when no repo is configured yet', () => {
    const r = decideRepoPush({
      req: { body: BODY, headers: { 'x-hub-signature-256': signed(BODY) } },
      repoKey: undefined,
      secret: SECRET,
    });
    expect(r).toEqual({ action: 'reject', status: 409, why: 'no_settings' });
  });

  it('enqueues for a valid GitHub signature', () => {
    const r = decideRepoPush({
      req: { body: BODY, headers: { 'X-Hub-Signature-256': signed(BODY) } },
      repoKey: KEY,
      secret: SECRET,
    });
    expect(r).toEqual({ action: 'enqueue', repoKey: KEY });
  });

  it('rejects a signature made with another secret or another body', () => {
    for (const req of [
      { body: BODY, headers: { 'x-hub-signature-256': signed(BODY, 'wrong') } },
      { body: '{"ref":"refs/heads/other"}', headers: { 'x-hub-signature-256': signed(BODY) } },
    ]) {
      const r = decideRepoPush({ req, repoKey: KEY, secret: SECRET });
      expect(r).toEqual({ action: 'reject', status: 401, why: 'bad_signature' });
    }
  });

  it('enqueues for the secret as a query parameter (Bitbucket-style)', () => {
    const r = decideRepoPush({
      req: { body: BODY, queryParameters: { secret: SECRET } },
      repoKey: KEY,
      secret: SECRET,
    });
    expect(r).toEqual({ action: 'enqueue', repoKey: KEY });
  });

  it('rejects a wrong or missing query secret', () => {
    for (const queryParameters of [{ secret: 'nope' }, {}]) {
      const r = decideRepoPush({ req: { body: BODY, queryParameters }, repoKey: KEY, secret: SECRET });
      expect(r).toEqual({ action: 'reject', status: 401, why: 'bad_signature' });
    }
  });
});
