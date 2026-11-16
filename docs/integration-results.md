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
