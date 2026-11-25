# The Page Is Lying

**Runbooks go stale when nobody checks them against the code.**

<img src="docs/screenshots/page-counts-2-3-1.png" width="640" alt="Confluence runbook check with verified, contradicted, and unknown claims">

The Page Is Lying checks Confluence runbook claims against a repository and
cites the file and line behind each verdict. Check a section with the macro,
a whole page from its byline, or a space from the drift view.

## How it uses Atlassian

Forge connects Confluence to the repository index. Rovo calls the same check
service as the macro, and Atlassian MCP exposes read-only tools for checking
pages and explaining or fixing claims. The verdict comes from the code index.
The tools are `check-page`, `check-claim`, `explain-claim`, `suggest-fix`, and `audit-space`.

## Quickstart

From a fresh clone with Node 22 or newer:

~~~sh
npm ci && npm run build:ui
~~~

For a live run, [install and open the sample runbook](docs/setup.md#judge-setup).

[Video](https://www.youtube.com/watch?v=GAsxA1YAr-4) ·
[Devpost](https://devpost.com/software/the-page-is-lying) · [MIT](LICENSE)

[Architecture](docs/architecture.md) · [Setup and MCP](docs/setup.md) ·
[Verification](docs/integration-results.md) · [Privacy](PRIVACY.md)
