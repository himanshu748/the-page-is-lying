# Demo script (target 4:00, hard limit under 5:00)

Based on PLAN.md section 14 with the real values. Record on the development demo site after the browser steps in [integration-checklist.md](integration-checklist.md) pass. Codegeist asks for a public video under five minutes; this script targets four.

Real values used below:

- Page: "Payments API runbook", https://one-atlas-obka.atlassian.net/wiki/spaces/EO/pages/6815745 (page id `6815745`, space EO)
- Repo: https://github.com/himanshu748/payments-api, branch `main`, commit `0383355` (14 files in the repo)
- Broken page: 6 claims, **2 verified, 3 contradicted, 1 no evidence found**
- Fixed page: **3 verified, 2 contradicted, 1 no evidence found**
- MCP endpoint: `https://mcp.atlassian.com/forge/49ffa6f4-93eb-41fb-8f2a-6a087aac4ac0`

Before recording: index is ready (settings page shows commit `0383355`), the page is in the broken state, Rovo chat and a terminal with Claude Code (MCP connected, tools enabled by the admin) are open, and the Jira draft is not confirmed.

| Time | Scene | Say and show |
|---|---|---|
| 0:00 to 0:20 | Problem | "Runbooks drift from the code, and nobody notices until an incident." On screen: two numbers with sources. 31% of developers name insufficient or outdated documentation a top challenge, 46% in organisations with over 1,000 developers (SlashData, State of the Developer Nation Q1 2025). 55% of knowledge workers find it hard to track down information (Atlassian State of Teams 2024). |
| 0:20 to 0:45 | Setup | Open the app's settings page: repository `himanshu748/payments-api`, branch `main`, indexed at commit `0383355`, coverage complete for routes, environment variables and CLI. Say: "Read-only, free tier, and there is no LLM in the check. The check is regular expressions and a code index." |
| 0:45 to 1:45 | The page | Open "Payments API runbook". Scroll to the first paragraph: `POST /v1/charge` is red, label "Contradicted". Hover: "The repo has POST /v2/payments at src/routes.ts:88", with the GitHub permalink. Next, `STRIPE_KEY` is red: the code reads `PAYMENTS_API_KEY` (`src/config.ts:8`). Then `payments refund <paymentId> --force`: `--force` is not defined, `refund` is at `src/cli.ts:10` with `--confirm` and `--reason` at lines 12 and 13. Two green claims: `GET /v2/payments/{id}` at `src/routes.ts:92` and `npm run db:migrate` at `package.json:18`. Then the grey `ledgerctl reconcile --since 24h`: "No evidence found. This is not a confirmation." Tab to a claim and show the card opening from the keyboard, Escape closes it. Point out icon and label, not just colour. |
| 1:45 to 2:30 | Rovo | Open Rovo chat with Runbook checker on this page. Ask "Can I still call /v1/charge?". Answer starts "No, contradicted by code" and cites `src/routes.ts:88` with an evidence id. Then ask "Is this page still true?": counts 2 verified, 3 contradicted, 1 no evidence, repository and commit `0383355`. Say: "The agent only reports what the read-only action returned." |
| 2:30 to 3:00 | MCP | Switch to Claude Code connected to the MCP endpoint above. Ask: "Using runbook-checker, can I still call POST /v1/charge?" and then "is page 6815745 still true?". Same cited answers. Say: "Same tool, same evidence, any MCP client." |
| 3:00 to 3:30 | Fix | Edit the page: change `POST /v1/charge` to `POST /v2/payments`. Publish and reload: the paragraph is green with `src/routes.ts:88`; the byline now shows 3 verified, 2 contradicted, 1 no evidence. |
| 3:30 to 3:45 | Jira (optional) | On the `STRIPE_KEY` card click "Draft Jira task". Show the exact issue text. "Nothing is sent until I click confirm." Close without confirming. |
| 3:45 to 4:00 | Close | "Deterministic, cites file and line, read-only, works on any public GitHub repository. The Page Is Lying." Show the repo link and the install link. |

## Timing and recording notes

- Rehearse once with a stopwatch; if the Rovo answer is slow, cut the second Rovo question first, then the Jira scene. The mandatory beats are 0:45 to 1:45 (red citation), the Rovo "can I still call /v1/charge?" answer, and the fix turning green.
- Do not show the settings token field with a value, API tokens, or the terminal history.
- Keep the demo site's name and the developer space name consistent with the submission; see [developer-space.md](developer-space.md) for what is visible to viewers.
- Upload to YouTube as public and keep the video under 5:00 (rules summary in [bonus-assessment.md](bonus-assessment.md); confirm on the rules page).
