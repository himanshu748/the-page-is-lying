# Live verification results (demo site)

Date: 2026-11-16. Branch `feat/integration`. Development version 2.2.0 on `https://one-atlas-obka.atlassian.net` for attempts 1 and 2; 3.0.0 from attempt 3 (see the end of this file).

Attempt 1 (commit ff34b51) could not run any browser step: the preview browser was not signed in. Attempt 2 (this file) runs with the user signed in to the preview browser's default profile.

## Evidence so far (attempt 2)

| Step | Result | Evidence |
|---|---|---|
| A1 signed in | pass | Page 6815745 opened without a login redirect |
| A2 settings page opens | pass, path differs | The app has no link in the Confluence admin sidebar (expected: `useAsConfig: true` hides it). The page is reached from admin.atlassian.com > Apps > Sites > one-atlas-obka > Connected apps > The Page Is Lying > "..." > Configure, which opens `https://one-atlas-obka.atlassian.net/wiki/admin/forge/apps/49ffa6f4-93eb-41fb-8f2a-6a087aac4ac0/0c74f1a8-63ff-4d71-a7f4-8a956c65c6dd/runbook-settings`. Title "The Page Is Lying (Development)", form with Repository URL, Branch or tag, GitHub token ("No token saved. The token is write-only: it is never shown again."), Service hosts, Jira ids, Save settings, Index now (disabled), Index status "No index yet. Save a repository, then choose Index now." Screenshot: `docs/screenshots/settings-page.png` |
| A3 save settings | pending | First try: the preview automation refused to type into the settings form because it sits in a cross-site Forge iframe and the preview did not have focus ("The page's focus is inside a cross-site frame, which takes typed input only while the preview has focus"). Clicks inside the iframe work |
| B6 macro renders | pass (no-repo state) | Page 6815745 shows the "Runbook check (Development)" byline item and the bodied macro with the six claim paragraphs and the notice "No repository is configured. A Confluence administrator can set one in the app settings." |
| C13 agent visible | pass | Rovo agent picker search "Runbook" lists "Runbook checker". Agent card: "Answers "is this page still true?" from read-only code checks, citing file and line." Conversation starters shown: "Can I still call POST /v1/charge?", "Is this page still true?", "Which claims on this page are contradicted by code?" |
| C15 (no repo yet) | pass for honesty | Asked "Is this page still true?" with no repository saved. Answer: "The check failed because no repository index is available yet. You need to configure a repository in the app settings and wait for indexing to complete. No verdict was produced." No guess, no verdict words. Screenshot: `docs/screenshots/rovo-no-repo-answer.png` |
| C16 `page_read` status | **pass: 200** | `forge logs -e development`: `{"evt":"check-page","pageId":"6815745","source":"context"}` then `{"evt":"page_read","pageId":"6815745","status":200}` (2026-11-16T07:00:34Z). `asUser()` works inside Rovo actions; the fallback in `docs/agent-eval.md` section 4 is not needed |
| C18 LotZero on agent card | pass (not shown) | Agent card shows only name, icon and description |
| D19 enable MCP tools | pass | Connected apps > The Page Is Lying > Details: "TOOLS: Expose tools to MCP-compatible apps: Disabled" > Enable tools > confirm dialog "Enabling this will allow MCP-compatible apps to use this app's tools" > Enable. Now "Enabled". The control is a single on/off switch for all tools, not per-tool checkboxes |
| C18 LotZero on Connected apps | note | The Page Is Lying row shows "DEV", installed by Admin, Vendor "Not available" (sharing disabled), no developer space name. A separate app "LotZero-Judge" (Admin) is installed on this same site |
| C18 LotZero on OAuth consent | pass (not shown) | `auth.atlassian.com/consent`: "MCP Inspector is requesting access to The Page Is Lying", site "One-atlas-obka", permissions "The Page Is Lying will have these permissions on your behalf in Atlassian products: Read, Write, and Search". No developer space name. Screenshot: `docs/screenshots/mcp-oauth-consent.png`. Note: "Read, Write, and Search" and the requested scopes (including `write:page:confluence`, `write:jira-work`) come from Atlassian's MCP gateway client registration, not from this app's manifest (which has only `storage:app` and `read:page:confluence`). Worth one sentence in the Devpost write-up so judges are not surprised |
| D20 connect a client | pass | MCP Inspector v2.15.0 (`npx @modelcontextprotocol/inspector`), Streamable HTTP to `https://mcp.atlassian.com/forge/49ffa6f4-93eb-41fb-8f2a-6a087aac4ac0`. OAuth via dynamic client registration, consent accepted, "Connected", protocol "MCP 2025-03-26". `tools/list` returns `check-claim_development` and `check-page_development`, both tagged READ-ONLY and IDEMPOTENT. Tool names carry the `_development` environment suffix |
| D22 / row 17 off-host URL | pass | `check-claim_development` with claim `POST /v1/charge`, page `https://evil.example.com/wiki/spaces/A/pages/1/T`: `{"schema":"pil.agent.error.v1","error":"invalid_input","message":"The input was not valid, so nothing was checked. No verdict was produced.","detail":"page_host_not_allowed"}`. No `page_read` line in the logs |
| Row 14 missing page (MCP) | pass | `check-page_development` page `99999999`: `{"error":"page_not_found","message":"The page was not found or is not visible to the current user. No verdict was produced."}`. Logs: `check-page ... "source":"input"`, `page_read ... "status":404` |
| MCP `asUser()` | pass | `check-page_development` page `6815745`: logs `"source":"input"` then `page_read` status 200; result `index_missing` (expected until settings are saved) |
| MCP with no page | note | `check-page_development` with an empty page field: `invalid_input`, detail `page_missing`. Correct: an MCP client has no page context |

