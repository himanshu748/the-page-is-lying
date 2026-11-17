# Privacy policy: The Page Is Lying

Last updated: 17 November 2026.

The Page Is Lying is a Forge app for Confluence. It checks claims in a page (HTTP endpoints, environment variables, CLI commands and flags, config keys, file paths, package versions) against the code in one repository that a Confluence administrator configures. This page describes what the app reads, what it stores and where that data goes. It is based on the app's manifest (`manifest.yml`) and source code in this repository.

## What the app reads

- **Confluence page content.** The body of a page that contains the Runbook check macro, of the page where the byline item is opened, or of a page that a user asks about through the Rovo agent or the MCP tools. Pages are read as the signed-in user, so Confluence only returns pages that user can already view. Scope: `read:page:confluence`.
- **The current user's Confluence record**, only on the app's settings page, to confirm that the user is a Confluence administrator before settings are saved or an index is started. Scope: `read:confluence-user`.
- **The configured repository.** The app downloads the repository archive and asks for the latest commit of the configured branch from GitHub (`api.github.com`, `codeload.github.com`) or Bitbucket Cloud (`api.bitbucket.org`, `bitbucket.org`). These are the only external hosts the app can contact. Page content is never sent to them.

## What the app stores

All data is kept in Forge hosted storage (the Key-Value Store) on Atlassian's infrastructure, in the partition of the site where the app is installed. Scope: `storage:app`. The app stores:

- **Site settings:** repository URL, branch, optional service hosts, and optional Jira project and issue type ids.
- **An optional repository access token**, if an administrator enters one. It is kept with Forge secret storage, is never shown again, is never sent to the browser or to an agent, and is only sent to the repository host.
- **The code index** built from the repository: names of routes, environment variables, CLI commands and flags, config keys, file paths and packages, with file names, line numbers and short code excerpts.
- **Index status:** state, commit, timestamps, file counts and a short error code.
- **The latest commit seen** for the configured branch, kept for up to one day.
- **Claim counts per page:** the number of verified, contradicted and unknown claims for a page id and version, used by the byline item.

The app does not store page text, user names, email addresses or account ids.

## What the app does not do

- It stores no personal data.
- It has no analytics, tracking or advertising.
- It shares no data with third parties. The only external requests go to the repository hosts listed above, to fetch code.
- It writes nothing to Confluence or Jira. The optional Jira draft only opens Jira's own create screen with the text filled in; the user decides whether to create the issue.
- It uses no language model in the check. When a user asks the Rovo agent, Atlassian Rovo phrases the answer from the result the app returns.

## Logs

The app writes operational log lines to Forge logging on Atlassian's infrastructure. They contain event names, page ids and HTTP status codes, never page text, titles or tokens.

## Retention and deletion

Data stays in Forge storage while the app is installed. An administrator can replace the settings or remove the token at any time from the settings page. When the app is uninstalled, Atlassian soft-deletes the app's storage for that site and then destroys it at the end of Atlassian's retention period, as described in [Data lifecycle for Forge-hosted storage](https://developer.atlassian.com/platform/forge/storage-reference/hosted-storage-data-lifecycle/).

## Contact

Questions or requests: open an issue at https://github.com/himanshu748/the-page-is-lying/issues.
