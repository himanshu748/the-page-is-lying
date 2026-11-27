# typicode/json-server

Commit `89a34a44b7a6a5311dc84f3b8a1b8b45c0905aea` on `main`.
Route, env, cli, config, file, and package coverage were all complete.
`@tinyhttp/app` is indexed. `node:util` `parseArgs` is indexed. A dotted
filename in a command is an argument, so `-s` after `db.json` is still a flag.

## Verified routes

The route list in `README.md` matches the handlers in `src/app.ts`. Each path
is a parameter of `/:name` or `/:name/:id`, so `posts` and `profile` are the
same routes.

| Doc | Code |
|---|---|
| `README.md:139` `GET /posts` | `src/app.ts:123` `app.get('/:name', …)` |
| `README.md:140` `GET /posts/:id` | `src/app.ts:137` `app.get('/:name/:id', …)` |
| `README.md:141` `POST /posts` | `src/app.ts:143` `app.post('/:name', …)` |
| `README.md:142` `PUT /posts/:id` | `src/app.ts:147` `app.put('/:name/:id', …)` |
| `README.md:143` `PATCH /posts/:id` | `src/app.ts:151` `app.patch('/:name/:id', …)` |
| `README.md:144` `DELETE /posts/:id` | `src/app.ts:153` `app.delete('/:name/:id', …)` |
| `README.md:152` `GET /profile` | `src/app.ts:123` |
| `README.md:153` `PUT /profile` | `src/app.ts:145` `app.put('/:name', …)` |
| `README.md:154` `PATCH /profile` | `src/app.ts:149` `app.patch('/:name', …)` |

Query strings are stripped before the match, so `GET /posts?_page=1&_per_page=10`
is the same route.

## Verified flag

Checked as its own code block, which is how the macro sees a fenced command:

```bash
json-server db.json -s ./static
```

`README.md:248`. Verdict: verified, `cli_defined`, citing `src/bin.ts:43`.
That is the `parseArgs` options object. `static` is declared there with
`short: "s"` at `src/bin.ts:53`.

The replay also checks that `extractClaimsFromText` finds the command in the
full pinned README. The fence has its own claim budget, as it does in the
Confluence page checker.

## Not a contradiction

The README tells the reader to create `db.json`. The checker reports that path
as absent and points at `fixtures/db.json`. That is an instruction, not a stale
path. `package.json:73` requires Node `>=22.12.0`. The README never states a
Node version, so there was no version claim to check.
