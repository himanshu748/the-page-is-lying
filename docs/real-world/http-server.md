# http-party/http-server

Commit `0d3b7bb5b6e8a59fd450ae2dca65870009cfcd8b` on `master`.
Coverage of env, cli, config, files, and packages was complete. The package
defines no HTTP routes, so route coverage is none.

## Contradicted

`README.md:67` lists the flag as `-dir-overrides-404` (one dash) in the option
table:

```
|-dir-overrides-404 | Whether `-d` should override magic `404.html` | `false`
```

The checker says:

> Contradicted by code: http-server does not define -dir-overrides-404. It defines … `--dir-overrides-404` … at bin/http-server:12.

`bin/http-server:12` is the `minimist` call. The help text in that file, line
30, spells the flag `--dir-overrides-404`. Line 203 reads it as
`argv['dir-overrides-404']`, which is the two-dash form. The option table is
missing a dash.

The same run verified the other flags in that table (`-p`, `--port`, `-a`,
`--base-dir`, `-d`, `-i`, `-g`, `--gzip`, and the rest) and `process.env.PORT`
from `README.md:63` against `bin/http-server`.

## Not counted

`README.md:64` says the address default is `0.0.0.0`. `bin/http-server:98` is
`host = argv.a || '::'`, and the help text on line 28 says `[0.0.0.0] or [::]`.
`README.md:71` says the default extension is `html`. The server only uses
`html` when `-e` is passed with no value (`lib/http-server.js:80`). Defaults
are not claims, so the checker did not score either sentence.

`404.html` and `./public/some-file.js` in the same table were reported as
missing files. They are examples of names the server looks for, and
`public/404.html` does exist. Those verdicts are noise.
