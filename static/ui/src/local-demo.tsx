import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { extractClaims, extractClaimsFromText } from '@core/claims/index';
import { buildRepoIndex } from '@core/index/build';
import { buildReport, matchClaims } from '@core/match/index';
import brokenPage from '../../../demo/confluence/payments-api-runbook.adf.json?raw';
import fixedPage from '../../../demo/confluence/payments-api-runbook.fixed.adf.json?raw';
import catchAllSource from '../../../demo/fixtures/catch-all/server.js?raw';
import { STATUS_LABEL, StatusIcon } from './status';
import './styles.css';
import './local-demo.css';

const fixtureDir = '../../../demo/payments-api/';
const fixtureSources = import.meta.glob<string>(
  ['../../../demo/payments-api/src/**/*.ts', '../../../demo/payments-api/package.json', '../../../demo/payments-api/.env.example'],
  { eager: true, import: 'default', query: '?raw' },
);
const files = Object.entries(fixtureSources).map(([file, text]) => ({
  path: file.slice(fixtureDir.length),
  text,
}));
const index = buildRepoIndex(files, {
  repo: {
    provider: 'github',
    fullName: 'himanshu748/payments-api-demo',
    ref: 'bundled-fixture',
    sha: '44c8112e1bc0f3be63fe45fbcb70bfaf6bfb03a5',
    indexedAt: new Date().toISOString(),
  },
  stats: { filesIndexed: files.length, filesSkipped: 0, truncated: false },
});

function checkRunbook(page: string) {
  const { claims, claimsTruncated } = extractClaims(page);
  return buildReport({ index, results: matchClaims(claims, index), claimsTruncated });
}

const original = checkRunbook(brokenPage);
const corrected = checkRunbook(fixedPage);
const catchAllIndex = buildRepoIndex([{ path: 'server.js', text: catchAllSource }], {
  repo: { ...index.repo, fullName: 'local/express-frontend', sha: 'local-fixture' },
  stats: { filesIndexed: 1, filesSkipped: 0, truncated: false },
});
const catchAllClaims = extractClaimsFromText('`GET /v1/refunds/123`\n\n`GET /v2/refunds/{id}`\n\n`GET /*`');
const catchAllReport = buildReport({
  index: catchAllIndex,
  results: matchClaims(catchAllClaims.claims, catchAllIndex),
  claimsTruncated: catchAllClaims.claimsTruncated,
});
const verdicts = ['verified', 'contradicted', 'unknown'] as const;

function LocalDemo() {
  const [fixed, setFixed] = useState(false);
  const [showCatchAll, setShowCatchAll] = useState(false);
  const report = showCatchAll ? catchAllReport : fixed ? corrected : original;

  return (
    <main className="local-demo">
      <header>
        <p className="local-demo-context">Local demo · Bundled code fixtures</p>
        <h1>The Page Is Lying</h1>
        <p>Check a runbook against its code and follow each verdict to its source.</p>
        <p className="muted">The checker runs in this browser. For the live Forge and Rovo flow, use the Confluence setup.</p>
      </header>
      <section aria-labelledby="local-demo-title">
        <label className="local-demo-context">
          Runbook example{' '}
          <select value={showCatchAll ? 'catch-all' : 'payments'} onChange={(event) => setShowCatchAll(event.target.value === 'catch-all')}>
            <option value="payments">Outdated payments route</option>
            <option value="catch-all">Removed API behind a catch-all</option>
          </select>
        </label>
        <div className="local-demo-toolbar">
          <h2 id="local-demo-title">{showCatchAll ? 'Refunds runbook' : 'Payments runbook'}</h2>
          {!showCatchAll && (
            <button className="btn" type="button" onClick={() => setFixed(!fixed)}>
              {fixed ? 'Restore original runbook' : 'Apply route correction'}
            </button>
          )}
        </div>
        {showCatchAll ? (
          <p className="local-demo-change">The app has a frontend fallback and a refunds handler on the new path.</p>
        ) : (
          <p className="local-demo-change">
            {fixed ? 'Updated the route to ' : 'The runbook still says '}
            <code>{fixed ? 'POST /v2/payments' : 'POST /v1/charge'}</code>.
          </p>
        )}
        <ul className="counts" aria-label="Claims by status" aria-live="polite">
          {verdicts.map((verdict) => (
            <li key={verdict} className={`count count-${verdict}`}>
              <StatusIcon verdict={verdict} /> <strong>{report.counts[verdict]}</strong> {STATUS_LABEL[verdict]}
            </li>
          ))}
        </ul>
        <ol className="local-demo-results">
          {report.results.map(({ claim, verdict, statement, evidence }) => (
            <li key={claim.id}>
              <div className="local-demo-toolbar">
                <h3><code>{claim.raw}</code></h3>
                <span className={`count count-${verdict}`}><StatusIcon verdict={verdict} /> {STATUS_LABEL[verdict]}</span>
              </div>
              <p>{statement}</p>
              {evidence.map(({ id, file, line, snippet }) => file !== undefined && line !== undefined && (
                <p className="local-demo-evidence" key={id}>
                  <strong>{file}:{line}</strong> {snippet && <code>{snippet}</code>}
                </p>
              ))}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');
createRoot(root).render(<LocalDemo />);
