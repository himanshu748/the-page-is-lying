# pallets/flask

Commit `49943b5a94413a530761350f04e896f76e8d620e` on `main`.
Package coverage was complete. Route, env, and cli coverage were partial, so
those claims stay unknown instead of contradicted.

## Verified

`docs/installation.rst:8`:

> Flask supports Python 3.11 and newer.

Verdict: verified, `package_range_intersects`, citing `pyproject.toml:22`:

```
requires-python = ">=3.11"
```

"and newer" is read as `>=3.11`. An interpreter banner in `docs/cli.rst`
(`Python 3.10.0 (default, Oct 27 2021, …)`) is sample output from `flask shell`,
not a support claim, and is not extracted.

## Deliberately outdated minimum

The live replay also changes that sentence locally to say Python 3.10 and
newer. The checker flags the unsupported 3.10 minimum and suggests
`Python >=3.11`, citing the same manifest line.

## Why the rest is unknown

Flask registers commands and configuration dynamically, and the repository
contains source the route and env indexers do not model. One partial kind
blocks a contradiction for every claim of that kind. A stale `FLASK_ENV`
mention would come back unknown, not contradicted, even if the name is gone.
The hundreds of "missing file" hits in the docs are example paths (`hello.py`,
virtualenv scripts, and so on), not a list of broken links.
