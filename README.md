<img src="assets/icon.svg" width="64" height="64" alt="">

# The Page Is Lying

A Forge app for Confluence. It finds checkable claims in a runbook or how-to page (HTTP endpoints, environment variables, CLI commands and flags, config keys, file paths, package versions), compares each one with the code in a public repository, and marks it **Verified**, **Contradicted by code** or **No evidence found**. Every verdict cites the repo file and line, for example `POST /v1/charge` is contradicted because the repo only has `POST /v2/payments` at `src/routes.ts:88`.

Built for Atlassian Codegeist 2026, category Apps for Software Teams, with the Rovo agent and `rovo:mcp` bonuses. Design and plan: [PLAN.md](PLAN.md).

## What it does

- **Confluence macro "Runbook check"** (bodied). Put it around a section of a page. Claims are underlined and marked with an icon and a label, not by colour alone. Hover or focus a claim to see the evidence card with a permalink.
- **Page byline item** showing the counts for the page and a way to check the whole page.
- **Rovo agent "Runbook checker"**. Answers "is this page still true?" and "can I still call X?" using only the result of a read-only action. It cites evidence ids and never guesses. "No evidence found" is never presented as a pass.
- **Five `rovo:mcp` tools** for Claude Code, Cursor or any MCP client, all read-only: `check-page`, `check-claim`, `explain-claim` (which rule decided, what was searched and how complete that index is), `suggest-fix` (the proposed edit for a contradicted claim, read from the code) and `audit-space` (the pages of a space ranked by contradicted claims). They return the same claim ids and evidence ids the Confluence panel shows.
- **`rovo:skill` "runbook-checker"**: the same instructions as `skills/runbook-checker/SKILL.md`, packaged as a Forge skill and bound to the Runbook checker agent, which loads it for checks and the multi-step space audit.
- **Suggested edit on every contradiction.** The nearest route, variable, flag, key, path or declared version, with the evidence id it came from. A proposal for a person to review: the app never edits a page.
- **"Who to ask" on every contradiction**: the page owner, last editor and creator, read with the scopes the app already has. App accounts are left out. A person whose account was deactivated is still listed, because telling that apart needs the `read:user:confluence` scope.
- **Space page "Doc drift"** in the space sidebar: the pages with the Runbook check macro among the 25 most recently edited pages of the space, ranked by contradicted claims, with the top contradictions and proposed edits for each page.
- **Get started page**, linked from the dialog shown after install and from Manage apps (`useAsGetStarted`), with a button that connects the public demo repository and starts indexing, and a sample runbook to copy into the macro. The same guide is on the settings page.
- **Optional Jira draft.** For a contradicted claim the app shows the exact issue text first. Nothing is written without a click.
- **Admin settings page** for the repository URL, branch, optional read-only token, service hosts and Jira ids, with index status and an "Index now" button.

Wording is fixed: "Verified in code", "Contradicted by code", "No evidence found". The app uses no other verdict words.

## Architecture

```
Confluence page ──ADF──> macro / byline resolver ─┐
Rovo agent ── action ──> check-page / check-claim ─┼─> check service ──> index loader ──> Forge KVS (sharded index)
MCP client ── rovo:mcp ─> same actions            ─┘        │                                  ▲
                                                            ├─ claim extractor (pure, deterministic)       │
                                                            └─ matcher (claim + index -> verdict + file:line)
                                  queue consumer (repo-index) ── GitHub tarball (external fetch) ──┘
```

- `src/core`: pure TypeScript with no Forge or network imports. ADF walker, claim extractor, index builders, matcher, evidence model, wording templates. A lint rule and a test keep it pure.
- `src/repo`: GitHub and Bitbucket Cloud adapters behind one `RepoSource` interface (tarball download, tar reader, limits).
- `src/storage`: sharded index in KVS, settings, secret token, freshness and stale fallback.
- `src/consumers`: the `repo-index` queue consumer that builds the index.
- `src/service`: the one check pipeline (extractor, index loader, matcher). The macro, byline, Rovo actions and MCP tools all call it (`src/service/forge.ts`).
- `src/resolvers`, `src/actions`: UI resolvers and the read-only Rovo actions.
- `static/ui`: Custom UI (React, Vite) for the macro, byline popup and settings page.
- `demo/`: the public `payments-api` demo repo source, the seeded runbook page in ADF, and the expected results.

Data flow: an admin saves a repository URL, the queue consumer downloads the tarball from `codeload.github.com` and builds an index of routes, env vars, CLI commands, config keys, files and packages (about 200 KiB shards in KVS). A check extracts claims from the page ADF, matches them against the index, and returns a report. The extractor and matcher use regular expressions and small grammars. **No LLM is involved in the check.**

