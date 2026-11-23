# Devpost write-up: The Page Is Lying

Text of the Codegeist 2026 submission (category: Apps for Software Teams; bonus: Best app with Atlassian MCP; Devpost allows one bonus per entry). The sections from "At a glance" to "What's next" are the project description. Check every number and link again before changing the entry.

## Elevator pitch

A Confluence app that flags runbook paragraphs the code no longer agrees with, and cites the exact repo file and line as evidence.

## At a glance

A Confluence app that marks every checkable claim in a runbook **Verified in code**, **Contradicted by code** or **No evidence found**, and cites the repository file and line. The same check answers in the page, in Rovo and over Atlassian MCP.

Checked on the production install (version 3.0.0, 23 Nov 2026), against the public [payments-api-demo](https://github.com/himanshu748/payments-api-demo) repository at commit `44c8112`:

- **6 claims on the demo runbook:** 2 verified, 3 contradicted, 1 with no evidence found. 9 files indexed.
- **One evidence id on every surface:** `POST /v1/charge` is contradicted by `src/routes.ts:88` as `ev_c81e6689` in the page panel, the Doc drift page, the Rovo answer and all five MCP tools.
- **5 of 5 MCP tools** answered from production without error, through Atlassian's MCP endpoint with OAuth.
- **Space audit:** 7 pages read, the 2 with the macro checked (12 claims: 4 verified, 6 contradicted, 2 no evidence found), 5 without it left out and counted.
- **733 unit tests and 68 browser tests** pass, with strict TypeScript and axe accessibility checks. No LLM in the check, no paid API.

## Inspiration

Runbooks are written once and trusted forever. Someone follows "call `POST /v1/charge`" at 3 a.m., and the service stopped serving that route two releases ago. The page looks fine, because nothing about a Confluence page changes when the code changes.

The problem is common. In the State of the Developer Nation Q1 2025 survey (over 10,500 developers in 127 countries), 31% named insufficient or outdated documentation a top challenge, and 46% of developers in organisations with over 1,000 people involved in software projects reported documentation issues, against 28% in small teams ([SlashData](https://www.slashdata.co/blog/software-development-challenges-are-technical-and-strategic)). Atlassian's State of Teams 2024 found that 55% of knowledge workers find it hard to track down information ([Atlassian](https://www.atlassian.com/blog/state-of-teams-2024)). A page that cannot be trusted makes that worse.

## What it does

- A **Runbook check macro** scans a section of a Confluence page for checkable claims: HTTP endpoints, environment variables, CLI commands and flags, config keys, file paths and package versions.
- Each claim is marked **Verified**, **Contradicted by code** or **No evidence found**, with an icon, a label and an underline, not colour alone. The hover or focus card shows the evidence, for example "the repo only has `POST /v2/payments`, `src/routes.ts:88`", with a permalink to the line.
- A **Rovo agent, "Runbook checker"**, answers "is this page still true?" and "can I still call `/v1/charge`?" using only the result of read-only actions. It cites evidence ids, states the counts, repository and commit, and never treats "no evidence found" as a pass.
- A **`rovo:mcp` server** exposes five read-only tools (`check-page`, `check-claim`, `explain-claim`, `suggest-fix`, `audit-space`) to Claude Code, Cursor and other MCP clients. They return the same evidence ids the Confluence panel shows.
- A **`rovo:skill`** packages the checker's instructions as a reusable skill; the Runbook checker agent loads it for the checks and the multi-step space audit.
- A **Doc drift space page** ranks the pages of a space by contradicted claims, and every contradiction shows a suggested edit and who to ask (page owner and last editor).
- The index stays current by itself: an **hourly scheduled reindex** rebuilds only when the branch head has moved, and an optional signed push webhook reindexes on every push.
- An optional **Jira draft** for a contradicted claim shows the exact issue text first. Nothing is written without a click.

**The demo.** The "Payments API runbook" page has six claims, checked against the public [payments-api-demo](https://github.com/himanshu748/payments-api-demo) repository at commit `44c8112`. Two are green, three red and one grey:

- `POST /v1/charge` is red: the code has `POST /v2/payments` at `src/routes.ts:88` (evidence `ev_c81e6689`).
- `STRIPE_KEY` is red: the code reads `PAYMENTS_API_KEY` at `src/config.ts:8`.
- `payments refund <paymentId> --force` is red: the refund command defines `--confirm` and `--reason`.
- `npm run db:migrate` (`package.json:18`) and `GET /v2/payments/{id}` (`src/routes.ts:92`) are green.
- `ledgerctl reconcile --since 24h` is grey: no evidence found, which is explicitly not a confirmation.

Fix the page and the first claim turns green.

**The Rovo answer, exactly as recorded on the production install.** Asked "Can I still call POST /v1/charge?":

> No, contradicted by code: no route matches POST /v1/charge. The repository has POST /v2/payments at src/routes.ts:88 [ev_c81e6689].
> Repository: himanshu748/payments-api-demo
> Commit: 44c8112
> Counts: 1 claim checked, 1 contradicted, 0 verified, 0 no evidence found.
> Limits: Coverage is complete for routes, env, cli, files, and packages; config coverage is none. No claims or files were truncated.

An MCP client calling `check-claim` gets the same statement, evidence ids and commit.

## Atlassian MCP: five read-only tools, called on production

The app's `rovo:mcp` module serves five tools at Atlassian's MCP endpoint, `https://mcp.atlassian.com/forge/49ffa6f4-93eb-41fb-8f2a-6a087aac4ac0`. A site admin turns them on once (Connected apps > The Page Is Lying > View app details > Enable tools), and each user signs in with OAuth. On 23 Nov 2026 an MCP client called all five against the production install on the demo site. What came back:

- **`check-page`** `{ page: 8617986 }`: 6 claims, 2 verified, 3 contradicted, 1 no evidence found, each with file, line, evidence id and permalink, plus the coverage limits (routes, env, cli, files and packages complete; config none).
- **`check-claim`** `{ claim: "POST /v1/charge", page: 8617986 }`: "Contradicted by code: no route matches POST /v1/charge. The repo has POST /v2/payments at src/routes.ts:88." Evidence `ev_c81e6689`.
- **`explain-claim`** `{ claim: "POST /v1/charge" }`: the rule that decided it, `route_absent_nearest`: "Route coverage is complete and no route matches. The nearest routes are cited."
- **`suggest-fix`** `{ page: 8617986 }`: "Suggested edit: replace POST /v1/charge with POST /v2/payments. Review it before you change the page." It returns `applied: false`; the tool never edits the page.
- **`audit-space`**: 7 pages read, 2 checked, 5 left out because they have no Runbook check macro, and the contradictions of each checked page ranked by drift.

Every result names the repository, the commit `44c8112` and the index time, so an agent can tell a fresh answer from a stale one.

**For coding agents.** Claude Code and other clients that speak MCP over HTTP connect with one command: `claude mcp add --transport http runbook-checker https://mcp.atlassian.com/forge/49ffa6f4-93eb-41fb-8f2a-6a087aac4ac0`. The repository ships the same instructions the Rovo agent uses as an open skill, [`skills/runbook-checker/SKILL.md`](https://github.com/himanshu748/the-page-is-lying/blob/main/skills/runbook-checker/SKILL.md), so an agent outside Atlassian reports the results the same way: counts first, evidence ids cited, "no evidence found" never treated as a pass. Tested with a generic MCP client (`mcp-remote`) on the production install and with MCP Inspector on the development install.

## Architecture

One check service sits behind every surface (diagram in the gallery):

- **Ask:** the Confluence macro and byline, the Doc drift space page, the Rovo agent (`rovo:agent` with `rovo:skill` and five actions) and MCP clients (`rovo:mcp`) all make the same call.
- **Check:** a pure, deterministic claim extractor, then a matcher that applies a verdict table to the claim and the index, then the evidence (stable id, file, line, snippet, permalink at the pinned commit).
- **Index:** a queue consumer downloads the repository tarball from GitHub or Bitbucket Cloud, runs the per-framework scanners and stores a sharded index in Forge KVS. Saving settings, the hourly trigger and an optional signed push webhook start it.

## How we built it

- **Forge, free tier only.** Custom UI (React, Vite) for the macro, byline, settings, Get started and Doc drift pages; Forge KVS for the index and settings; a queue consumer for indexing; a scheduled trigger and a web trigger for reindexing; external fetch to GitHub and Bitbucket Cloud with egress declared in `manifest.yml`; `rovo:agent`, `action`, `rovo:skill` and `rovo:mcp` modules.
- **Deterministic core.** Claim extraction is regular expressions plus small grammars for paths, env vars and flags. The repo index is built with per-framework scanners (Express, Fastify, Hono, FastAPI, Flask, commander, yargs, argparse, click, cobra, OpenAPI, YAML and JSON config, `.env` files, Compose). The matcher applies a verdict table and ranks the nearest real alternative. **No LLM is used in the check.**
- **One service everywhere.** The macro, byline, Rovo actions and MCP tools call the same check service over the same stored index, so they cannot disagree.
- **Evidence model.** Every verdict carries a stable evidence id, file, line, a short snippet and a permalink. Wording comes from one template file, and a test fails if a banned verdict word ever appears in the output. The only verdict phrases are "verified in code", "contradicted by code" and "no evidence found".
- **Prompt-injection resistant.** Page text, repo strings and action results are data. They are control-character stripped, capped, and placed in fields named `untrusted*`. Test fixtures inject instructions into both the page and the repo and require identical verdicts.
- **Least privilege.** The manifest asks only for `storage:app`, `read:page:confluence` and `read:confluence-user`. All Rovo actions and MCP tools are read-only.
- **Reindexing, measured.** On the development install the hourly trigger ran and left the index untouched because the branch head had not moved; a correctly signed push reindexed, and unsigned, wrong-secret and tampered pushes were refused with 401.
- **Tests.** Strict TypeScript, Vitest (733 tests, including property tests with fast-check on the parsers and the tar reader) and Playwright (68 tests) with axe accessibility checks. A golden test runs the real extractor, real index builder and the demo repo end to end.

## Challenges we ran into

- Making "unknown" honest. When the index cannot see everything (dynamic route registration, unsupported languages, truncated trees) a claim would otherwise look contradicted. Coverage flags turn those cases into "No evidence found" rather than a false red.
- Citing lines for CLI flags across frameworks, and keeping route mounts (`app.use('/api', router)`) applied to the right paths.
- Keeping an agent from guessing. The agent can only quote the action result, and every field it did not produce is marked untrusted.
- Building six parts in isolation and then integrating them. A shared block-numbering helper keeps claim offsets identical between the extractor and the page renderer.

## Accomplishments that we're proud of

- The red `POST /v1/charge` card citing `src/routes.ts:88`, the same answer and evidence id from Rovo chat and from an MCP client, and the paragraph turning green after the page is fixed.
- Read-only by design, no paid APIs, no LLM in the core check.
- Accessible UI: icon, label and underline for each state; keyboard-only card access; axe clean in light and dark.

## What we learned

- The deterministic part is where the trust comes from. The agent is a thin, constrained narrator over a cited result.
- Coverage must be a first-class output, otherwise "not found" turns into a false "contradicted by code".
- Forge's bundler and runtime differ from a plain Node setup; small things such as `.js` import suffixes broke the first deploy and now have a guard test.

## What's next for The Page Is Lying

- Notify the page owner when a merge makes a claim stale.
- Per-page repository overrides and more languages for the index.
- Teamwork Graph and a Marketplace listing.

## Screenshots

In `docs/screenshots/`, all from the production install except where noted:

| Screenshot | What it shows |
|---|---|
| [architecture.png](screenshots/architecture.png) | The architecture: one check service behind Confluence, Rovo and MCP (source: [architecture.html](architecture/architecture.html)) |
| [page-counts-2-3-1.png](screenshots/page-counts-2-3-1.png) | The macro on the runbook page: 2 Verified, 3 Contradicted, 1 No evidence at `himanshu748/payments-api-demo@44c8112` |
| [page-fixed-green.png](screenshots/page-fixed-green.png) | After the fix: `POST /v2/payments` verified in code, 3 Verified, 2 Contradicted, 1 No evidence |
| [doc-drift-space-page.png](screenshots/doc-drift-space-page.png) | The Doc drift space page: contradictions with evidence ids, suggested edits and coverage of the space |
| [get-started-page.png](screenshots/get-started-page.png) | The Get started page after setup, with the sample runbook to copy |
| [rovo-v1-charge-answer.png](screenshots/rovo-v1-charge-answer.png) | Runbook checker answering "Can I still call POST /v1/charge?" |
| [rovo-no-repo-answer.png](screenshots/rovo-no-repo-answer.png) | Before a repository is configured, the agent says no verdict was produced instead of guessing (development install) |
| [settings-page.png](screenshots/settings-page.png) | The admin settings page |
| [install-consent.png](screenshots/install-consent.png) | The install page judges see: vendor, privacy policy and permissions |
| [mcp-oauth-consent-production.png](screenshots/mcp-oauth-consent-production.png) | The OAuth consent screen when an MCP client (`mcp-remote`, shown as "MCP CLI Proxy") connects to the production install. Its "Read, Write, and Search" wording comes from Atlassian's MCP gateway; the app's manifest asks only for `storage:app`, `read:page:confluence` and `read:confluence-user` |

## Built with

Forge (Custom UI, KVS, Queue, scheduled trigger, web trigger, external fetch, Rovo agent, Rovo actions, `rovo:skill`, `rovo:mcp`), Confluence, TypeScript, React, Vite, Vitest, fast-check, Playwright, axe-core, GitHub and Bitbucket Cloud REST and tarball APIs.

## Links

- Demo video (public YouTube, under 5 minutes): https://youtu.be/mx-D4WvYj9E (3:53, 1920x1080, silent, captions from `video/out/the-page-is-lying-demo.srt` burned in).
- Image gallery: `video/out/still-1-page-contradicted.png`, `still-2-evidence-card.png` (local test build, labelled), `still-3-rovo-answer.png`, `still-4-mcp-results.png` (production MCP output of 23 Nov 2026), `still-5-fixed-green.png`, and from `docs/screenshots/`: `architecture.png`, `doc-drift-space-page.png`, `get-started-page.png`.
- Public code repository: https://github.com/himanshu748/the-page-is-lying
- Demo repo: https://github.com/himanshu748/payments-api-demo
- Judge install link (production, Confluence): [Install The Page Is Lying](https://developer.atlassian.com/console/install/49ffa6f4-93eb-41fb-8f2a-6a087aac4ac0?signature=AYABePL2xV9xjDb%2BabY%2FKJA8TaMAAAADAAdhd3Mta21zAEthcm46YXdzOmttczp1cy13ZXN0LTI6NzA5NTg3ODM1MjQzOmtleS83MDVlZDY3MC1mNTdjLTQxYjUtOWY5Yi1lM2YyZGNjMTQ2ZTcAuAECAQB4CxqLTo9l4lqXuFjNim1xJM%2Bp%2F3TVP9xHS2BrU5DRRucBJvE%2BVKNLIMGitmiSj4mo1AAAAH4wfAYJKoZIhvcNAQcGoG8wbQIBADBoBgkqhkiG9w0BBwEwHgYJYIZIAWUDBAEuMBEEDLx939ZsZeaijjKclgIBEIA75PYe66AVXchPBvFYZGZ6RpV2qg938MuNIm1YnNOnElpMmx%2FYysctVAqAcilhLPjAt1hq%2B02FG4bTUyIAB2F3cy1rbXMAS2Fybjphd3M6a21zOmV1LXdlc3QtMTo3MDk1ODc4MzUyNDM6a2V5LzQ2MzBjZTZiLTAwYzMtNGRlMi04NzdiLTYyN2UyMDYwZTVjYwC4AQICAHi9bVMAkme4qVQX1fQHo6ePw3H40A7cGfz7yrmSfBWMXgEulkTgaS9JUjTYO9cXswquAAAAfjB8BgkqhkiG9w0BBwagbzBtAgEAMGgGCSqGSIb3DQEHATAeBglghkgBZQMEAS4wEQQMfkteS1PqTPg5RzmrAgEQgDuvnEE0daVowBl1gRFACvqw4hbVNuTaanztMGjgJdsp6SmGqX6X8g1AS0U7787Lx9nBeFEYkNxkG8ws%2FgAHYXdzLWttcwBLYXJuOmF3czprbXM6dXMtZWFzdC0xOjcwOTU4NzgzNTI0MzprZXkvNmMxMjBiYTAtNGNkNS00OTg1LWI4MmUtNDBhMDQ5NTJjYzU3ALgBAgIAeDYASx0XCjkny4iLV6vz%2BKtEGSGT6kdt0QRpkn6D%2FlVEAU6KeoDU2JZ1u08L6bYqHukAAAB%2BMHwGCSqGSIb3DQEHBqBvMG0CAQAwaAYJKoZIhvcNAQcBMB4GCWCGSAFlAwQBLjARBAwwuh7aFba8s9D5yb8CARCAO%2Bnt4UNPgS3hrZOF8iMbxRnJj6Hm7Vz5mGk6%2BTLKRDBKLP4egurBHNOtoG9zgtNBz1ZrqfSSgCj4Yv%2FLAgAAAAAMAAAQAAAAAAAAAAAAAAAAAHZ7D8%2B%2FqGvAYC%2FDXNOCexb%2F%2F%2F%2F%2FAAAAAQAAAAAAAAAAAAAAAQAAADKJjuA2IkucvsdF0rCWjg1qStMzoFHgDwYkMEBplMBdjoP%2B3A8ISh1Yp1lWf4MVnMRlryC7m9ZOJqynX3y%2Bp00Yqx8%3D&product=confluence)
- Setup and test steps for judges: README.md, section "Setup for judges"
- Privacy policy: https://github.com/himanshu748/the-page-is-lying/blob/main/PRIVACY.md

## Sources

- Atlassian, State of Teams 2024: https://www.atlassian.com/blog/state-of-teams-2024 (the "55% of knowledge workers find it hard to track down information despite knowing a lot of people at their job" figure is in the section on teams struggling to share information; confirmed by fetching the page on Nov 15, 2026).
- SlashData, State of the Developer Nation Q1 2025, blog post "Software development challenges are technical and strategic": https://www.slashdata.co/blog/software-development-challenges-are-technical-and-strategic (confirmed on Nov 15, 2026: 31% insufficient or outdated documentation; 46% documentation issues in organisations with over 1,000 employees involved in software projects, 28% in teams of 1 to 10 developers).
  - Wording note: SlashData's page says "over 1,000 employees involved in software projects", while the Developer Nation summary says "over 1,000 developers". The text above uses the SlashData wording. If you prefer "1,000+ developers", cite the Developer Nation page for that phrase.
