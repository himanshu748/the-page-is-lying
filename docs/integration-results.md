# Live verification results (demo site)

Date: 2026-11-16. Branch `feat/integration` at 8c0173c. Development version 2.2.0.

**Status: blocked. The preview browser was never signed in to Atlassian.**
A tab opened at `https://one-atlas-obka.atlassian.net/wiki/spaces/EO/pages/6815745` was redirected to `id.atlassian.com/login`. I re-checked about every 2 to 5 minutes for 30 minutes and it stayed on the login page. I did not type or request credentials. The tab is closed. No code was changed and nothing was deployed.

## Checks that did not need a browser

| Check | Result | Evidence |
|---|---|---|
| Demo page exists | pass | REST `GET /wiki/api/v2/pages/6815745`: title "Payments API runbook", version 1, status current |
| REST token works for the demo site | pass | `GET /wiki/rest/api/search` 200 |
| `user/current?expand=operations` with the API token | 200 | This is a user-token call, so it does not answer the A3 risk (app-scoped call) |
| `forge logs -e development` | empty | No invocations since the 2.2.0 deploy, so no `page_read` status yet |
| Disk | 26 GiB free | `df -h /System/Volumes/Data` |

## Checklist steps

| Step | Result | Notes |
|---|---|---|
| A1 to A5 settings, Index now, logs | not run | needs signed-in browser |
| B6 to B12 macro, cards, byline, keyboard, Jira draft | not run | same |
| C13 to C18 Rovo, `page_read` status, red-team, LotZero | not run | same. `asUser()` finding still open |
| D19 to D22 MCP enable, client, off-host URL | not run | needs admin sign-in and OAuth |
| E23 to E26 fix page, green, restore | not run | page left at version 1 (broken), unchanged |
| F27, F28 stale index, token field | not run | |

Screenshots: none. The page was not modified, so it is still the broken version 1.

## What the user has to do

1. Sign in as jhahimanshu653@gmail.com in the T3 preview browser (default profile) and tell the orchestrator, then re-run this task.
2. Alternatively follow `docs/integration-checklist.md` by hand. For MCP with Claude Code: `claude mcp add --transport http runbook-checker https://mcp.atlassian.com/forge/49ffa6f4-93eb-41fb-8f2a-6a087aac4ac0`, then `/mcp` and approve. For Cursor, add `{"mcpServers":{"runbook-checker":{"url":"https://mcp.atlassian.com/forge/49ffa6f4-93eb-41fb-8f2a-6a087aac4ac0"}}}` to `~/.cursor/mcp.json`.