## Blocker: the settings form cannot be filled from the preview automation

Every step from A3 on needs a saved repository and an index. The settings form is Custom UI inside a cross-site Forge iframe (`*.cdn.prod.atlassian-dev.net`). The preview automation can click inside it (Save settings responded) but refuses keyboard input there while the preview panel is not focused in the T3 window: `keyboard.insertText: Protocol error (Input.insertText): The page's focus is inside a cross-site frame, which takes typed input only while the preview has focus.` Same error for `press`. Retried in a fresh tab on 2026-11-16 07:3x UTC with the same result. Later in the run, typing also stopped working in top-frame inputs (Rovo agent search, chat box: "type requires an editable target"; `element.focus()` did not hold), which points to the preview window losing focus rather than to the app. No app defect was found, so no code was changed and nothing was redeployed.

There is no CLI or REST path to write the app's Forge storage, and adding a backdoor to the app for this was ruled out.

## Steps not run yet (need the settings saved first)

| Step | Result | Reason |
|---|---|---|
| A3 save settings, A4 Index now, A5 index logs | not run | blocker above. The admin-check risk (`user/current?expand=operations` needing `read:confluence-user`) is still unverified |
| B7 to B12 counts, cards, permalink, byline, keyboard, Jira draft | not run | macro shows "No repository is configured" until A3 |
| C14, C15 cited answers, "Ask Runbook checker" button | not run | action returns `index_missing` until A4 |
| C17 red-team rows 1 to 6, 8 to 13 in Rovo | not run | need the index (rows 10 and 11 were attempted but the chat input stopped accepting text) |
| D21 MCP cited answers | not run | the MCP connection works (above); answers need the index |
| E23 to E26 fix page, green, restore | not run | page 6815745 was not edited; it is still version 1 (broken) |
| F27, F28 | not run | |

## What the user has to do (about 1 minute)

1. In any browser where you are signed in, open `https://one-atlas-obka.atlassian.net/wiki/admin/forge/apps/49ffa6f4-93eb-41fb-8f2a-6a087aac4ac0/0c74f1a8-63ff-4d71-a7f4-8a956c65c6dd/runbook-settings`.
2. Repository URL `https://github.com/himanshu748/payments-api`, Branch or tag `main`, token empty. Click **Save settings**, then **Index now**. Note any message shown (especially "Only a Confluence administrator can change these settings").
3. Tell the orchestrator; the rest of the checklist can then be re-run by the agent. Alternatively keep the T3 preview panel visible and focused while the agent runs, so typing reaches the iframe.

