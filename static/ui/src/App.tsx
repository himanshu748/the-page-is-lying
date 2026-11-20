import { useEffect, useState } from 'react';
import { view } from './bridge';
import { BylinePopup } from './views/BylinePopup';
import { DriftView } from './views/DriftView';
import { MacroView } from './views/MacroView';
import { SettingsPage } from './views/SettingsPage';

/** Routes by context.extension.moduleKey. The theme is enabled first so Atlassian design tokens resolve. */
export function App() {
  const [moduleKey, setModuleKey] = useState<string | null>(null);

  useEffect(() => {
    void Promise.resolve(view.theme.enable()).catch(() => undefined);
    void view.getContext().then((context) => {
      const typed = context as { moduleKey?: unknown; extension?: { moduleKey?: unknown } };
      setModuleKey(String(typed.moduleKey ?? typed.extension?.moduleKey ?? ''));
    });
  }, []);

  if (moduleKey === null) return <p role="status" className="notice">Loading…</p>;
  // Forge module keys can be suffixed with the app and environment, so match on the end.
  if (moduleKey.endsWith('runbook-check')) return <MacroView />;
  if (moduleKey.endsWith('runbook-byline')) return <BylinePopup />;
  if (moduleKey.endsWith('runbook-settings')) return <SettingsPage />;
  if (moduleKey.endsWith('runbook-drift')) return <DriftView />;
  return <p role="alert" className="notice notice-error">Unknown module: {moduleKey}</p>;
}
