# Bonus assessment: Teamwork Graph and Marketplace

Question: can the Teamwork Graph and Marketplace bonuses (Codegeist 2026) be reached on the free tier without hurting the core? Nothing here is implemented.

**Source quality.** `https://codegeist2026.devpost.com/rules` and the main contest page returned HTTP 403 to the research fetch on Nov 15, 2026, so the rules text could not be read directly. The facts below come from the Atlassian developer community announcement and a third-party article that quotes the rules (links at the end). **Read https://codegeist2026.devpost.com/rules yourself before deciding**; every row marked "unconfirmed" depends on that.

## What the rules say (secondary sources)

- Four bonus prizes of $1,500, six winners each: Best Rovo Agent, Best MCP App, Best Teamwork Graph Integration, Best Marketplace Published App. One submission can win at most one grand prize and one bonus prize.
- Best Rovo Agent and Best MCP App are what the app already targets (`rovo:agent`, `rovo:mcp`). Note the "at most one bonus" limit: entering all four does not stack.
- Teamwork Graph bonus: the app "connects data into the graph and/or consumes data from" the Teamwork Graph API. The API went to Preview on Oct 15, 2026 and uses curated GraphQL queries with per-object scopes such as `read:graph:issue:jira`.
- Marketplace bonus: the app is published to the Marketplace or submitted for listing. A live, approved listing is probably not required (unconfirmed); the entry may need the listing link or the review ticket.
- Judging stage 1 is pass or fail on theme fit and use of the required APIs; stage 2 scores five equal criteria. Judges must be able to install the app from an installation link.
- Submission closes Dec 22, 2026 at 12:00 PM PT (Dec 23, 1:30 AM IST per the task brief matches: 20:00 UTC).

## Teamwork Graph

| | |
|---|---|
| Fit with the product | Moderate. Runbook claims name services, repos and people, and the graph could link a page to related Jira issues or Bitbucket and GitHub repositories (for example to pick the repo for a page instead of a single site-wide setting). It is not needed for the core check. |
| Free tier | Unclear. A third-party test reports curated queries worked on a free developer site and that no allowlisting was needed after the Oct 2026 Preview; two older doc pages still mention allowlisting or EAP. Installing an app with graph scopes needs an organisation admin. Unconfirmed whether a judge's test site can call it without EAP (open question in the community, no Atlassian answer seen). |
| Effort | 1.5 to 3 days: add granular scopes, a small graph client behind the same `RepoSource`-style interface, a "related repositories and issues" suggestion in settings or the evidence card, tests with a fake client, and manifest and consent changes. |
| Risk to the core | Real. New scopes force a major version bump and a re-consent on every install, change what judges see on the consent screen, and add a Preview API that can change before the deadline. A failing graph call must never affect verdicts, so it has to be strictly optional. |
| Benefit | A $1,500 bonus and a stronger "uses Atlassian data" story, but only one bonus can be won per submission, and the Rovo and MCP bonuses are already the stronger fit. |

## Marketplace

| | |
|---|---|
| Fit with the product | Good as a story (a real installable app), but it is process work, not product work. |
| Free tier | Listing itself has no fee, but a Marketplace listing needs a published developer space and vendor profile (name and contact email become public and cannot be unpublished), a privacy policy and support contact, security and listing review, and a production deploy. Forge apps submitted for listing cannot also be shared by an installation link, so judges would need a **second, unlicensed copy** of the app with the install link (reported by a third-party article quoting Atlassian's distribution docs; confirm in the docs). Two apps double the production deploys and the consent steps. |
| Effort | 1 to 2 days of owner time (listing text, screenshots, privacy and support pages, vendor profile) plus waiting on review, plus the second app. The review may not finish before Dec 22. |
| Risk to the core | Low for code, but it touches the developer space question: publishing the space makes its name public. See [developer-space.md](developer-space.md). Production deploys need the owner's approval. |
| Benefit | A $1,500 bonus if "submitted for listing" is enough. The same one-bonus limit applies. |

## Recommendation

1. **Do not implement Teamwork Graph.** It adds a Preview dependency, new scopes and consent changes for a bonus the submission cannot stack with Rovo or MCP, and the core does not need it. Revisit only if the core is finished, all browser checks in [integration-checklist.md](integration-checklist.md) pass, and the rules page confirms a free-tier judge site can call it.
2. **Marketplace is optional and mostly owner work.** If you want the bonus, decide the developer space first (use a space whose public name you are happy with), read the rules page for what "submitted for listing" requires, and start the listing early because review time is outside your control. Keep the judge install link on the unlisted copy of the app as the rules require.
3. Put effort into the two bonuses already targeted (Rovo agent and `rovo:mcp`): a clean demo, the red-team checklist, and the production install link.

## Sources

- Codegeist 2026 announcement: https://community.developer.atlassian.com/t/heads-up-developers-codegeist-2026-is-officially-open/103506
- Third-party summary of the rules and Teamwork Graph Preview: https://dev.to/mihai_leanzero/atlassian-teamwork-graph-api-forge-rovo-agent-3mcc
- Community questions without Atlassian answers: https://community.developer.atlassian.com/t/codegeist-2026-judges-environment-preview-modules-and-teamwork-graph-data-over-mcp/103763 and https://community.developer.atlassian.com/t/codegeist-2026-is-rovo-on-judges-test-sites-and-can-an-install-link-app-call-teamwork-graph-preview-without-eap/103827
- Rules (not readable by the fetch tool, HTTP 403): https://codegeist2026.devpost.com/rules
- Forge publishing and developer space docs: https://developer.atlassian.com/platform/forge/developer-space/publish-developer-space/