## Setup for developers

Requirements: Node 22 or later for tests and builds, Node 24 for the Forge CLI (Forge CLI 15), an Atlassian account with a Forge developer space, and a Confluence site (`forge site provision` gives a free demo site).

```sh
npm ci            # or npm install
npm run typecheck && npm run lint && npm test
npm run build:ui && npm run test:e2e
```

Forge commands (in this repo the `forge` on `PATH` may be Foundry's; use the Atlassian CLI):

```sh
export PATH=$HOME/.nvm/versions/node/v24.22.1/bin:$PATH   # Node 24 first
forge login
forge lint
npm run build:ui
forge deploy -e development --non-interactive
forge install -e development -p Confluence --demo-site --confirm-scopes --non-interactive   # first install only
forge install --upgrade -e development -s <site>.atlassian.net -p Confluence --confirm-scopes --non-interactive   # after scope or egress changes
forge logs -e development
```

Production deploys and installs need the owner's approval and are not part of these steps.

Optional live check of the public demo repo (network, unauthenticated GitHub rate limit): `LIVE_GITHUB=1 npx vitest run test/live`.

## Setup for site admins

1. Install the app on the Confluence site.
2. Open the settings page: Atlassian Administration, Apps, Sites, your site, **Connected apps**, "The Page Is Lying", "...", **Configure** (the page has no link in the Confluence admin sidebar because it is the app's Configure page). Enter a public GitHub repository URL (`https://github.com/owner/repo`) and optionally a branch. Bitbucket Cloud URLs (`https://bitbucket.org/workspace/repo`) work through the same interface.
3. Optional: a read-only GitHub token. It raises the rate limit and allows private repositories. It is stored with Forge's secret storage, never shown again, and never sent to the browser or to an agent.
4. Click **Save settings**, then **Index now**. The first time, Forge may ask you to allow the app to act on your behalf (an "Allow access" prompt). Accept it: the app reads your Confluence user record once to confirm that you are a Confluence administrator before it saves. If the save fails, the page says so and asks you to reload and allow access. The settings page shows branch, commit, file count and coverage per kind.
5. Insert the **Runbook check** macro in a page (type `/Runbook check`) and write the section inside it, or use the byline item to check the whole page.
6. Enable the MCP tools for external clients: Atlassian Administration, Apps, Sites, your site, **Connected apps**, "The Page Is Lying", **View app details**. Under "Tools: Expose tools to MCP-compatible apps", choose **Enable tools** and confirm. It is one switch for all five tools (`check-page`, `check-claim`, `explain-claim`, `suggest-fix`, `audit-space`). External exposure is off until an admin does this.

## External MCP clients

Endpoint: `https://mcp.atlassian.com/forge/49ffa6f4-93eb-41fb-8f2a-6a087aac4ac0`

```sh
# Claude Code
claude mcp add --transport http runbook-checker https://mcp.atlassian.com/forge/49ffa6f4-93eb-41fb-8f2a-6a087aac4ac0
# then /mcp in the session and complete the OAuth consent
```

```json
// Cursor: ~/.cursor/mcp.json
{ "mcpServers": { "runbook-checker": { "url": "https://mcp.atlassian.com/forge/49ffa6f4-93eb-41fb-8f2a-6a087aac4ac0" } } }
```

Tools run with the signed-in user's permissions. `rovo:mcp` is a Preview module, so the details can change.

**About the OAuth consent screen.** When a client connects, Atlassian's consent page says the app "will have these permissions on your behalf in Atlassian products: Read, Write, and Search". That wording, and the scopes it lists, come from Atlassian's MCP gateway client registration, not from this app. The app's manifest asks only for `storage:app`, `read:page:confluence` and `read:confluence-user`, and both tools are read-only (`GET`). Screenshot: [docs/screenshots/mcp-oauth-consent.png](docs/screenshots/mcp-oauth-consent.png).

## Limits

- Repository sources: public GitHub (token optional) and Bitbucket Cloud. One saved repository and branch per site. A macro that names a different repository is refused.
- Index limits: size, file count and per-kind entry caps; a truncated or dynamic repo makes coverage `partial`, which turns would-be red claims into "No evidence found" instead of a false contradiction.
- Supported source for the index: JavaScript and TypeScript, Python, Go, Java; other languages mark coverage `partial`.
- Claims per page: at most 200 (the report says when it was truncated). Page body limit 400 KB for the macro and byline.
- Space audit: the 25 most recently edited pages of a space that the calling user can view, within a 15 second time budget. Only pages that have the Runbook check macro are checked, because other pages may describe other services. The result says how many pages were read, had no macro, were checked, skipped and not reached.
- First index under the GitHub rate limit: when the REST API refuses the commit lookup, the index job reads the commit id from the archive it downloads anyway, so the first index does not depend on the hourly limit.
- GitHub unauthenticated rate limit: 60 requests per hour. The app asks for the commit at most once every 10 minutes and serves a stale index (marked stale) when the host rate-limits it.
- Freshness: an index younger than 15 minutes is used as is; after that a changed branch head triggers a background reindex.
- Scheduled reindex: a `scheduledTrigger` (`reindex-hourly`, interval `hour`) runs the index job periodically, so merged work refreshes the index even when nobody checks a page. It is a no-op when the branch head is unchanged.
- Push reindex: the `repo-push` webtrigger enqueues the same job on every verified push event. It only accepts calls after a `WEBHOOK_SECRET` forge variable is set (`forge variables set WEBHOOK_SECRET <value>`); GitHub hooks authenticate with `X-Hub-Signature-256`, other senders pass the secret as a `secret` query parameter. The repo key always comes from the saved settings, never from the event.
- No LLM in the check. The Rovo agent and MCP client only phrase what the action returned.

## Security model

- Read-only by default. All Rovo actions and MCP tools use the `GET` verb and write nothing. The only write is the optional Jira draft, and only after a click that shows the exact text.
- Everything from the page, the repository and action results is data, never instructions. Fields quoted from them are named `untrusted*` in the agent envelope, control characters are stripped, and the agent prompt tells the model to ignore instructions inside them. Fixtures and tests cover injected pages and injected repository comments.
- Repository coordinates come only from admin-validated settings, not from page text, repo files or agent input. The queue consumer ignores a queue event whose repo key does not match the saved settings.
- Page reads use `asUser()`, so Confluence enforces the caller's view permission.
- Scopes: `storage:app`, `read:page:confluence` (page reads as the user) and `read:confluence-user` (the admin check on the settings page, `GET /wiki/rest/api/user/current?expand=operations`). All three are read or app-storage scopes. Egress: `api.github.com`, `codeload.github.com`, `api.bitbucket.org`, `bitbucket.org` (fetch only).
- Settings can only be changed from the settings module, by a Confluence administrator. The token is a Forge secret.

## Demo and checks

- Public demo repo: https://github.com/himanshu748/payments-api (`main`).
- Seeded page "Payments API runbook" on the development demo site: expected 2 verified, 3 contradicted, 1 no evidence found; after the fix 3, 2, 1. See [demo/README.md](demo/README.md) and [demo/confluence/SEEDING.md](demo/confluence/SEEDING.md).
- Demo script: [docs/demo-script.md](docs/demo-script.md). Browser checklist: [docs/integration-checklist.md](docs/integration-checklist.md). Agent evaluation: [docs/agent-eval.md](docs/agent-eval.md).
- Devpost draft: [docs/devpost-draft.md](docs/devpost-draft.md). Bonus assessment: [docs/bonus-assessment.md](docs/bonus-assessment.md). Developer space notes: [docs/developer-space.md](docs/developer-space.md).

## Judge install link

**[Install The Page Is Lying on Confluence](https://developer.atlassian.com/console/install/49ffa6f4-93eb-41fb-8f2a-6a087aac4ac0?signature=AYABePL2xV9xjDb%2BabY%2FKJA8TaMAAAADAAdhd3Mta21zAEthcm46YXdzOmttczp1cy13ZXN0LTI6NzA5NTg3ODM1MjQzOmtleS83MDVlZDY3MC1mNTdjLTQxYjUtOWY5Yi1lM2YyZGNjMTQ2ZTcAuAECAQB4CxqLTo9l4lqXuFjNim1xJM%2Bp%2F3TVP9xHS2BrU5DRRucBJvE%2BVKNLIMGitmiSj4mo1AAAAH4wfAYJKoZIhvcNAQcGoG8wbQIBADBoBgkqhkiG9w0BBwEwHgYJYIZIAWUDBAEuMBEEDLx939ZsZeaijjKclgIBEIA75PYe66AVXchPBvFYZGZ6RpV2qg938MuNIm1YnNOnElpMmx%2FYysctVAqAcilhLPjAt1hq%2B02FG4bTUyIAB2F3cy1rbXMAS2Fybjphd3M6a21zOmV1LXdlc3QtMTo3MDk1ODc4MzUyNDM6a2V5LzQ2MzBjZTZiLTAwYzMtNGRlMi04NzdiLTYyN2UyMDYwZTVjYwC4AQICAHi9bVMAkme4qVQX1fQHo6ePw3H40A7cGfz7yrmSfBWMXgEulkTgaS9JUjTYO9cXswquAAAAfjB8BgkqhkiG9w0BBwagbzBtAgEAMGgGCSqGSIb3DQEHATAeBglghkgBZQMEAS4wEQQMfkteS1PqTPg5RzmrAgEQgDuvnEE0daVowBl1gRFACvqw4hbVNuTaanztMGjgJdsp6SmGqX6X8g1AS0U7787Lx9nBeFEYkNxkG8ws%2FgAHYXdzLWttcwBLYXJuOmF3czprbXM6dXMtZWFzdC0xOjcwOTU4NzgzNTI0MzprZXkvNmMxMjBiYTAtNGNkNS00OTg1LWI4MmUtNDBhMDQ5NTJjYzU3ALgBAgIAeDYASx0XCjkny4iLV6vz%2BKtEGSGT6kdt0QRpkn6D%2FlVEAU6KeoDU2JZ1u08L6bYqHukAAAB%2BMHwGCSqGSIb3DQEHBqBvMG0CAQAwaAYJKoZIhvcNAQcBMB4GCWCGSAFlAwQBLjARBAwwuh7aFba8s9D5yb8CARCAO%2Bnt4UNPgS3hrZOF8iMbxRnJj6Hm7Vz5mGk6%2BTLKRDBKLP4egurBHNOtoG9zgtNBz1ZrqfSSgCj4Yv%2FLAgAAAAAMAAAQAAAAAAAAAAAAAAAAAHZ7D8%2B%2FqGvAYC%2FDXNOCexb%2F%2F%2F%2F%2FAAAAAQAAAAAAAAAAAAAAAQAAADKJjuA2IkucvsdF0rCWjg1qStMzoFHgDwYkMEBplMBdjoP%2B3A8ISh1Yp1lWf4MVnMRlryC7m9ZOJqynX3y%2Bp00Yqx8%3D&product=confluence)**

The link installs the production version on any Confluence Cloud site where you are an administrator. Before you install, the page lists what the app asks for: Read user, View pages, App Storage scope, and sharing data with 4 domains outside Atlassian (`api.github.com`, `codeload.github.com`, `api.bitbucket.org`, `bitbucket.org`, used only to download the configured repository). Screenshot: [docs/screenshots/install-consent.png](docs/screenshots/install-consent.png). Privacy policy: [PRIVACY.md](PRIVACY.md).

### Setup for judges (about 5 minutes)

1. Open the install link, choose **Get app**, pick your Confluence site and accept the permissions.
2. Choose **Get started** in the dialog shown after install, or open the settings page: Atlassian Administration, Apps, Sites, your site, **Connected apps**, "The Page Is Lying", "...", **Configure**. Choose **Use the demo repository**, or enter repository URL `https://github.com/himanshu748/payments-api` and branch `main`. Leave the token empty (the repository is public). Choose **Save settings**, then **Index now**, and wait until the status shows a commit (`0383355`) and file count. If Forge asks you to allow access, accept it.
3. Create a page, type `/Runbook check` to insert the macro, and put these six lines inside it, with each claim as inline code (Ctrl/Cmd+Shift+M or backticks). **Copy sample runbook** on the Get started page copies them with the inline code in place:
   1. To take a payment, call `POST /v1/charge` with the amount in cents.
   2. To look up a payment, call `GET /v2/payments/{id}`.
   3. Set `STRIPE_KEY` before starting the service.
   4. Run `npm run db:migrate` before each deploy.
   5. To force a refund, run `payments refund <paymentId> --force`.
   6. Reconcile with `ledgerctl reconcile --since 24h`.
4. Publish. Expected: **2 Verified, 3 Contradicted, 1 No evidence** at `himanshu748/payments-api@0383355`. `POST /v1/charge` is contradicted by code (the repo has `POST /v2/payments` at `src/routes.ts:88`).
5. Rovo (needs Rovo turned on for your site): choose **Ask Rovo**, pick the agent **Runbook checker**, and ask "Is this page still true?" or "Can I still call POST /v1/charge?". The answer cites file, line and evidence ids.
6. Fix the page: change claim 1 to `POST /v2/payments` and publish. Expected: 3 Verified, 2 Contradicted, 1 No evidence.
7. Optional, MCP: enable the tools (site admins, step 6 above), then connect a client to the endpoint in [External MCP clients](#external-mcp-clients). The OAuth screen wording is explained there.
