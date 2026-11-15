# Seeding the "Payments API runbook" page

The app never writes pages. Seeding is a one-off step you run yourself.

## Seeded page (done on Nov 15, 2026)

- Site: https://one-atlas-obka.atlassian.net, space `EO` (Employee Onboarding, an existing global space)
- Page id: `6815745`
- URL: https://one-atlas-obka.atlassian.net/wiki/spaces/EO/pages/6815745
- Body: `payments-api-runbook.adf.json`, with the six runbook paragraphs inside a `bodiedExtension` for the Runbook check macro. The API accepted it and a read-back shows the extension node with key `49ffa6f4-93eb-41fb-8f2a-6a087aac4ac0/0c74f1a8-63ff-4d71-a7f4-8a956c65c6dd/static/runbook-check` (app id / development environment id / `static` / macro module key).

Whether Confluence renders that node as the live macro depends on the app being installed in the development environment with the `runbook-check` module deployed (integration checks this). If the node shows as an unknown or broken macro, use the manual steps below.

## Script

```sh
ATLASSIAN_EMAIL=you@example.com ATLASSIAN_TOKEN_FILE=/path/to/token-file \
  node demo/confluence/seed-page.mjs [--plain] [--fixed] [--space KEY]
```

- Uses Confluence REST v2 with basic auth (email plus API token read from a file; never printed).
- Picks the first global space unless `--space` is given. It is idempotent: if a page with that title exists in the space it prints the id and exits.
- `--plain` creates the page with the runbook paragraphs and no macro. `--fixed` uses the fixed text.
- The extension key contains the development environment id (`forge environments list`). For another environment or app, edit the key in the ADF files.

## Manual steps (fallback, or for the production environment)

1. Create a page titled `Payments API runbook` in any space.
2. In the editor type `/Runbook check` and insert the macro (it is a bodied macro, so it shows an editable body).
3. Type the six paragraphs inside the macro body, with the claims as inline code (Ctrl/Cmd+Shift+M or backticks):
   1. To take a payment, call `POST /v1/charge` with the amount in cents.
   2. To look up a payment, call `GET /v2/payments/{id}`.
   3. Set `STRIPE_KEY` before starting the service.
   4. Run `npm run db:migrate` before each deploy.
   5. To force a refund, run `payments refund <paymentId> --force`.
   6. Reconcile with `ledgerctl reconcile --since 24h`.
4. Publish. For the fix scene, change claim 1 to `POST /v2/payments` and publish again.

## Files

| File | Use |
|---|---|
| `payments-api-runbook.adf.json` | Broken page (2 verified, 3 contradicted, 1 no evidence). |
| `payments-api-runbook.fixed.adf.json` | Claim 1 is `POST /v2/payments` (3 verified, 2 contradicted, 1 no evidence). |
| `payments-api-runbook.injected.adf.json` | Broken page plus a paragraph addressed to the agent. Verdicts must not change. |
| `expected-results.json`, `expected-results.fixed.json` | Verdict and evidence file and line per claim, for the golden test and integration. |
