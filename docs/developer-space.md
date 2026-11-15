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
