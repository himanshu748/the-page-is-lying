# Demo fixture

| Path | Purpose |
|---|---|
| `payments-api/` | Source of the public demo repo. Line 88 of `src/routes.ts` is `router.post('/v2/payments', createPayment);` and line 92 is `router.get('/v2/payments/:id', getPayment);`. Asserted by `test/demo/fixture-contract.test.ts`. |
| `confluence/` | Runbook page as ADF (broken, fixed, injected), expected results, seeding notes and script. |
| `fixtures/injection/` | Copy of the service with prompt-injection comments, plus the injected page. Test data only. |

## Public demo repo

- URL: https://github.com/himanshu748/payments-api-demo
- Branch `main`, commit `44c8112e1bc0f3be63fe45fbcb70bfaf6bfb03a5` (own history; this app repo is not pushed).
- Line 88 re-checked on GitHub after the push.

## Evidence map (lines in `demo/payments-api`)

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | `POST /v1/charge` | contradicted | nearest route `POST /v2/payments`, `src/routes.ts:88` |
| 2 | `GET /v2/payments/{id}` | verified | `src/routes.ts:92` |
| 3 | `STRIPE_KEY` | contradicted | code reads `PAYMENTS_API_KEY`, `src/config.ts:8` |
| 4 | `npm run db:migrate` | verified | `package.json:18` |
| 5 | `payments refund <paymentId> --force` | contradicted | `refund` defined at `src/cli.ts:10`, options `--confirm` (12) and `--reason` (13) |
| 6 | `ledgerctl reconcile --since 24h` | no evidence found | `ledgerctl` is not defined in the repo |

`payments-api/CHANGELOG.md` mentions the old names (`/v1/charge`, `STRIPE_KEY`, `--force`) on purpose, as human release notes. It is documentation, not code evidence; indexers should not treat it as a route, env or CLI source.
