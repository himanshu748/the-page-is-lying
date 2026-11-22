import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { IndexKind } from '@core/model';
import { shortSha } from '@core/wording';
import type {
  IndexNowResponse,
  IndexStatus,
  SaveSettingsResponse,
  SettingsView,
} from '../../../../src/resolvers/contract';
import { invoke } from '../bridge';
import { COVERAGE_LABEL, KIND_LABEL, formatIndexTime } from '../status';
import { POLL_MS } from './common';

const KINDS: IndexKind[] = ['routes', 'env', 'cli', 'config', 'files', 'packages'];

/** Shown when a resolver call fails outright. The usual cause on a new install is that the admin has not yet allowed the app's access. */
export const ACCESS_HELP = (what: string): string =>
  `${what}. The app could not confirm that you are a Confluence administrator. This usually means access has not been allowed yet: reload this page, choose Allow access if asked, and try again. If it keeps failing, check the app's permissions under Manage apps.`;

/** Public demo repository. Its runbook page gives 2 verified, 3 contradicted and 1 claim with no evidence. */
export const DEMO_REPO_URL = 'https://github.com/himanshu748/payments-api-demo';
export const DEMO_REPO_REF = 'main';

/**
 * The demo repository's runbook. Each entry is the text before the claim, the claim (inline code on the page) and the
 * text after it. Against the demo repository it gives 2 verified, 3 contradicted and 1 with no evidence.
 */
export const SAMPLE_RUNBOOK: readonly (readonly [string, string, string])[] = [
  ['To take a payment, call ', 'POST /v1/charge', ' with the amount in cents.'],
  ['To look up a payment, call ', 'GET /v2/payments/{id}', '.'],
  ['Set ', 'STRIPE_KEY', ' before starting the service.'],
  ['Run ', 'npm run db:migrate', ' before each deploy.'],
  ['To force a refund, run ', 'payments refund <paymentId> --force', '.'],
  ['Reconcile with ', 'ledgerctl reconcile --since 24h', '.'],
];

type Message = { kind: 'ok' | 'error'; text: string } | null;