## Tabs and processes

All tabs this run opened were closed. One unclaimed tab (`tab_7`, the settings page, opened by Confluence's "Configure" link as a new window) could not be closed by the agent: "Only the agent session that opened this tab can close it." The MCP Inspector process was stopped.

## Attempt 3: settings save bug fixed (version 3.0.0)

### The bug

The user entered the repository on the settings page and clicked Save settings and Index now; nothing was saved. `forge logs -e development --since 3h` showed one error per click and nothing else:

```
ERROR 2026-11-16T16:36:50.416Z 9541f650-35df-45d7-8617-12d77afad958 [NEEDS_AUTHENTICATION_ERR: Authentication Required] { status: 401, serviceKey: 'atlassian-token-service-key', options: undefined }
```

The same error appears at 16:37:19 (747a23b2), 16:37:28 (d1c489f6) and 16:37:58 (0d6aa3e2).

### Root cause

`saveSettings` and `indexNow` both call `backend.isAdmin()` before anything else, and that is the only user-token call in those resolvers. `isAdmin` (`src/resolvers/defaultBackend.ts`) calls `asUser().requestConfluence('/wiki/rest/api/user/current?expand=operations')`. The Confluence v1 REST reference lists the OAuth scope for "Get current user" as `read:confluence-user` (https://developer.atlassian.com/cloud/confluence/rest/v1/api-group-users/, field `x-atlassian-oauth2-scopes`). The manifest had only `storage:app` and `read:page:confluence`, so the Forge token service could not issue a user token for the call, and `@forge/api` threw `NeedsAuthenticationError` (in `fetch.js` the proxy header `forge-proxy-error: NEEDS_AUTHENTICATION_ERR` becomes `new NeedsAuthenticationError('Authentication Required', 'atlassian-token-service-key')`). Page reads as the user kept working (C16, MCP) because `read:page:confluence` covers them. The error was not swallowed in the resolver (there is no try/catch around `isAdmin`); the UI's generic catch showed "Settings could not be saved. Try again."

### Fix (commit 91144c7)

- `manifest.yml`: add `read:confluence-user` (read-only; no write scope, no egress change). Major version 3.0.0.
- `static/ui/src/views/SettingsPage.tsx`: when the Save or Index now call fails outright, the page now says what failed and the usual reason ("... The app could not confirm that you are a Confluence administrator. This usually means access has not been allowed yet: reload this page, choose Allow access if asked, and try again. ...") instead of "Try again".
- The admin rule is unchanged: only from the settings module, only a user whose `operations` include `administer` on `application`.
- Tests: `test/resolvers/defaultBackend.test.ts` (admin true; non-admin, refused response and missing account id false; `NeedsAuthenticationError` propagates), `test/resolvers/ui.test.ts` (a failing admin check rejects `saveSettings` and `indexNow` so Forge sees the error), e2e scenario `settings=auth-error` (the message is shown for Save and Index now), manifest contract test updated to the three scopes.

### Gates and deploy

| Gate | Exit |
|---|---|
| `npm run typecheck`, `npm run lint`, `npm test` (673 passed, 1 skipped), `npm run build:ui`, `npm run test:e2e` (49 passed) | 0 |
| `forge lint` | 0 (0 errors, 1 approval: MAJOR_VERSION_RULE, scope change) |
| `forge deploy -e development --non-interactive` | 1 without `--approve MAJOR_VERSION_RULE`; 0 with it. Deployed 3.0.0 |
| `forge install --upgrade -e development -p Confluence --site one-atlas-obka.atlassian.net --non-interactive --confirm-scopes` | 0. "Your app will be upgraded with the following additional scopes: - read:confluence-user ... Upgrade complete!" `forge install list`: version 3, Up-to-date |

The CLI upgrade with `--confirm-scopes` accepted the new scope for the site, so no separate "update needs approval" step was left for the site admin. Whether a per-user "Allow access" prompt appears on the first Save has not been observed yet (see below). `forge eligibility`: not eligible for Runs on Atlassian because "App is egressing data" (GitHub egress, not changed by this fix).

### Step 2 (save settings in the preview) and step 3

| Step | Result | Evidence |
|---|---|---|
| A2 settings page opens (3.0.0) | pass | Fresh tab, profile default: title "The Page Is Lying (Development)", the Forge iframe loads. `preview_snapshot` timed out (15 s) three times; the preview reported `visible: false` |
| A3 save settings | not run (blocked) | A click on `#repo-url` inside the iframe succeeded. `type` timed out after 15 s; `press` failed with "keyboard.press: Protocol error (Input.dispatchKeyEvent): The page's focus is inside a cross-site frame, which takes typed input only while the preview has focus. Click the field first." Stopped as instructed. Paste was not tried because it is also a key event |
| A4 to F28 | not run | need A3 |

No consent prompt was seen because Save was never clicked with a repository entered. The fix is covered by unit and e2e tests and is deployed, but it is not yet verified live. Page 6815745 was not edited (still the broken version). The tab this run opened was closed. No screenshots were taken in this attempt.

### What the user has to do

Either keep the T3 preview panel visible and focused while the agent runs Step 2, or do it by hand (about 1 minute): open the settings URL above, Repository URL `https://github.com/himanshu748/payments-api`, branch `main`, no token, **Save settings**. If an "Allow access" prompt appears, accept it and note its wording. Then **Index now** and wait for commit, file count and coverage. `forge logs -e development --since 10m` should then show no `NEEDS_AUTHENTICATION_ERR`.

## Attempt 4: index confirmed, remaining steps blocked (2026-11-16)

| Step | Result | Evidence |
|---|---|---|
| A3 save settings (by the user) | pass | No new `NEEDS_AUTHENTICATION_ERR` after the 3.0.0 upgrade. `forge logs -e development --since 3h` shows only the four pre-fix errors (16:36 to 16:37 UTC) |
| A4 index finished | pass (indirect) | The macro on page 6815745 shows `himanshu748/payments-api@0383355` and counts 2 Verified, 3 Contradicted, 1 No evidence. The settings page could not be read: `preview_snapshot` timed out (15 s) on the Forge iframe while the preview was hidden. File count and coverage were not read. "Allow access" prompt: not seen |
| A5 no `index-repo-fn` errors | pass | `forge logs` shows no error lines after 16:37:58 |
| B6, B7 macro and counts | pass | Header "2 Verified, 3 Contradicted, 1 No evidence". Rows: POST /v1/charge CONTRADICTED, GET /v2/payments/{id} VERIFIED, STRIPE_KEY CONTRADICTED, npm run db:migrate VERIFIED, payments refund ... --force CONTRADICTED, ledgerctl reconcile --since 24h NO EVIDENCE. Icons, labels and underlines present. Screenshot: `docs/screenshots/page-counts-2-3-1.png` |
| B8, B9 card with `src/routes.ts:88`, permalink | not run | Hover and click on the claim sent no card while the preview was hidden (the card lives in the Forge iframe). Per-claim citations are therefore unverified live |
| B10 byline popup | not run | Byline item reads "Runbook check (Development)"; no counts in the title and no popup was opened (click did not respond while hidden) |
| C14, C15 Rovo answers | not run | Click on "Ask Runbook checker" opened no Rovo panel while the preview was hidden. Typing is also unavailable |
| D21 MCP Inspector | not run | Not started this attempt |
| E23 to E26 fix and restore | not run | The REST token file `/Users/himanshujha/.t3/userdata/secrets/files/9ce46991ea1b986b704076d56e966e1f` does not exist (the `files` directory is empty). Page 6815745 was not edited; it is still version 1 (broken) |
| F red-team rows | not run | Need Rovo or MCP and, for the injection rows, the REST token |

No app defect was found, so no code changed and nothing was redeployed. No gates were run. The tab opened this attempt was closed.

### What the user has to do

1. Re-provide the Atlassian API token (the secret file is gone) or keep the T3 preview panel visible and focused so card hover, Rovo and iframe typing work.
2. Then the remaining steps (B8 to B10, C14 to C15, D21, E, F) can be run.
