# Developer space notes

The app is registered under the account's only Forge developer space, **LotZero** (id `18159bee-5fcb-492f-ac1e-63ebe97c5b16`, from `forge developer-spaces list`). LotZero is also the name of your other Codegeist entry (food recall rehearsal, Specialized Industries). The two entries must stay clearly separate, so check where the space name is visible. Nothing was created, moved or re-registered.

App id for this entry: `49ffa6f4-93eb-41fb-8f2a-6a087aac4ac0`.

## What is confirmed

| Question | Answer | Source |
|---|---|---|
| Can a new developer space be created? | Yes. Anyone with an Atlassian account can: Developer Console, space switcher at top left, "Create Developer Space", enter a name (letters, numbers, spaces, dashes, underscores; not case-sensitive), confirm. The creator is space admin and billing admin for a new space. The CLI can also create one during `forge create` or `forge register`. `forge developer-spaces` has only `list` in CLI 15 (checked here), so there is no `create` subcommand. A space can be deleted only when no app is assigned to it. | https://developer.atlassian.com/platform/forge/developer-space/create-developer-space/ |
| Can an existing app move to another space? | Yes, for a private app: Developer Console, source space, app overflow menu, **Transfer app**, pick the destination. You need the Admin role in both spaces. Not available on the first two days of a month or while invoices are pending. Forge charges move to the destination space. If you cannot be admin of the destination, a support ticket with approval from a destination admin is needed. Marketplace apps follow a separate partner-transfer process. | https://developer.atlassian.com/platform/forge/developer-space/developer-space-apps/ |
| Does `forge register` do the same? | No. `forge register [-s <space id>]` creates a **new app id**. The old registration stays, but the new app is disconnected from the old app's environments, variables, secrets and storage. Going back means putting the old app id in `manifest.yml`. | https://developer.atlassian.com/platform/forge/cli-reference/register/ and community answers such as https://community.developer.atlassian.com/t/forge-deployment-failed-with-unknown-error/84844/2 |
| Is the space name public? | On the Marketplace, yes: publishing a space makes its name and contact email public and creates the vendor profile, and a published space cannot be unpublished. The vendor of a listing is the space the app is assigned to. | https://developer.atlassian.com/platform/forge/developer-space/publish-developer-space/ |

## What is unclear

- Whether a **transfer** keeps the app id, the installations, storage and the MCP URL. The docs describe moving the app and its billing but say nothing either way about the id. Test with a throwaway app before moving this one.
- Whether the developer space name appears on the Rovo agent card, the Connected apps page, or the OAuth consent screen for the MCP server. No doc found. The browser checklist asks you to record this (checklist step 18), so you will know before the demo.

## Options

| Option | What changes | Effect on this app | Recommendation |
|---|---|---|---|
| A. Keep LotZero for both entries | Nothing | No work. Risk: both entries show the same space name wherever the name is shown, which weakens the "substantially different" separation. | Acceptable only if checklist step 18 shows the name is not visible to judges or viewers. |
| B. Create a new space, then **transfer** this app into it | A new space (Console), Transfer app (needs admin in both, not on days 1 to 2 of a month). Billing moves with the app. | If the app id is preserved (unclear), nothing else changes: MCP URL, installs, storage and docs stay. If the app id changes, see option C. | **Preferred.** Do it before production deploy and before recording the demo. Verify with a throwaway app first, or read `forge install list` and `manifest.yml` id after the move. |
| C. Create a new space and **re-register** the app (`forge register -s <new space id>`) | New app id (the `app.id` in `manifest.yml`), new environments, no variables, secrets or storage, and no installs. | MCP URL changes (`https://mcp.atlassian.com/forge/<new app id>`), so README, docs/agent-eval.md, docs/integration-checklist.md, docs/demo-script.md and the Devpost text must be updated. The development install must be redone, the demo site pages reseeded (the macro extension key contains the app id and environment id, see `demo/confluence/SEEDING.md`), and settings re-entered. The old app (still registered under LotZero) would need deleting or leaving unused. | Only if transfer is not possible. About half a day of work and a repeat of the browser checklist. |

## If the id changes: what to update

1. `manifest.yml` `app.id` (the CLI writes it on register).
2. MCP URL in README.md, docs/agent-eval.md, docs/integration-checklist.md and docs/demo-script.md.
3. Extension key in `demo/confluence/*.adf.json` (`<app id>/<environment id>/static/runbook-check`) and the seeded page body.
4. `forge deploy -e development`, `forge install -e development -p Confluence --demo-site --confirm-scopes --non-interactive`, settings and "Index now".
5. Re-run the browser checklist and re-record anything that shows the old URL.

## Transfer test (2026-11-16)

Nothing was done to the real app (`49ffa6f4-93eb-41fb-8f2a-6a087aac4ac0`). The test used a throwaway app, since deleted.

### New space

- Name: **The Page Is Lying**, id `718977a5-b87e-4268-b75a-8ba3a329d31d`.
- Created in the Developer Console: space switcher (top left), "Create a Developer Space", typed the name, Create. The name was accepted. It appeared in `forge developer-spaces list` within seconds.
- Role: Admin (the creator is admin). The Transfer dialog lists only spaces where you are Admin, and the new space was offered, which confirms it.
- `forge developer-spaces list` before: only LotZero (`18159bee-5fcb-492f-ac1e-63ebe97c5b16`). After: LotZero and The Page Is Lying.

### Throwaway: `pil-transfer-test`

Created in `/tmp` with `forge create pil-transfer-test -t confluence-macro-ui-kit -d app -s 18159bee-5fcb-492f-ac1e-63ebe97c5b16 -y`, deployed with `forge deploy -e development --non-interactive`, and installed with `forge install -e development -p Confluence -s one-atlas-obka.atlassian.net --confirm-scopes --non-interactive`.

