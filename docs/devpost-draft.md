# Devpost write-up draft: The Page Is Lying

Draft for the Codegeist 2026 submission (category: Apps for Software Teams; bonuses: Rovo agent and Atlassian MCP). Check every number and link again before submitting. The only placeholder left is the demo video link (TODO).

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

### Screenshots (live demo site)

| Screenshot | What it shows |
|---|---|
| [page-counts-2-3-1.png](screenshots/page-counts-2-3-1.png) | The macro on the runbook page: 2 Verified, 3 Contradicted, 1 No evidence at `himanshu748/payments-api@0383355` |
| [page-fixed-green.png](screenshots/page-fixed-green.png) | After the fix: `POST /v2/payments` verified in code, 3 Verified, 2 Contradicted, 1 No evidence |
| [rovo-v1-charge-answer.png](screenshots/rovo-v1-charge-answer.png) | Runbook checker answering "Can I still call POST /v1/charge?" |
| [rovo-no-repo-answer.png](screenshots/rovo-no-repo-answer.png) | Before a repository is configured, the agent says no verdict was produced instead of guessing |
| [settings-page.png](screenshots/settings-page.png) | The admin settings page |
| [install-consent.png](screenshots/install-consent.png) | The install page judges see: vendor, privacy policy, and the permissions (Read user, View pages, App Storage scope, 4 external domains) |
| [mcp-oauth-consent.png](screenshots/mcp-oauth-consent.png) | The OAuth consent screen when an MCP client connects |

### The Rovo answer, exactly as recorded

Asked "Can I still call POST /v1/charge?" on the broken page:

> No, contradicted by code: no route matches POST /v1/charge. The repo has POST /v2/payments at src/routes.ts:88 [ev_39dd3751].
> Repository: himanshu748/payments-api
> Commit: 0383355
> Counts: 1 claim, 0 verified, 1 contradicted, 0 unknown
> Limits: Coverage is complete for routes, env, cli, files, and packages; config coverage is none. Index is not stale.

Asked "Is this page still true?", the answer opens with "This page is partially out of date. Out of 6 claims, 3 are contradicted by the code, 1 has no evidence, and 2 are verified." and then lists each claim with its file, line and evidence id. An MCP client (MCP Inspector) calling `check-claim` got the same statement, evidence ids and commit.

A note on the MCP consent screen: Atlassian's OAuth page says the app "will have these permissions on your behalf in Atlassian products: Read, Write, and Search". That wording comes from Atlassian's MCP gateway, not from the app. The app's manifest asks only for `storage:app`, `read:page:confluence` and `read:confluence-user`, and both tools are read-only.

## How we built it

- **Forge, free tier only.** Custom UI (React, Vite) for the macro, byline and settings page; Forge KVS for the index and settings; a queue consumer for indexing; external fetch to GitHub with egress declared in `manifest.yml`; `rovo:agent`, `action` and `rovo:mcp` modules.
- **Deterministic core.** Claim extraction is regular expressions plus small grammars for paths, env vars and flags. The repo index is built with per-framework scanners (Express, Fastify, Hono, FastAPI, Flask, commander, yargs, argparse, click, cobra, OpenAPI, YAML and JSON config, `.env` files, Compose). The matcher applies a verdict table and ranks the nearest real alternative. **No LLM is used in the check.**
- **One service everywhere.** The macro, byline, Rovo action and MCP tool call the same check service over the same stored index, so they cannot disagree.
- **Evidence model.** Every verdict carries stable evidence ids, file, line, a short snippet and a permalink. Wording comes from one template file, and a test fails if a banned verdict word ever appears in the output. The only verdict phrases are "verified in code", "contradicted by code" and "no evidence found".
- **Prompt-injection resistant.** Page text, repo strings and action results are data. They are control-character stripped, capped, and placed in fields named `untrusted*`. Test fixtures inject instructions into both the page and the repo and require identical verdicts.
- **Tests.** Strict TypeScript, Vitest (675 tests, including property tests with fast-check on the parsers and the tar reader) and Playwright (49 tests) with axe accessibility checks. A golden test runs the real extractor, real index builder and the demo repo end to end.

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
- Coverage must be a first-class output, otherwise "not found" turns into a false "contradicted by code".
- Forge's bundler and runtime differ from a plain Node setup; small things such as `.js` import suffixes broke the first deploy and now have a guard test.

## What's next

- Bitbucket Cloud end-to-end in the UI (the adapter exists behind the same interface).
- Per-page repository overrides and more languages for the index.
- Teamwork Graph and Marketplace listing, if they can be added without risking the core (see `docs/bonus-assessment.md`).
- Scheduled re-checks that flag a page when a merge makes a claim stale.

## Built with

Forge (Custom UI, KVS, Queue, external fetch, Rovo agent, Rovo actions, `rovo:mcp`), Confluence, TypeScript, React, Vite, Vitest, fast-check, Playwright, axe-core, GitHub REST and tarball API.

## Links

