import { describe, expect, it } from 'vitest';
import { RepoError } from '../../src/repo/source';
import { createRepoSource, parseRepoUrl } from '../../src/repo';
import { fakeFetch } from './helpers';

describe('parseRepoUrl', () => {
  it('accepts GitHub and Bitbucket URLs', () => {
    expect(parseRepoUrl('https://github.com/himanshu748/payments-api')).toEqual({ provider: 'github', owner: 'himanshu748', repo: 'payments-api' });
    expect(parseRepoUrl(' https://github.com/o/r.git/ ')).toEqual({ provider: 'github', owner: 'o', repo: 'r' });
    expect(parseRepoUrl('https://bitbucket.org/ws/my.repo')).toEqual({ provider: 'bitbucket', owner: 'ws', repo: 'my.repo' });
  });
  it.each([
    'http://github.com/o/r',
    'https://gitlab.com/o/r',
    'https://github.com.evil.com/o/r',
    'https://evil.com/github.com/o/r',
    'https://user:pw@github.com/o/r',
    'https://github.com:444/o/r',
    'https://github.com/o',
    'https://github.com/o/r/tree/main',
    'https://github.com/o/r?x=1',
    'https://github.com/o/r#frag',
    'https://github.com/-bad_owner/r',
    'https://github.com/o/..',
    'ftp://github.com/o/r',
    'not a url',
    '',
    `https://github.com/o/${'r'.repeat(400)}`,
  ])('rejects %s', (u) => {
    expect(() => parseRepoUrl(u)).toThrow(RepoError);
    try {
      parseRepoUrl(u);
    } catch (e) {
      expect((e as RepoError).reason).toBe('invalid_repo_url');
    }
  });
  it('creates the right adapter', () => {
    const f = fakeFetch([]).fetch;
    expect(createRepoSource({ repoUrl: 'https://github.com/o/r', fetch: f }).provider).toBe('github');
    expect(createRepoSource({ repoUrl: 'https://bitbucket.org/o/r', fetch: f }).provider).toBe('bitbucket');
  });
});