/** `intro` is the page opened after install: same settings, with the guide kept open once setup is done. */
export function SettingsPage({ intro = false }: { intro?: boolean } = {}) {
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [repoUrl, setRepoUrl] = useState('');
  const [ref, setRef] = useState('');
  const [hosts, setHosts] = useState('');
  const [project, setProject] = useState('');
  const [issueType, setIssueType] = useState('');
  const [token, setToken] = useState('');
  const [clearToken, setClearToken] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [status, setStatus] = useState<IndexStatus>({ state: 'none' });
  const [busy, setBusy] = useState(false);

  const apply = (value: SettingsView) => {
    setSettings(value);
    setRepoUrl(value.repoUrl);
    setRef(value.ref);
    setHosts(value.serviceHosts.join('\n'));
    setProject(value.jiraProjectId);
    setIssueType(value.jiraIssueTypeId);
    setToken('');
    setClearToken(false);
  };

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await invoke<IndexStatus>('getIndexStatus'));
    } catch {
      setStatus({ state: 'error', lastError: 'Status could not be read.' });
    }
  }, []);

  useEffect(() => {
    invoke<SettingsView | { error: string }>('getSettings')
      .then((value) => {
        if ('error' in value) setLoadError(true);
        else apply(value);
      })
      .catch(() => setLoadError(true));
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (status.state !== 'indexing') return;
    const timer = setTimeout(() => void refreshStatus(), POLL_MS);
    return () => clearTimeout(timer);
  }, [status, refreshStatus]);

  const save = async (event: FormEvent | null, demo = false) => {
    event?.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const response = await invoke<SaveSettingsResponse>('saveSettings', {
        repoUrl: demo ? DEMO_REPO_URL : repoUrl,
        ref: demo ? DEMO_REPO_REF : ref,
        serviceHosts: hosts.split(/[\s,]+/).filter((h) => h !== ''),
        jiraProjectId: project,
        jiraIssueTypeId: issueType,
        ...(token !== '' ? { token } : {}),
        ...(clearToken ? { clearToken: true } : {}),
      });
      if (response.ok) {
        apply(response.settings);
        setMessage({ kind: 'ok', text: demo ? 'Demo repository saved. Indexing started.' : 'Settings saved. Indexing started.' });
        void refreshStatus();
      } else {
        setMessage({ kind: 'error', text: response.message });
      }
    } catch {
      setMessage({ kind: 'error', text: ACCESS_HELP('Settings could not be saved') });
    } finally {
      setBusy(false);
    }
  };

  const indexNow = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await invoke<IndexNowResponse>('indexNow');
      if (response.ok) {
        setMessage({ kind: 'ok', text: 'Indexing started.' });
        setStatus({ state: 'indexing' });
      } else setMessage({ kind: 'error', text: response.message });
    } catch {
      setMessage({ kind: 'error', text: ACCESS_HELP('Indexing could not be started') });
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <p className="notice notice-error" role="alert" data-testid="view-runbook-settings">
        The settings could not be loaded.
      </p>
    );
  }

  return (
    <main className="view settings" data-testid="view-runbook-settings">
      <h1>{intro ? 'Get started with The Page Is Lying' : 'The Page Is Lying settings'}</h1>
      {settings !== null && <GetStarted intro={intro} repoSaved={settings.repoUrl !== ''} status={status} busy={busy} onUseDemo={() => void save(null, true)} />}
      <form onSubmit={(event) => void save(event)}>
        <div className="field">
          <label htmlFor="repo-url">Repository URL</label>
          <input id="repo-url" type="url" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="https://github.com/owner/repo" required />
        </div>
        <div className="field">
          <label htmlFor="repo-ref">Branch or tag (optional)</label>
          <input id="repo-ref" type="text" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Default branch" />
        </div>
        <div className="field">
          <label htmlFor="repo-token">GitHub token (optional, read-only)</label>
          <input
            id="repo-token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            aria-describedby="token-help"
            disabled={clearToken}
          />
          <span id="token-help" className="muted">
            {settings?.tokenSaved ? 'token saved' : 'No token saved'}. The token is write-only: it is never shown again.
          </span>
          {settings?.tokenSaved && (
            <label className="inline">
              <input type="checkbox" checked={clearToken} onChange={(e) => setClearToken(e.target.checked)} /> Remove the saved token when I save
            </label>
          )}
        </div>
        <div className="field">
          <label htmlFor="service-hosts">Service hosts (optional, one per line)</label>
          <textarea id="service-hosts" rows={3} value={hosts} onChange={(e) => setHosts(e.target.value)} aria-describedby="hosts-help" />
          <span id="hosts-help" className="muted">
            Endpoint claims on these hosts are checked against this repository. Claims on other hosts get no verdict.
          </span>
        </div>
        <fieldset>
          <legend>Jira create screen link (optional)</legend>
          <div className="field">
            <label htmlFor="jira-project">Project id</label>
            <input id="jira-project" type="text" inputMode="numeric" value={project} onChange={(e) => setProject(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="jira-issuetype">Issue type id</label>
            <input id="jira-issuetype" type="text" inputMode="numeric" value={issueType} onChange={(e) => setIssueType(e.target.value)} />
          </div>
        </fieldset>
        <div className="row">
          <button type="submit" className="btn" disabled={busy}>
            Save settings
          </button>
          <button type="button" className="btn" disabled={busy || settings?.repoUrl === ''} onClick={() => void indexNow()}>
            Index now
          </button>
        </div>
        <p role="status" className={message?.kind === 'error' ? 'notice notice-error' : 'muted'}>
          {message?.text ?? ''}
        </p>
      </form>

      <h2>Index status</h2>
      <IndexTable status={status} />
    </main>
  );
}

/** First-run guide. Stays visible, with each step marked done, until the first index is ready. */
function GetStarted({ intro, repoSaved, status, busy, onUseDemo }: { intro: boolean; repoSaved: boolean; status: IndexStatus; busy: boolean; onUseDemo: () => void }) {
  const indexed = status.state === 'ready';
  if (repoSaved && indexed) {
    return (
      <section className="start start-done" aria-labelledby="start-title" data-testid="get-started">
        <h2 id="start-title">You are set up</h2>
        <p>
          Open any page and choose <strong>Runbook check</strong> under the title, or add the <strong>Runbook check</strong> macro around a section. The space sidebar has <strong>Doc drift</strong>, which ranks the pages of a space by contradicted claims.
        </p>
        <SampleRunbook open={intro} />
      </section>
    );
  }
  const steps: { done: boolean; title: string; body: string }[] = [
    {
      done: repoSaved,
      title: 'Connect a repository',
      body: 'Enter a public GitHub or Bitbucket repository below, or use the demo repository to see a result in about a minute.',
    },
    {
      done: indexed,
      title: 'Wait for the first index',
      body:
        status.state === 'indexing'
          ? 'Indexing now. This page updates on its own.'
          : status.state === 'error'
            ? 'The last index run failed. See Index status below, then choose Index now.'
            : 'The app reads the repository once and stores routes, variables, commands, config keys, paths and package versions.',
    },
    {
      done: false,
      title: 'Check a page',
      body: 'Open a runbook page and choose Runbook check under the title. Each claim gets a verdict with file and line.',
    },
  ];
  return (
    <section className="start" aria-labelledby="start-title" data-testid="get-started">
      <h2 id="start-title">Get started</h2>
      <ol className="start-steps">
        {steps.map((step) => (
          <li key={step.title} className={step.done ? 'start-step start-step-done' : 'start-step'}>
            <strong>
              {step.title}
              {step.done && <span className="start-tick"> (done)</span>}
            </strong>
            <span>{step.body}</span>
          </li>
        ))}
      </ol>
      {!repoSaved && (
        <div className="row">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={onUseDemo}>
            Use the demo repository
          </button>
          <span className="muted">Saves {DEMO_REPO_URL.replace('https://', '')} ({DEMO_REPO_REF}) and starts indexing.</span>
        </div>
      )}
      <SampleRunbook open />
    </section>
  );
}

/** Six claims to paste inside the Runbook check macro. Copied as rich text so each claim stays inline code. */
function SampleRunbook({ open }: { open: boolean }) {
  const list = useRef<HTMLOListElement>(null);
  const [note, setNote] = useState('');
  const copy = () => {
    const node = list.current;
    const selection = window.getSelection();
    if (!node || !selection) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
    let copied: boolean;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
    // On failure the lines stay selected, so the keyboard shortcut still copies them.
    if (copied) selection.removeAllRanges();
    setNote(copied ? 'Copied. Paste it inside the Runbook check macro.' : 'The lines are selected. Press Ctrl+C or Cmd+C to copy them.');
  };
  return (
    <details className="sample" open={open} data-testid="sample-runbook">
      <summary>Sample runbook for the demo repository</summary>
      <p className="muted">
        On a new page, type <code>/Runbook check</code> to insert the macro and paste these six lines inside it. Expected with the demo repository: 2 verified, 3 contradicted, 1 with no evidence.
      </p>
      <ol ref={list} className="sample-lines">
        {SAMPLE_RUNBOOK.map(([before, claim, after]) => (
          <li key={claim}>
            {before}
            <code>{claim}</code>
            {after}
          </li>
        ))}
      </ol>
      <div className="row">
        <button type="button" className="btn" onClick={copy}>
          Copy sample runbook
        </button>
        {note !== '' && (
          <span className="muted" role="status">
            {note}
          </span>
        )}
      </div>
    </details>
  );
}

function IndexTable({ status }: { status: IndexStatus }) {
  if (status.state === 'none') return <p className="muted">No index yet. Save a repository, then choose Index now.</p>;
  const rows: [string, string][] = [
    ['State', status.state === 'indexing' ? 'Indexing' : status.state === 'ready' ? 'Ready' : 'Error'],
    ['Branch or tag', status.ref ?? ''],
    ['Commit', status.sha ? shortSha(status.sha) : ''],
    ['Indexed at', status.indexedAt ? formatIndexTime(status.indexedAt) : ''],
    ['Files indexed', status.filesIndexed === undefined ? '' : String(status.filesIndexed)],
    ['Files skipped', status.filesSkipped === undefined ? '' : String(status.filesSkipped)],
    ['Truncated', status.truncated === undefined ? '' : status.truncated ? 'Yes' : 'No'],
    ...(status.lastError ? ([['Last error', status.lastError]] as [string, string][]) : []),
    ...(status.coverage ? KINDS.map((k): [string, string] => [`Coverage: ${KIND_LABEL[k]}`, COVERAGE_LABEL[status.coverage?.[k] ?? 'none']]) : []),
  ];
  return (
    <table className="status-table" data-testid="index-status">
      <caption className="sr-only">Index status</caption>
      <tbody>
        {rows
          .filter(([, value]) => value !== '')
          .map(([label, value]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>{value}</td>
            </tr>
          ))}
      </tbody>
    </table>
  );
}
