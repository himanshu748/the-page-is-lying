# Devpost write-up draft: The Page Is Lying

Draft for the Codegeist 2026 submission (category: Apps for Software Teams; bonuses: Rovo agent and Atlassian MCP). Check every number and link again before submitting. Placeholders are marked TODO.

## Elevator pitch

A Confluence app that flags runbook paragraphs the code no longer agrees with, and cites the exact repo file and line as evidence.

## Inspiration

Runbooks are written once and trusted forever. Someone follows "call `POST /v1/charge`" at 3 a.m., and the service stopped serving that route two releases ago. The page looks fine because nothing about a Confluence page changes when code changes.

The problem is common. In the State of the Developer Nation Q1 2025 survey (over 10,500 developers in 127 countries), 31% named insufficient or outdated documentation a top challenge, and 46% of developers in organisations with over 1,000 people involved in software projects reported documentation issues, against 28% in small teams ([SlashData](https://www.slashdata.co/blog/software-development-challenges-are-technical-and-strategic); the same figures are summarised on [Developer Nation](https://developernation.net/blog/the-hidden-challenges-in-software-development-projects-key-insights-from-our-latest-survey/)). Atlassian's State of Teams 2024 found that 55% of knowledge workers find it hard to track down information despite knowing many people at their company ([Atlassian](https://www.atlassian.com/blog/state-of-teams-2024)). A page that cannot be trusted makes that worse.

## What it does

- A **Runbook check macro** scans a section of a page for checkable claims: HTTP endpoints, environment variables, CLI commands and flags, config keys, file paths and package versions.
- Each claim is marked **Verified**, **Contradicted by code** or **No evidence found**, with an icon, a label and an underline, not colour alone. The hover or focus card shows the evidence, for example "the repo only has `POST /v2/payments`, `src/routes.ts:88`", with a permalink to the line.
- A **Rovo agent, "Runbook checker"**, answers "is this page still true?" and "can I still call `/v1/charge`?" using only the result of a read-only action. It cites evidence ids, states the counts, repository and commit, and never treats "no evidence found" as a pass.
- A **`rovo:mcp` server** exposes the same two read-only tools (`check-page`, `check-claim`) to Claude Code, Cursor and other MCP clients.
- An optional **Jira draft** for a contradicted claim shows the exact issue text first. Nothing is written without a click.

Demo: the "Payments API runbook" page has six claims. Two are green, three red and one grey. `POST /v1/charge` is red (the code has `POST /v2/payments` at `src/routes.ts:88`), `STRIPE_KEY` is red (the code reads `PAYMENTS_API_KEY` at `src/config.ts:8`), and `payments refund <paymentId> --force` is red (the refund command defines `--confirm` and `--reason`). `npm run db:migrate` (`package.json:18`) and `GET /v2/payments/{id}` (`src/routes.ts:92`) are green. `ledgerctl reconcile --since 24h` is grey: no evidence found, which is explicitly not a confirmation. Fix the page and the first claim turns green.

## How we built it

- **Forge, free tier only.** Custom UI (React, Vite) for the macro, byline and settings page; Forge KVS for the index and settings; a queue consumer for indexing; external fetch to GitHub with egress declared in `manifest.yml`; `rovo:agent`, `action` and `rovo:mcp` modules.
- **Deterministic core.** Claim extraction is regular expressions plus small grammars for paths, env vars and flags. The repo index is built with per-framework scanners (Express, Fastify, Hono, FastAPI, Flask, commander, yargs, argparse, click, cobra, OpenAPI, YAML and JSON config, `.env` files, Compose). The matcher applies a verdict table and ranks the nearest real alternative. **No LLM is used in the check.**
- **One service everywhere.** The macro, byline, Rovo action and MCP tool call the same check service over the same stored index, so they cannot disagree.
- **Evidence model.** Every verdict carries stable evidence ids, file, line, a short snippet and a permalink. Wording comes from one template file, and a test bans words like "wrong" and "safe".
- **Prompt-injection safe.** Page text, repo strings and action results are data. They are control-character stripped, capped, and placed in fields named `untrusted*`. Test fixtures inject instructions into both the page and the repo and require identical verdicts.
- **Tests.** Strict TypeScript, Vitest (about 670 tests, including property tests with fast-check on the parsers and the tar reader) and Playwright with axe accessibility checks. A golden test runs the real extractor, real index builder and the demo repo end to end.

## Challenges

- Making "unknown" honest. When the index cannot see everything (dynamic route registration, unsupported languages, truncated trees) a claim would otherwise look contradicted. Coverage flags turn those cases into "No evidence found" rather than a false red.
- Citing lines for CLI flags across frameworks, and keeping route mounts (`app.use('/api', router)`) applied to the right paths.
- Keeping an agent from guessing. The agent can only quote the action result, and every field it did not produce is marked untrusted.
- Building six parts in isolation and then integrating them. A shared block-numbering helper keeps claim offsets identical between the extractor and the page renderer.

## Accomplishments we are proud of

- The red `POST /v1/charge` card citing `src/routes.ts:88`, the same answer from Rovo chat and from an MCP client, and the paragraph turning green after the page is fixed.
- Read-only by design, no paid APIs, no LLM in the core check.
- Accessible UI: icon, label and underline for each state; keyboard-only card access; axe clean in light and dark.

## What we learned

- The deterministic part is where the trust comes from. The agent is a thin, constrained narrator over a cited result.
- Coverage must be a first-class output, otherwise "not found" turns into "wrong".
- Forge's bundler and runtime differ from a plain Node setup; small things such as `.js` import suffixes broke the first deploy and now have a guard test.

## What's next

- Bitbucket Cloud end-to-end in the UI (the adapter exists behind the same interface).
- Per-page repository overrides and more languages for the index.
- Teamwork Graph and Marketplace listing, if they can be added without risking the core (see `docs/bonus-assessment.md`).
- Scheduled re-checks that flag a page when a merge makes a claim stale.

## Built with

Forge (Custom UI, KVS, Queue, external fetch, Rovo agent, Rovo actions, `rovo:mcp`), Confluence, TypeScript, React, Vite, Vitest, fast-check, Playwright, axe-core, GitHub REST and tarball API.

## Links (TODO before submitting)

- Demo video (public YouTube, under 5 minutes): TODO
- Public code repository: https://github.com/himanshu748/the-page-is-lying
- Demo repo: https://github.com/himanshu748/payments-api
- Judge install link: TODO, pending production deploy (needs owner approval)
- Setup and test steps for judges: see README.md and docs/integration-checklist.md

## Sources

- Atlassian, State of Teams 2024: https://www.atlassian.com/blog/state-of-teams-2024 (the "55% of knowledge workers find it hard to track down information despite knowing a lot of people at their job" figure is in the section on teams struggling to share information; confirmed by fetching the page on Nov 15, 2026).
- SlashData, State of the Developer Nation Q1 2025, blog post "Software development challenges are technical and strategic": https://www.slashdata.co/blog/software-development-challenges-are-technical-and-strategic (confirmed on Nov 15, 2026: 31% insufficient or outdated documentation; 46% documentation issues in organisations with over 1,000 employees involved in software projects, 28% in teams of 1 to 10 developers).
  - Wording note: SlashData's page says "over 1,000 employees involved in software projects", while the Developer Nation summary says "over 1,000 developers". The text above uses the SlashData wording. If you prefer "1,000+ developers", cite the Developer Nation page for that phrase.
