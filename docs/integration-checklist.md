# Integration checklist (browser steps)

Everything the agent could verify without a login is done (see the integration report in `.agents/tasks/task-page-is-lying/task.json` and `git log`). These steps need a signed-in browser. Do them in order, tick each box, and record what you see. The development version deployed from `feat/integration` is **3.0.0** (adds the scope `read:confluence-user`) on `https://one-atlas-obka.atlassian.net` (installation `a3b0e75c-f080-4961-a81f-eb286ec6761d`, up to date).

Values used below: repository `https://github.com/himanshu748/payments-api-demo` (branch `main`, commit `0383355`), page "Payments API runbook" `https://one-atlas-obka.atlassian.net/wiki/spaces/EO/pages/6815745`, app id `49ffa6f4-93eb-41fb-8f2a-6a087aac4ac0`.

Terminal setup for every `forge` command (the `forge` on `PATH` is Foundry's, not Atlassian's):

```sh
export PATH=$HOME/.nvm/versions/node/v24.22.1/bin:$PATH
FORGE=/Users/himanshujha/.rote/lib/node-runtimes/node-v22.14.0-IYQPZh/bin/forge
cd /Users/himanshujha/.t3/projects/atlassian   # or your checkout of feat/integration
```

## A. Configure the repository (about 3 minutes)