| | Before (LotZero) | After (The Page Is Lying) |
|---|---|---|
| App id | `61da0c7b-28ba-4f4c-8881-aa374c4607e6` | same |
| `app.id` in manifest | `ari:cloud:ecosystem::app/61da0c7b-...` | unchanged, no edit needed |
| production env | `7f76aac9-1a33-430b-9252-4763d99b57b8` | same |
| staging env | `26f47696-0a21-4569-808c-ff88bcfa34d1` | same |
| development env | `9077bf03-2040-41c5-b076-69a6d109ed1e` | same |
| Installation | `312463e8-dcab-4267-b218-7ac6af0c9653`, development, Confluence on one-atlas-obka.atlassian.net, v2, Up-to-date | same id, still listed |
| Console URL | `/console/myapps/61da0c7b-.../overview`, breadcrumb "LotZero" | same URL, breadcrumb "The Page Is Lying" |

### Transfer screens

1. Developer Console, LotZero space home (`/console/developer-space/<LotZero id>`), row of the app, "More actions" (three dots) shows one item: **Transfer app**. The overflow menu is only on the space home page. The all-apps page (`/console/myapps/`) has no menu, and the app's Settings page has no Transfer option (only Delete app).
2. "Transfer details" full-page dialog. Shows the selected app and its current space, a "Forge usage and charges" panel with a "View usage and charges" link (after the transfer the destination space is responsible for future chargeable Forge usage), and "Destination Developer Space details". The note says only spaces where you are Admin are listed, and the destination pays for future usage.
3. Dropdown "Select destination Developer Space" lists `The Page Is Lying - 718977a5-...`. Select it, then click **Transfer app**.
4. Banner "Transfer in progress. Keep this dialog open, dismiss is disabled until it finishes." It finished in about 20 seconds. No confirmation checkbox, no email prompt, no typed-name check. The LotZero list then showed 3 apps instead of 4.

### Checks after the transfer

- App id in console, manifest and CLI: unchanged.
- `forge environments list`: same three ids and the same last-deployed times.
- `forge install list`: the install is still there, same id, "Up-to-date".
- `forge deploy -e development --non-interactive` worked with no re-register and no prompt (version 2.0.0 to 2.1.0). The manifest was untouched.
- Developer Console overview: app id, "Your role: Admin", contributors (1), distribution ("Not sharing"), install count (1) and log sharing all unchanged.
- Not tested: Forge storage (KVS), because the template does not use it, and billing details (no payment method is attached to either space). Atlassian says usage and charges move with the app. Environment variables and secrets were not set. Because the app id and environments are unchanged, storage, variables and secrets are expected to stay with the app, but this was not exercised.

### Visibility of the space name on the site

Checked after the transfer, on a development install of an unshared app. The Confluence/Jira "Manage apps" URL (`/plugins/servlet/upm`) now only redirects to Administration. In Administration, Connected apps (admin.atlassian.com, site one-atlas-obka), the list row shows the app name with a DEV badge, edition "-", "Installed by: Admin", "1 connection". The app details page shows: Installed by (user name and email), install date, method Manual, environment Development, and **Vendor: Not available**, **Support: Not available**, plus "Enable app sharing to see all details". The developer space name does not appear anywhere. The install flow was done from the CLI, which shows no space name either. Not checked: the browser install screen for a shared or Marketplace app, and the Rovo agent card or the MCP OAuth consent screen. A shared app may show a vendor name on those pages, so repeat step 18 of the checklist if the app is ever shared.

### Cleanup

The throwaway was uninstalled with `forge uninstall -i 312463e8-... -e development` (`forge install list` then showed no installs), deleted in the Developer Console (Settings, Delete app, Delete), and `/tmp/pil-test` was removed. The console list shows 3 apps again. One extra Atlassian Administration tab opened when I clicked "Take me there" and could not be closed by this agent (tab id `tab_8_3e79fc9a-99f7-41cc-8a7e-14f96d4c6fe8`).

### Moving the real app

Verdict: a transfer keeps the app id, environment ids, installations and the manifest, so the MCP URL `https://mcp.atlassian.com/forge/49ffa6f4-93eb-41fb-8f2a-6a087aac4ac0` stays valid. No files in this repo need to change. It cannot be done on days 1 and 2 of a month (today is 16 November, fine) and needs Admin in both spaces (already true).

1. Make sure nobody is running live checks on the app (the transfer is quick but changes the breadcrumb and billing owner).
2. Open https://developer.atlassian.com/console/developer-space/18159bee-5fcb-492f-ac1e-63ebe97c5b16 (LotZero space home). Alternative: `/console/myapps/`, click the space switcher at top left, pick LotZero.
3. In the My apps table, find the row **The Page Is Lying** (id `49ffa6f4-...`), click its **More actions** (three dots), then **Transfer app**.
4. In "Transfer details", confirm "Selected App" shows The Page Is Lying and "Developer Space: LotZero". Open the destination dropdown, choose `The Page Is Lying - 718977a5-b87e-4268-b75a-8ba3a329d31d`, click **Transfer app**. Keep the dialog open until it closes.
5. Verify: the console breadcrumb reads "The Page Is Lying / The Page Is Lying"; `forge environments list` and `forge install list` (run in the repo, same manifest) show the same ids; optionally `forge deploy -e development --non-interactive` still works.
6. Do not run `forge register`. It would create a new app id.
7. Only after the transfer, do the production deploy and install.

LotZero then keeps its two LotZero apps. The new space holds only this entry.