- Demo video (public YouTube, under 5 minutes): TODO, paste the link after uploading `video/out/the-page-is-lying-demo.mp4` (3:53, 1920x1080). Upload `video/out/the-page-is-lying-demo.srt` as English subtitles; steps are in `video/README.md`.
- Image gallery: `video/out/still-1-page-contradicted.png`, `still-2-evidence-card.png` (local test build, labelled), `still-3-rovo-answer.png`, `still-4-mcp-results.png`, `still-5-fixed-green.png`.
- Public code repository: https://github.com/himanshu748/the-page-is-lying
- Demo repo: https://github.com/himanshu748/payments-api
- Judge install link (production, Confluence): [Install The Page Is Lying](https://developer.atlassian.com/console/install/49ffa6f4-93eb-41fb-8f2a-6a087aac4ac0?signature=AYABePL2xV9xjDb%2BabY%2FKJA8TaMAAAADAAdhd3Mta21zAEthcm46YXdzOmttczp1cy13ZXN0LTI6NzA5NTg3ODM1MjQzOmtleS83MDVlZDY3MC1mNTdjLTQxYjUtOWY5Yi1lM2YyZGNjMTQ2ZTcAuAECAQB4CxqLTo9l4lqXuFjNim1xJM%2Bp%2F3TVP9xHS2BrU5DRRucBJvE%2BVKNLIMGitmiSj4mo1AAAAH4wfAYJKoZIhvcNAQcGoG8wbQIBADBoBgkqhkiG9w0BBwEwHgYJYIZIAWUDBAEuMBEEDLx939ZsZeaijjKclgIBEIA75PYe66AVXchPBvFYZGZ6RpV2qg938MuNIm1YnNOnElpMmx%2FYysctVAqAcilhLPjAt1hq%2B02FG4bTUyIAB2F3cy1rbXMAS2Fybjphd3M6a21zOmV1LXdlc3QtMTo3MDk1ODc4MzUyNDM6a2V5LzQ2MzBjZTZiLTAwYzMtNGRlMi04NzdiLTYyN2UyMDYwZTVjYwC4AQICAHi9bVMAkme4qVQX1fQHo6ePw3H40A7cGfz7yrmSfBWMXgEulkTgaS9JUjTYO9cXswquAAAAfjB8BgkqhkiG9w0BBwagbzBtAgEAMGgGCSqGSIb3DQEHATAeBglghkgBZQMEAS4wEQQMfkteS1PqTPg5RzmrAgEQgDuvnEE0daVowBl1gRFACvqw4hbVNuTaanztMGjgJdsp6SmGqX6X8g1AS0U7787Lx9nBeFEYkNxkG8ws%2FgAHYXdzLWttcwBLYXJuOmF3czprbXM6dXMtZWFzdC0xOjcwOTU4NzgzNTI0MzprZXkvNmMxMjBiYTAtNGNkNS00OTg1LWI4MmUtNDBhMDQ5NTJjYzU3ALgBAgIAeDYASx0XCjkny4iLV6vz%2BKtEGSGT6kdt0QRpkn6D%2FlVEAU6KeoDU2JZ1u08L6bYqHukAAAB%2BMHwGCSqGSIb3DQEHBqBvMG0CAQAwaAYJKoZIhvcNAQcBMB4GCWCGSAFlAwQBLjARBAwwuh7aFba8s9D5yb8CARCAO%2Bnt4UNPgS3hrZOF8iMbxRnJj6Hm7Vz5mGk6%2BTLKRDBKLP4egurBHNOtoG9zgtNBz1ZrqfSSgCj4Yv%2FLAgAAAAAMAAAQAAAAAAAAAAAAAAAAAHZ7D8%2B%2FqGvAYC%2FDXNOCexb%2F%2F%2F%2F%2FAAAAAQAAAAAAAAAAAAAAAQAAADKJjuA2IkucvsdF0rCWjg1qStMzoFHgDwYkMEBplMBdjoP%2B3A8ISh1Yp1lWf4MVnMRlryC7m9ZOJqynX3y%2Bp00Yqx8%3D&product=confluence)
- Setup and test steps for judges: README.md, section "Setup for judges"
- Privacy policy: https://github.com/himanshu748/the-page-is-lying/blob/main/PRIVACY.md

## Sources

- Atlassian, State of Teams 2024: https://www.atlassian.com/blog/state-of-teams-2024 (the "55% of knowledge workers find it hard to track down information despite knowing a lot of people at their job" figure is in the section on teams struggling to share information; confirmed by fetching the page on Nov 15, 2026).
- SlashData, State of the Developer Nation Q1 2025, blog post "Software development challenges are technical and strategic": https://www.slashdata.co/blog/software-development-challenges-are-technical-and-strategic (confirmed on Nov 15, 2026: 31% insufficient or outdated documentation; 46% documentation issues in organisations with over 1,000 employees involved in software projects, 28% in teams of 1 to 10 developers).
  - Wording note: SlashData's page says "over 1,000 employees involved in software projects", while the Developer Nation summary says "over 1,000 developers". The text above uses the SlashData wording. If you prefer "1,000+ developers", cite the Developer Nation page for that phrase.
