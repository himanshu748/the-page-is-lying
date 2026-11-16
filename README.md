<img src="assets/icon.svg" width="64" height="64" alt="">

# The Page Is Lying

A Forge app for Confluence. It finds checkable claims in a runbook or how-to page (HTTP endpoints, environment variables, CLI commands and flags, config keys, file paths, package versions), compares each one with the code in a public repository, and marks it **Verified**, **Contradicted by code** or **No evidence found**. Every verdict cites the repo file and line, for example `POST /v1/charge` is contradicted because the repo only has `POST /v2/payments` at `src/routes.ts:88`.

Built for Atlassian Codegeist 2026, category Apps for Software Teams, with the Rovo agent and `rovo:mcp` bonuses. Design and plan: [PLAN.md](PLAN.md).

## What it does

- **Confluence macro "Runbook check"** (bodied). Put it around a section of a page. Claims are underlined and marked with an icon and a label, not by colour alone. Hover or focus a claim to see the evidence card with a permalink.
- **Page byline item** showing the counts for the page and a way to check the whole page.
- **Rovo agent "Runbook checker"**. Answers "is this page still true?" and "can I still call X?" using only the result of a read-only action. It cites evidence ids and never guesses. "No evidence found" is never presented as a pass.
- **`rovo:mcp` tools** `check-page` and `check-claim`: the same read-only checks for Claude Code, Cursor or any MCP client.
- **Optional Jira draft.** For a contradicted claim the app shows the exact issue text first. Nothing is written without a click.
- **Admin settings page** for the repository URL, branch, optional read-only token, service hosts and Jira ids, with index status and an "Index now" button.

Wording is fixed: "Verified in code", "Contradicted by code", "No evidence found". The app never says a page is "wrong" or "safe".

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
6. Enable the MCP tools for external clients: Atlassian Administration, Apps, Sites, your site, **Connected apps**, "The Page Is Lying", **View app details**, **Tools** tab, and select `check-page` and `check-claim`. External exposure is off until an admin does this.

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

## Limits

- Repository sources: public GitHub (token optional) and Bitbucket Cloud. One saved repository and branch per site. A macro that names a different repository is refused.
- Index limits: size, file count and per-kind entry caps; a truncated or dynamic repo makes coverage `partial`, which turns would-be red claims into "No evidence found" instead of a false contradiction.
- Supported source for the index: JavaScript and TypeScript, Python, Go, Java; other languages mark coverage `partial`.
- Claims per page: at most 200 (the report says when it was truncated). Page body limit 400 KB for the macro and byline.
- GitHub unauthenticated rate limit: 60 requests per hour. The app asks for the commit at most once every 10 minutes and serves a stale index (marked stale) when the host rate-limits it.
- Freshness: an index younger than 15 minutes is used as is; after that a changed branch head triggers a background reindex.
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

**Pending production deploy (needs owner approval).** The link will be created from the developer console, Distribution, Sharing, after `forge deploy -e production`. Until then judges cannot install the app. Placeholder: `https://developer.atlassian.com/console/install/<pending>`.