1. [ ] Sign in at `https://one-atlas-obka.atlassian.net/wiki` as the site admin (jhahimanshu653@gmail.com).
2. [ ] Open the settings page. Because the module uses `useAsConfig: true`, it has no link in the Confluence admin sidebar. Use admin.atlassian.com > Apps > Sites > one-atlas-obka > **Connected apps** > The Page Is Lying > "..." > **Configure**, or go straight to `https://one-atlas-obka.atlassian.net/wiki/admin/forge/apps/49ffa6f4-93eb-41fb-8f2a-6a087aac4ac0/0c74f1a8-63ff-4d71-a7f4-8a956c65c6dd/runbook-settings`. Record: page opens yes or no.
3. [ ] Enter repository URL `https://github.com/himanshu748/payments-api-demo`, branch `main`. Leave the GitHub token empty (the repo is public; 60 unauthenticated requests per hour are enough). Leave service hosts and Jira ids empty for now. Click **Save**.
   - Expected: "saved" and the status line changes to indexing, then ready.
   - In 2.2.0 this failed: the admin lookup `GET /wiki/rest/api/user/current?expand=operations` needs `read:confluence-user`, which the manifest lacked, and `forge logs` showed `NEEDS_AUTHENTICATION_ERR` (401) on every Save and Index now. 3.0.0 adds the scope. If Forge shows an "Allow access" prompt on the first Save, accept it (it is the app's consent for its manifest scopes) and record its exact wording.
   - If the page says "Settings could not be saved. The app could not confirm that you are a Confluence administrator...", reload, allow access when asked, and retry; then check `$FORGE logs -e development` for `NEEDS_AUTHENTICATION_ERR`.
4. [ ] Click **Index now**. Wait up to a minute; the status polls on its own.
   - Expected: ready, branch `main`, commit `0383355`, a file count, and coverage `complete` for routes, env and CLI.
   - If it shows an error, record the reason code (for example `rate_limited` or `repo_not_found_or_private`).
5. [ ] In a terminal run `$FORGE logs -e development` and confirm there is no error line from `index-repo-fn`.

## B. The page (about 3 minutes)

6. [ ] Open `https://one-atlas-obka.atlassian.net/wiki/spaces/EO/pages/6815745`. The six paragraphs sit inside the **Runbook check** macro.
   - If the macro shows as unknown or broken, the node was not recognised: remove it, type `/Runbook check` and re-insert it with the six paragraphs inside (see `demo/confluence/SEEDING.md`).
7. [ ] Expected counts: **2 Verified, 3 Contradicted, 1 No evidence found**.
8. [ ] The `POST /v1/charge` claim is red with the label "Contradicted" (not colour alone: icon, label, underline). Hover or focus it: the card says the repo has `POST /v2/payments` at `src/routes.ts:88` and shows a GitHub permalink. Press Escape to close it.
9. [ ] Check the other cards:
   - `GET /v2/payments/{id}`: green, `src/routes.ts:92`.
   - `STRIPE_KEY`: red, code reads `PAYMENTS_API_KEY` at `src/config.ts:8`.
   - `npm run db:migrate`: green, `package.json:18`.
   - `payments refund <paymentId> --force`: red, cites `src/cli.ts:10`, `:12`, `:13` (`refund` defines `--confirm` and `--reason`).
   - `ledgerctl reconcile --since 24h`: grey, "No evidence found ... not a confirmation".
10. [ ] Byline: the page header shows the app's byline item with counts after the page has been checked; click it and confirm the counts match. Record yes or no.
11. [ ] Run the keyboard-only pass: Tab to a claim, Enter or focus opens the card, Escape closes it.
12. [ ] Optional Jira draft: click "Draft Jira task" on the `STRIPE_KEY` card. Expected: the exact issue text is shown first and nothing is created until you click the confirm button. Do not confirm unless you want a real issue.

## C. Rovo agent (about 5 minutes)

13. [ ] On any Confluence page click **Ask Rovo**. In the agent picker look for **Runbook checker**. Record: visible yes or no.
14. [ ] Open the Payments API runbook page, select Runbook checker and ask **"Can I still call /v1/charge?"** (also try "Can I still call POST /v1/charge?").
    - Expected: starts "No, contradicted by code", cites `src/routes.ts:88` with an evidence id (`ev_...`), names `POST /v2/payments`, states the repository and the 7-character commit.
15. [ ] Ask **"Is this page still true?"**. Expected: counts 2 verified, 3 contradicted, 1 no evidence, repository and commit, then the contradicted claims first, and "no evidence found" described as not a confirmation.
16. [ ] In the terminal run `$FORGE logs -e development` and find the `check-page` and `page_read` lines. Record the `page_read` status:
    - `200`: `asUser()` works inside actions. Nothing more to do.
    - `401` or `403`: the user token is not available in actions. Implement the fallback in `docs/agent-eval.md` section 4 before showing the agent to anyone.
    - `page_read_threw`: same follow-up.
17. [ ] Red-team rows from `docs/agent-eval.md` section 6 (run in Rovo chat, then again in an MCP client). Record pass or fail per row in that file. At minimum run rows 1 to 6, 8, 9, 10, 12 and 14. Rows 12 and 13 use the injected page `demo/confluence/payments-api-runbook.injected.adf.json` and the repo copy in `demo/fixtures/injection`; seed them in a scratch space, not over the demo page.
18. [ ] Note whether the developer space name "LotZero" appears on the agent card in Rovo chat, on the Connected apps page, and on the OAuth consent screen in section D. Record yes or no per screen (see `docs/developer-space.md`).

## D. MCP tools (about 5 minutes)

19. [ ] Go to `https://admin.atlassian.com`, select the organisation, then **Apps**, **Sites**, `one-atlas-obka.atlassian.net`, **Connected apps**. Open "The Page Is Lying" (**View app details**). Under **TOOLS** ("Expose tools to MCP-compatible apps") click **Enable tools** and confirm. It is one switch for all tools, not per-tool checkboxes. MCP clients then list the tools as `check-page_development` and `check-claim_development`.
20. [ ] Connect a client:
    - Claude Code: `claude mcp add --transport http runbook-checker https://mcp.atlassian.com/forge/49ffa6f4-93eb-41fb-8f2a-6a087aac4ac0`, start Claude Code, run `/mcp`, authenticate, choose the site, approve the consent screen.
    - Cursor: add to `~/.cursor/mcp.json` the server `{"mcpServers": {"runbook-checker": {"url": "https://mcp.atlassian.com/forge/49ffa6f4-93eb-41fb-8f2a-6a087aac4ac0"}}}`, then connect it in Cursor's MCP settings and finish the same OAuth consent.
21. [ ] Ask the client: "Using runbook-checker, is page 6815745 still true?" and "Using runbook-checker, can I still call POST /v1/charge?". Expected: the same cited answers as steps 14 and 15. In `$FORGE logs -e development` the `check-page` line shows `"source":"input"` (an MCP client has no page context).
22. [ ] Row 17 of the red-team table: ask for a URL on another host (`https://evil.example.com/wiki/spaces/A/pages/1/T`). Expected: `invalid_input`, no read.

## E. Fix the page and watch it turn green (about 2 minutes)

23. [ ] Edit the page. Change `POST /v1/charge` to `POST /v2/payments` inside the macro. Publish.
24. [ ] Reload. Expected: the first paragraph is green with `src/routes.ts:88`, counts **3 Verified, 2 Contradicted, 1 No evidence found**, and the byline counts follow.
25. [ ] Ask Rovo "Can I still call POST /v2/payments?". Expected: "Yes, verified in code" with the citation.
26. [ ] Optional: change it back so the demo can be recorded again (or keep a second copy of the page).

## F. Stale index and limits (optional, 3 minutes)

27. [ ] Push a trivial commit to `himanshu748/payments-api-demo`, then within 15 minutes open the page and ask Rovo again. Expected: the answer says the index is stale and gives the indexed commit; after the background reindex a reload shows the new commit.
28. [ ] Open the settings page and confirm the token field shows only "saved" or "not saved", never the token.

## Record results

| Step | Result (pass, fail, note) | Date |
|---|---|---|
| A3 save settings | | |
| A4 index now | | |
| B7 counts 2/3/1 | | |
| B8 red card cites `src/routes.ts:88` | | |
| C14 Rovo answer | | |
| C16 `page_read` status | | |
| D21 MCP answer | | |
| E24 green after fix | | |
