# Public repository checks

The checker was run locally against three public repositories and their own
docs, pinned to the commits below. The index and the claim extractor are the
ones in this repository. A whole README is one text block and keeps 20 claims;
a Confluence page is one block per paragraph or code block, so a fenced command
was also checked on its own where the cap would have dropped it.

| Repository | Commit | What was checked | Result |
|---|---|---|---|
| [http-party/http-server](https://github.com/http-party/http-server) | `0d3b7bb5b6e8a59fd450ae2dca65870009cfcd8b` | Option table in `README.md` | `-dir-overrides-404` is contradicted. The other documented flags are defined. |
| [typicode/json-server](https://github.com/typicode/json-server) | `89a34a44b7a6a5311dc84f3b8a1b8b45c0905aea` | Route list and `json-server db.json -s` | Verified against the tinyhttp routes and `parseArgs`. |
| [pallets/flask](https://github.com/pallets/flask) | `49943b5a94413a530761350f04e896f76e8d620e` | `docs/installation.rst` | "Python 3.11 and newer" matches `requires-python`. |

## Run the three public examples

From the project root, install dependencies with `npm ci` and run:

```sh
LIVE_GITHUB=1 npx vitest run test/live/github.live.test.ts --reporter=default -t 'http-party/http-server|typicode/json-server|pallets/flask'
```

The replay fetches the documentation at each pinned commit and uses the app's
GitHub index job and claim checker. It prints a link to each checked document
line and its code citation. It covers the documented and corrected
`http-server` flag, JSON Server's nine route examples, a route with a query
string, its static-directory flag, and Flask's Python requirement. It uses
unauthenticated public GitHub requests.

Details: [http-server](http-server.md), [json-server](json-server.md), [flask](flask.md).

Example filenames the reader is told to create (`db.json`, `404.html`) still
come back as missing repository files. Those are not listed here as
contradictions. Documented default values, such as the address `0.0.0.0`, are
not a claim the checker scores.
