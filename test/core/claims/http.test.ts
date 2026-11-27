import { describe, expect, it } from 'vitest';
import { normalizeHttpPath } from '../../../src/core/claims/http.js';
import type { NormalizedClaim } from '../../../src/core/model.js';
import { allFromText, codeBlock, doc, fromAdf, fromText, para } from './helpers.js';

const http = (method: string, path: string, host?: string): NormalizedClaim =>
  host === undefined
    ? ({ type: 'http_endpoint', method, path } as NormalizedClaim)
    : ({ type: 'http_endpoint', method, path, host } as NormalizedClaim);

describe('normalizeHttpPath', () => {
  it.each([
    ['/v2/payments/{id}', '/v2/payments/:param'],
    ['/v2/payments/:id', '/v2/payments/:param'],
    ['/v2/payments/<id>', '/v2/payments/:param'],
    ['/v2/payments/<int:id>', '/v2/payments/:param'],
    ['/v2/payments/[id]', '/v2/payments/:param'],
    ['/v2/payments/', '/v2/payments'],
    ['/v2/payments?limit=5#top', '/v2/payments'],
    ['//v2//payments/./x/', '/v2/payments/x'],
    ['/', '/'],
    ['', '/'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeHttpPath(input)).toBe(expected);
  });
});

describe('http_endpoint extraction', () => {
  it.each<[string, string, NormalizedClaim[]]>([
    ['method in code span', 'Call `POST /v1/charge` now.', [http('POST', '/v1/charge')]],
    ['method in prose', 'Call POST /v1/charge now.', [http('POST', '/v1/charge')]],
    ['trailing sentence dot', 'Use GET /health.', [http('GET', '/health')]],
    ['param styles', 'GET /a/{id}, PUT /b/:id and DELETE /c/<int:id>', [http('GET', '/a/:param'), http('PUT', '/b/:param'), http('DELETE', '/c/:param')]],
    ['query and fragment', 'Try `GET /v2/payments?limit=5#x`', [http('GET', '/v2/payments')]],
    ['trailing slash', 'Try `PATCH /v2/payments/`', [http('PATCH', '/v2/payments')]],
    ['bare versioned path in code', 'The `/v1/charge` endpoint is old.', [http('ANY', '/v1/charge')]],
    ['bare versioned path with param', 'See `/v2/payments/{id}`.', [http('ANY', '/v2/payments/:param')]],
    ['bare root version', 'Prefix is `/v3`.', [http('ANY', '/v3')]],
    ['curl with -X and URL', 'Run `curl -X DELETE https://API.example.com/v2/payments/123?x=1`', [http('DELETE', '/v2/payments/123', 'api.example.com')]],
    ['curl --request', 'Run `curl --request PUT https://h.io/v1/a`', [http('PUT', '/v1/a', 'h.io')]],
    ['curl -XPOST', 'Run `curl -XPOST "https://h.io/v1/a"`', [http('POST', '/v1/a', 'h.io')]],
    ['curl default GET', 'Run `curl https://h.io:8443/v1/a`', [http('GET', '/v1/a', 'h.io')]],
    ['curl with data defaults to POST', 'Run `curl -d @x.json https://h.io/v1/a`', [http('POST', '/v1/a', 'h.io')]],
    ['curl -T uploads to an explicit path with PUT', 'Run `curl -T report.json https://h.io/v1/reports/42`', [http('PUT', '/v1/reports/42', 'h.io')]],
    ['curl --upload-file consumes a flag-shaped filename', 'Run `curl --upload-file "-I" https://h.io/v1/reports/42`', [http('PUT', '/v1/reports/42', 'h.io')]],
    ['curl --upload-file equals syntax in current curl', 'Run `curl --upload-file=report.json https://h.io/v1/reports/42`', [http('PUT', '/v1/reports/42', 'h.io')]],
    ['curl accepts an upload file joined to bundled short options', 'Run `curl -sSTreport.json https://h.io/v1/reports/42`', [http('PUT', '/v1/reports/42', 'h.io')]],
    ['curl --get does not change upload method', 'Run `curl -G -T report.json https://h.io/v1/reports/42`', [http('PUT', '/v1/reports/42', 'h.io')]],
    ['curl explicit method overrides the upload default', 'Run `curl -X PATCH --upload-file report.json https://h.io/v1/reports/42`', [http('PATCH', '/v1/reports/42', 'h.io')]],
    ['curl empty upload argument keeps the transfer a download', 'Run `curl -T "" https://h.io/v1/reports/42`', [http('GET', '/v1/reports/42', 'h.io')]],
    ['curl --next upload does not change the first transfer', 'Run `curl https://h.io/v1/reports --next -T report.json https://h.io/v1/reports/42`', [http('GET', '/v1/reports', 'h.io')]],
    ['curl -I uses HEAD', 'Run `curl -I https://h.io/v1/a`', [http('HEAD', '/v1/a', 'h.io')]],
    ['curl --head uses HEAD', 'Run `curl --head https://h.io/v1/a`', [http('HEAD', '/v1/a', 'h.io')]],
    ['curl groups short modifiers with -I', 'Run `curl -sSI https://h.io/v1/a`', [http('HEAD', '/v1/a', 'h.io')]],
    ['curl -G turns data into a query', 'Run `curl -G --data-urlencode "q=x" https://h.io/v1/a`', [http('GET', '/v1/a', 'h.io')]],
    ['curl -G leaves multipart as POST', 'Run `curl -G -F name=x https://h.io/v1/a`', [http('POST', '/v1/a', 'h.io')]],
    ['curl --get after --form-string leaves multipart as POST', 'Run `curl --form-string name=x --get https://h.io/v1/a`', [http('POST', '/v1/a', 'h.io')]],
    ['curl explicit request overrides multipart default', 'Run `curl -X PUT -G -F name=x https://h.io/v1/a`', [http('PUT', '/v1/a', 'h.io')]],
    ['curl --get with --head still sends HEAD', 'Run `curl --get --head -d q=x https://h.io/v1/a`', [http('HEAD', '/v1/a', 'h.io')]],
    ['curl explicit request overrides --head', 'Run `curl --head -X GET https://h.io/v1/a`', [http('GET', '/v1/a', 'h.io')]],
    ['curl data that looks like a method flag stays data', 'Run `curl -d "-I" https://h.io/v1/a`', [http('POST', '/v1/a', 'h.io')]],
    ['curl with prompt and headers', 'Run `$ curl -s -H "Accept: x" https://h.io/v1/a`', [http('GET', '/v1/a', 'h.io')]],
  ])('%s', (_name, input, expected) => {
    expect(fromText(input, 'http_endpoint')).toEqual(expected);
  });

  it.each<[string, string]>([
    ['method without path', 'We GET things and POST them.'],
    ['lowercase method', 'call post /v1/charge'],
    ['method with root only', 'GET / is the home page'],
    ['bare path in prose', 'The /v1/charge endpoint is old.'],
    ['bare non-versioned path in code', 'Open `/dashboard`'],
    ['versioned segment inside a file path', 'Edit `src/v1/routes.ts`'],
    ['url inside code is not bare', 'Open `https://example.com/v1/x`'],
    ['curl without url', 'Run `curl --help`'],
    ['curl to a variable host', 'Run `curl $BASE/v1/a`'],
    ['curl with unknown method', 'Run `curl -X PROPFIND https://h.io/v1/a`'],
    ['curl cannot send HEAD with a multipart body', 'Run `curl -I -G -F name=x https://h.io/v1/a`'],
    ['curl cannot send HEAD with non-query data', 'Run `curl -I -d q=x https://h.io/v1/a`'],
    ['curl cannot combine multipart and data options', 'Run `curl -G -F name=x -d q=x https://h.io/v1/a`'],
    ['curl appends the upload filename to a directory target', 'Run `curl -T report.json https://h.io/v1/reports/`'],
    ['curl can upload to a filename added to the host root', 'Run `curl -T report.json https://h.io`'],
    ['curl cannot combine an upload and HEAD', 'Run `curl -sSIT report.json https://h.io/v1/reports/42`'],
    ['curl cannot combine an upload and data options', 'Run `curl -G -d q=x -T report.json https://h.io/v1/reports/42`'],
    ['curl upload option requires a filename argument', 'Run `curl https://h.io/v1/reports/42 -T`'],
    ['curl upload for a non-HTTP first URL is not attributed to another URL', 'Run `curl -T report.json ftp://h.io/export/report.json https://h.io/v1/reports/42`'],
    ['empty input', ''],
  ])('negative: %s', (_name, input) => {
    expect(fromText(input, 'http_endpoint')).toEqual([]);
  });

  it('curl in a code block, multiple lines and continuation prompts', () => {
    const adf = doc(
      codeBlock('$ curl -X POST https://api.example.com/v1/charge \\\n  -H "Authorization: Bearer $STRIPE_KEY"\ncurl https://api.example.com/v2/payments/42 | jq .'),
    );
    expect(fromAdf(adf, 'http_endpoint')).toEqual([
      http('POST', '/v1/charge', 'api.example.com'),
      http('GET', '/v2/payments/42', 'api.example.com'),
    ]);
  });

  it('curl in a code block still yields the env var claim from its header', () => {
    const adf = doc(codeBlock('curl -H "Authorization: Bearer $STRIPE_KEY" https://api.example.com/v1/charge'));
    expect(fromAdf(adf).map((c) => c.type).sort()).toEqual(['env_var', 'http_endpoint']);
  });

  it('confidence: high in code, medium in prose', () => {
    expect(allFromText('Call `POST /v1/a`').map((c) => c.confidence)).toEqual(['high']);
    expect(allFromText('Call POST /v1/a').map((c) => c.confidence)).toEqual(['medium']);
  });

  it('handles an inline code mark on the path only', () => {
    expect(fromAdf(doc(para('Call POST ', { code: '/v1/charge' }, ' please')), 'http_endpoint')).toEqual([http('POST', '/v1/charge')]);
  });
});
