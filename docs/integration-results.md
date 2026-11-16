# Live verification results (demo site)

Date: 2026-11-16. Branch `feat/integration`. Development version 2.2.0 on `https://one-atlas-obka.atlassian.net`.

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
