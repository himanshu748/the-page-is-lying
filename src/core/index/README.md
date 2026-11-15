# Repo index: conventions for the matcher

`buildRepoIndex(files, { repo, stats, treePaths })` (or `createIndexBuilder()` for streaming) returns a `RepoIndex`
(`src/core/model.ts`). Entry conventions the matcher can rely on:

- **Routes.** `path` is normalized like `HttpEndpointClaim.path` (`normalizeRoutePath` in `paths.ts`: params become
  `:param`, no query or trailing slash). Mount prefixes (Express `app.use('/api', router)` across files, FastAPI
  `include_router(prefix=)`, Flask blueprints, Fastify `register({prefix})`, Hono `route()` and `basePath`, Koa
  `prefix`, Gin groups) are already applied. A router whose mount cannot be found is dropped and `coverage.routes`
  becomes `partial`. `method: 'ANY'` means any method (`app.all`, `http.HandleFunc("/x")`, `@RequestMapping`
  without a method). `line` is the line where the registration call starts. OpenAPI operations use
  `framework: 'openapi'` and the line of the method key.
- **Env.** `name` as written. `source` is `code`, `env_example`, `compose` or `kubernetes`. Any dynamic read
  (`process.env[x]`, `os.environ[var]`, whole-object passes, pydantic `BaseSettings`, Spring `@Value`) makes
  `coverage.env` `partial`. `none` means no env name was found at all.
- **CLI.** All commands have `--help` and `-h` in `flags`; commander and yargs roots also have `--version`
  (and `-V` for commander).
  - Source-defined commands: `kind: 'command'`, `program` is the CLI name (`.name()`, `prog=`, cobra root `Use`,
    else the single `bin` name, else the package name, else the file name), `subcommands` is the path below the
    root (`['refund']`), `flags` lists long and short flags without values. Aliases get their own entry.
  - `package.json` `bin`: `kind: 'bin'`, `subcommands: []`, `flags: []`. pyproject scripts the same.
  - `package.json` script `db:migrate`: `program: 'npm'`, `subcommands: ['run', 'db:migrate']`, `kind: 'script'`,
    `flags: []`. Scripts named `test`, `start`, `stop`, `restart` also get `subcommands: [name]`. Treat
    `yarn`, `pnpm` and `bun run x` as the same script. Script entries never list flags (arguments pass through),
    so a flag on a script is Unknown, not Contradicted.
  - Makefile target: `program: 'make'`, `subcommands: [target]`, `kind: 'make_target'`.
  - `addCommand`, executable subcommands, `commandDir`, `parents=` and non-literal names set `coverage.cli` to
    `partial`.
- **Config.** `keyPath` is dotted object keys (arrays are a leaf). `configFiles` lists parsed files. OpenAPI, Compose,
  Kubernetes, CI, lockfiles, `tsconfig*` and `package.json` are not config files.
- **Files.** `files` lists every path in the snapshot, including skipped and unread ones. A cut tree makes
  `coverage.files` `partial`.
- **Packages.** npm names as written; PyPI names are PEP 503 normalized (lowercase, `-`); Go module paths without
  `// indirect` entries; Maven names are `group:artifact`. `ecosystem: 'runtime'` has `node`, `npm`, `python`,
  `go`. `dev` is true for devDependencies, test scopes and optional/dev groups. `range` is as written
  (`==2.31.0`, `^4.18.2`, `*` when unpinned).
- **Coverage.** `none` = the kind has no entries and nothing dynamic was seen; `partial` = something dynamic,
  unsupported (a `.rs`, `.php`, `.cs`... file is present) or truncated; `complete` otherwise. A truncated snapshot
  makes every kind `partial`.

Repo text is untrusted: builders only scan and parse it. Nothing is evaluated, and route or env strings are never
used as regexes or hostnames. Snippets are the source line, trimmed, control characters removed, at most 160 chars.
