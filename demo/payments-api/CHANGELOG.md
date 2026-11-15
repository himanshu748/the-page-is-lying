# Changelog

## 2.0.0

- Moved payment creation from `POST /v1/charge` to `POST /v2/payments`. Lookups use `GET /v2/payments/:id`.
- Renamed the API key variable from `STRIPE_KEY` to `PAYMENTS_API_KEY`.
- Removed the `--force` flag from `payments refund`. Use `--confirm` and, optionally, `--reason`.
- Added the `db:migrate` script.

## 1.4.0

- Added refunds to the CLI.

## 1.0.0

- First release.
