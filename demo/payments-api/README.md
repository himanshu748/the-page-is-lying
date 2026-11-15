# payments-api

A small payments service written in TypeScript with Express. It is a demo repository for runbook checking and has no real payment provider behind it.

## Setup

```sh
cp .env.example .env
npm install
npm run build
npm run db:migrate
npm start
```

## Configuration

| Variable | Purpose |
|---|---|
| `PAYMENTS_API_KEY` | Key that callers send in the `x-api-key` header. |
| `DATABASE_URL` | Connection string for the payments database. |
| `PORT` | HTTP port. Defaults to 3000. |

## HTTP API

- `POST /v2/payments` creates a payment. The body has `amount` (integer, cents) and `currency`.
- `GET /v2/payments/:id` returns one payment.
- `GET /health` returns service status.

## CLI

```sh
npx payments refund <paymentId> --confirm --reason "duplicate"
```

## License

MIT
