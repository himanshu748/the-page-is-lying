import { useEffect, useState } from 'react';
import { view } from './bridge';

type ModuleKey = 'runbook-check' | 'runbook-byline' | 'runbook-settings';

const TITLES: Record<ModuleKey, string> = {
  'runbook-check': 'Runbook check',
  'runbook-byline': 'Runbook check (page)',
  'runbook-settings': 'The Page Is Lying settings',
};

function isModuleKey(value: string): value is ModuleKey {
  return value in TITLES;
}

/**
 * Routes by context.extension.moduleKey. Task D replaces each placeholder view.
 * Placeholder copy only; no verdicts are shown by the scaffold.
 */
export function App() {
  const [moduleKey, setModuleKey] = useState<string | null>(null);

  useEffect(() => {
    void view.getContext().then((context) => {
      setModuleKey(String((context as { moduleKey?: string }).moduleKey ?? ''));
    });
  }, []);

  if (moduleKey === null) return <p role="status">Loading...</p>;
  if (!isModuleKey(moduleKey)) return <p role="alert">Unknown module: {moduleKey}</p>;

  return (
    <main data-testid={`view-${moduleKey}`}>
      <h1>{TITLES[moduleKey]}</h1>
      <p>Scaffold placeholder. No checks have run.</p>
    </main>
  );
}
