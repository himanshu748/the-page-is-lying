# Demo script (target 4:00, hard limit under 5:00)

Based on PLAN.md section 14, with the values and screen text seen on the live development demo site (see [integration-results.md](integration-results.md)). Codegeist asks for a public video under five minutes; this script targets four.

Real values used below:

- Page: "Payments API runbook", https://one-atlas-obka.atlassian.net/wiki/spaces/EO/pages/6815745 (page id `6815745`, space EO)
- Repo: https://github.com/himanshu748/payments-api, branch `main`, commit `0383355` (14 files in the repo)
- Broken page: 6 claims, **2 Verified, 3 Contradicted, 1 No evidence**
- Fixed page: **3 Verified, 2 Contradicted, 1 No evidence**
- MCP endpoint: `https://mcp.atlassian.com/forge/49ffa6f4-93eb-41fb-8f2a-6a087aac4ac0`. On the development install the tools are named `check-claim_development` and `check-page_development`.

## What the screen shows (development install)

- Page header: the byline item reads **Runbook check (Development)** next to "Add a reaction". It shows no counts in its title.
- Macro header: three chips, "✓ 2 Verified", "✕ 3 Contradicted", "? 1 No evidence", then `himanshu748/payments-api@0383355`, and an **Ask Runbook checker** button.
- Each claim is inline code with an icon, a red, green or grey background, a wavy or straight underline, and a label in small caps: CONTRADICTED, VERIFIED or NO EVIDENCE.
- Settings page title: "The Page Is Lying (Development)". It opens from admin.atlassian.com, Apps, Sites, one-atlas-obka, Connected apps, The Page Is Lying, "...", Configure.
- Rovo: **Ask Rovo** (top right), then the agent picker, search "Runbook", choose **Runbook checker**. Conversation starters: "Is this page still true?", "Can I still call POST /v1/charge?", "Which claims on this page are contradicted by code?".

## Pre-recording checklist

- [ ] The page is on the broken wording: claim 1 reads `POST /v1/charge` and the macro shows 2 Verified, 3 Contradicted, 1 No evidence. The `page-toggle.mjs status` helper prints `broken text present true`.
- [ ] The LotZero-Judge app is out of shot (it is listed under Connected apps on the same site; do not show that list).
- [ ] The settings page shows commit `0383355`, and the token field shows no value.
- [ ] Rovo is on for the site, and the Runbook checker agent appears in the picker.
- [ ] MCP tools are enabled (Connected apps, The Page Is Lying, "Tools: Enable tools"), and the MCP client is connected and has listed both tools.
- [ ] The evidence card was rehearsed: hover or focus `POST /v1/charge` and check that the card shows `src/routes.ts:88` and the permalink. The card has not been captured live yet, so check it before you record.
- [ ] No API tokens, terminal history, email inbox or browser notifications are visible. The Jira draft is not confirmed.

| Time | Scene | Say and show |
|---|---|---|
| 0:00 to 0:20 | Problem | "Runbooks drift from the code, and nobody notices until an incident." On screen: the numbers with sources. 31% of developers name insufficient or outdated documentation a top challenge, 46% in organisations with over 1,000 developers (SlashData, State of the Developer Nation Q1 2025). 55% of knowledge workers find it hard to track down information (Atlassian State of Teams 2024). |
| 0:20 to 0:45 | Setup | Open the settings page: repository `https://github.com/himanshu748/payments-api`, branch `main`, indexed at commit `0383355`. Say: "Read-only, free tier, and there is no LLM in the check. The check is regular expressions and a code index." |
| 0:45 to 1:45 | The page | Open "Payments API runbook". Point at the macro header: 2 Verified, 3 Contradicted, 1 No evidence, at `payments-api@0383355`. First paragraph: `POST /v1/charge`, red, CONTRADICTED. Hover or focus it: "The repo has POST /v2/payments at src/routes.ts:88", with the GitHub permalink. `STRIPE_KEY` is contradicted by code: the code reads `PAYMENTS_API_KEY` (`src/config.ts:8`). `payments refund <paymentId> --force`: `--force` is not defined; `refund` is at `src/cli.ts:10` with `--confirm` and `--reason`. Two verified in code: `GET /v2/payments/{id}` at `src/routes.ts:92` and `npm run db:migrate` at `package.json:18`. Then the grey `ledgerctl reconcile --since 24h`: "No evidence found. This is not a confirmation." Tab to a claim to open the card from the keyboard; Escape closes it. Point out icon, label and underline, not just colour. |
| 1:45 to 2:30 | Rovo | Ask Rovo, Runbook checker, starter "Can I still call POST /v1/charge?". The answer starts "No, contradicted by code: no route matches POST /v1/charge. The repo has POST /v2/payments at src/routes.ts:88 [ev_39dd3751]." and gives repository, commit `0383355`, counts and limits. Then "Is this page still true?": "This page is partially out of date. Out of 6 claims, 3 are contradicted by the code, 1 has no evidence, and 2 are verified." Say: "The agent only reports what the read-only action returned." |
| 2:30 to 3:00 | MCP | Switch to the MCP client (Claude Code, or MCP Inspector, which was used for the live check) connected to the endpoint above. Run `check-claim` with `POST /v1/charge`, then `check-page` with `6815745`. Same statement, same evidence ids, same commit. Say: "Same tool, same evidence, any MCP client." |
| 3:00 to 3:30 | Fix | Edit the page: change `POST /v1/charge` to `POST /v2/payments`. Publish and reload: the claim is verified in code at `src/routes.ts:88`, and the macro header shows 3 Verified, 2 Contradicted, 1 No evidence. |
| 3:30 to 3:45 | Jira (optional) | On the `STRIPE_KEY` card choose "Draft Jira task". Show the exact issue text. "Nothing is sent until I click confirm." Close without confirming. |
| 3:45 to 4:00 | Close | "Deterministic, cites file and line, read-only, works on any public GitHub repository. The Page Is Lying." Show the repo link and the install link (README, "Judge install link"). |

After recording, put the page back on the broken wording (or leave it fixed and note it), so the next run starts from the checklist above.

## Timing and recording notes

- Rehearse once with a stopwatch; if the Rovo answer is slow, cut the second Rovo question first, then the Jira scene. The mandatory beats are 0:45 to 1:45 (red citation), the Rovo "Can I still call POST /v1/charge?" answer, and the fix turning green.
- The development install labels the byline and settings page "(Development)". That is expected on the demo site.
- Do not show the settings token field with a value, API tokens, or the terminal history.
- Keep the demo site's name and the developer space name consistent with the submission; see [developer-space.md](developer-space.md) for what is visible to viewers.
- Upload to YouTube as public and keep the video under 5:00 (rules summary in [bonus-assessment.md](bonus-assessment.md); confirm on the rules page).
