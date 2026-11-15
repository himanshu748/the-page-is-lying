import Resolver from '@forge/resolver';
import { getBackend } from './backend';
import type { StoredSettings } from './backend';
import type {
  CheckBodyPayload,
  CheckPagePayload,
  CheckResponse,
  IndexNowResponse,
  IndexStatus,
  JiraTarget,
  SaveSettingsPayload,
  SaveSettingsResponse,
  SettingsView,
} from './contract';
import {
  adfWithinLimit,
  isNumericId,
  validateHosts,
  validateJiraId,
  validateRef,
  validateRepoUrl,
  validateToken,
} from './validate';

/**
 * UI resolver shared by the macro, byline popup and settings page (PLAN.md sections 5.1 to 5.3).
 * Settings resolvers accept calls only from the settings module; writes also need a Confluence admin.
 */
export const SETTINGS_MODULE_KEY = 'runbook-settings';

interface Ctx {
  moduleKey?: unknown;
  accountId?: unknown;
  extension?: { moduleKey?: unknown };
}

export function moduleKeyOf(context: Ctx): string {
  const key = context.moduleKey ?? context.extension?.moduleKey;
  return typeof key === 'string' ? key : '';
}

const accountIdOf = (context: Ctx): string | undefined =>
  typeof context.accountId === 'string' ? context.accountId : undefined;

const fromSettingsModule = (context: Ctx): boolean => moduleKeyOf(context).endsWith(SETTINGS_MODULE_KEY);

function toView(settings: StoredSettings, tokenSaved: boolean): SettingsView {
  return { ...settings, tokenSaved };
}

const resolver = new Resolver();

resolver.define('checkBody', async ({ payload, context }): Promise<CheckResponse> => {
  const input = (payload ?? {}) as Partial<CheckBodyPayload>;
  if (!adfWithinLimit(input.adf)) {
    return { state: 'error', message: 'The macro body is too large to check (limit 400 KB).' };
  }
  void context;
  const config = input.config ?? {};
  const repoUrl = config.repoUrl ? validateRepoUrl(config.repoUrl) : undefined;
  if (repoUrl && !repoUrl.ok) return { state: 'error', message: `Macro repository override: ${repoUrl.message}` };
  const ref = validateRef(config.ref);
  if (!ref.ok) return { state: 'error', message: `Macro branch override: ${ref.message}` };
  const backend = await getBackend();
  try {
    return await backend.checkDocument({
      adf: input.adf,
      ...(repoUrl ? { repoUrl: repoUrl.value } : {}),
      ...(ref.value ? { ref: ref.value } : {}),
      ...(isNumericId(input.contentId) ? { contentId: input.contentId } : {}),
    });
  } catch {
    return { state: 'error', message: 'The check failed. Try again in a minute.' };
  }
});

resolver.define('checkPage', async ({ payload }): Promise<CheckResponse> => {
  const input = (payload ?? {}) as Partial<CheckPagePayload>;
  if (!isNumericId(input.contentId)) return { state: 'error', message: 'Missing or invalid page id.' };
  const backend = await getBackend();
  try {
    const page = await backend.readPage(input.contentId);
    if (!page) return { state: 'error', message: 'The page was not found or you cannot view it.' };
    if (!adfWithinLimit(page.adf)) return { state: 'error', message: 'The page is too large to check (limit 400 KB).' };
    const outcome = await backend.checkDocument({ adf: page.adf, contentId: page.id });
    if (outcome.state === 'ready') {
      await backend.saveCounts(page.id, page.version, outcome.report.counts);
      return { ...outcome, page: { id: page.id, title: page.title, version: page.version } };
    }
    return outcome;
  } catch {
    return { state: 'error', message: 'The check failed. Try again in a minute.' };
  }
});

resolver.define('getSettings', async ({ context }): Promise<SettingsView | { error: 'forbidden' }> => {
  if (!fromSettingsModule(context)) return { error: 'forbidden' };
  const backend = await getBackend();
  return toView(await backend.loadSettings(), await backend.hasToken());
});

resolver.define('saveSettings', async ({ payload, context }): Promise<SaveSettingsResponse> => {
  if (!fromSettingsModule(context)) {
    return { ok: false, error: 'forbidden', message: 'Settings can only be changed from the settings page.' };
  }
  const backend = await getBackend();
  if (!(await backend.isAdmin(accountIdOf(context)))) {
    return { ok: false, error: 'forbidden', message: 'Only a Confluence administrator can change these settings.' };
  }
  const input = (payload ?? {}) as Partial<SaveSettingsPayload>;
  const repoUrl = validateRepoUrl(input.repoUrl);
  if (!repoUrl.ok) return { ok: false, error: 'invalid', message: repoUrl.message };
  const ref = validateRef(input.ref);
  if (!ref.ok) return { ok: false, error: 'invalid', message: ref.message };
  const hosts = validateHosts(input.serviceHosts);
  if (!hosts.ok) return { ok: false, error: 'invalid', message: hosts.message };
  const project = validateJiraId(input.jiraProjectId, 'Jira project id');
  if (!project.ok) return { ok: false, error: 'invalid', message: project.message };
  const issueType = validateJiraId(input.jiraIssueTypeId, 'Jira issue type id');
  if (!issueType.ok) return { ok: false, error: 'invalid', message: issueType.message };
  if ((project.value === '') !== (issueType.value === '')) {
    return { ok: false, error: 'invalid', message: 'Set both the Jira project id and issue type id, or neither.' };
  }
  let token: { set?: string; clear?: boolean } = {};
  if (input.clearToken === true) token = { clear: true };
  else if (input.token !== undefined && input.token !== '') {
    const checked = validateToken(input.token);
    if (!checked.ok) return { ok: false, error: 'invalid', message: checked.message };
    token = { set: checked.value };
  }
  const settings: StoredSettings = {
    repoUrl: repoUrl.value,
    ref: ref.value,
    serviceHosts: hosts.value,
    jiraProjectId: project.value,
    jiraIssueTypeId: issueType.value,
  };
  await backend.saveSettings(settings, token);
  await backend.enqueueIndex();
  return { ok: true, settings: toView(settings, await backend.hasToken()) };
});

resolver.define('getIndexStatus', async ({ context }): Promise<IndexStatus> => {
  if (!fromSettingsModule(context)) return { state: 'error', lastError: 'forbidden' };
  return (await getBackend()).getIndexStatus();
});

resolver.define('indexNow', async ({ context }): Promise<IndexNowResponse> => {
  if (!fromSettingsModule(context)) {
    return { ok: false, error: 'forbidden', message: 'Indexing can only be started from the settings page.' };
  }
  const backend = await getBackend();
  if (!(await backend.isAdmin(accountIdOf(context)))) {
    return { ok: false, error: 'forbidden', message: 'Only a Confluence administrator can start indexing.' };
  }
  const settings = await backend.loadSettings();
  if (settings.repoUrl === '') return { ok: false, error: 'invalid', message: 'Save a repository URL first.' };
  await backend.enqueueIndex();
  return { ok: true };
});

/** Non-sensitive: lets the Jira draft modal know whether it can offer the create-screen link. */
resolver.define('getJiraTarget', async (): Promise<JiraTarget | null> => {
  const settings = await (await getBackend()).loadSettings();
  if (settings.jiraProjectId === '' || settings.jiraIssueTypeId === '') return null;
  return { projectId: settings.jiraProjectId, issueTypeId: settings.jiraIssueTypeId };
});

export const handler = resolver.getDefinitions();
