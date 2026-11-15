import { describe, expect, it } from 'vitest';
import { normalizeRange } from '../../../src/core/claims/packages.js';
import type { NormalizedClaim } from '../../../src/core/model.js';
import { codeBlock, doc, fromAdf, fromText } from './helpers.js';

const pkg = (ecosystem: string, name: string, range: string): NormalizedClaim =>
  ({ type: 'package_version', ecosystem, name, range }) as NormalizedClaim;

describe('normalizeRange', () => {
  it.each([
    ['v1.2.3', '1.2.3'],
    [' >= 20 ', '>=20'],
    ['14.x', '14.x'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeRange(input)).toBe(expected);
  });
});

describe('package_version extraction', () => {
  it.each<[string, string, NormalizedClaim[]]>([
    ['name@version', 'We pin `express@4.18.2`.', [pkg('npm', 'express', '4.18.2')]],
    ['name@version in prose', 'We pin express@4.18.2 today.', [pkg('npm', 'express', '4.18.2')]],
    ['caret range', 'Use `lodash@^4.17.0`', [pkg('npm', 'lodash', '^4.17.0')]],
    ['scoped package', 'Use `@forge/api@8.5.0`', [pkg('npm', '@forge/api', '8.5.0')]],
    ['wildcard', 'Use `react@18.x`', [pkg('npm', 'react', '18.x')]],
    ['prerelease', 'Use `foo@2.0.0-beta.1`', [pkg('npm', 'foo', '2.0.0-beta.1')]],
    ['go module', 'Use `github.com/gin-gonic/gin@v1.9.1`', [pkg('go', 'github.com/gin-gonic/gin', '1.9.1')]],
    ['name x.x in prose', 'Requires stripe 14.x for refunds.', [pkg('npm', 'stripe', '14.x')]],
    ['name vX.Y in prose', 'Requires stripe v14.1 for refunds.', [pkg('npm', 'stripe', '14.1')]],
    ['name X.Y.Z in prose', 'Requires stripe 14.1.2 for refunds.', [pkg('npm', 'stripe', '14.1.2')]],
    ['name X.Y in code', 'Use `stripe 14.1`', [pkg('npm', 'stripe', '14.1')]],
    ['pip pin', 'Use `Django==4.2.1`', [pkg('pypi', 'django', '==4.2.1')]],
    ['pip range', 'Use `requests>=2.31`', [pkg('pypi', 'requests', '>=2.31')]],
    ['maven', 'Use `org.apache:commons:3.12.0`', [pkg('maven', 'org.apache:commons', '3.12.0')]],
    ['Node.js or later', 'Requires Node.js 20 or later.', [pkg('runtime', 'node', '>=20')]],
    ['Node plus', 'Requires Node 18+.', [pkg('runtime', 'node', '>=18')]],
    ['Node operator', 'Requires Node.js >=20.1.', [pkg('runtime', 'node', '>=20.1')]],
    ['Node exact', 'Runs on Node v20.x.', [pkg('runtime', 'node', '20.x')]],
    ['Python or higher', 'Needs Python 3.11 or higher.', [pkg('runtime', 'python', '>=3.11')]],
    ['python in code', 'Needs `python 3.12`', [pkg('runtime', 'python', '3.12')]],
  ])('%s', (_name, input, expected) => {
    expect(fromText(input, 'package_version')).toEqual(expected);
  });

  it.each<[string, string]>([
    ['plain version word', 'See version 1.2.3 notes.'],
    ['section number', 'Read section 2.1.3 first.'],
    ['single number', 'Needs stripe 14 maybe.'],
    ['email', 'Mail dev@example.com'],
    ['at without version', 'Use `express@latest`'],
    ['lowercase node in prose', 'Each node 20 times.'],
    ['pip in prose', 'We say foo==1.2.3 in prose.'],
    ['maven in prose', 'We say a:b:1.2.3 in prose.'],
    ['release word', 'Release 3.4.5 shipped.'],
  ])('negative: %s', (_name, input) => {
    expect(fromText(input, 'package_version')).toEqual([]);
  });

  it('code blocks', () => {
    const adf = doc(codeBlock('npm i express@4.18.2 stripe@14\nrequests==2.31.0'));
    expect(fromAdf(adf, 'package_version')).toEqual([pkg('npm', 'express', '4.18.2'), pkg('npm', 'stripe', '14'), pkg('pypi', 'requests', '==2.31.0')]);
  });
});
