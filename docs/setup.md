# Set up The Page Is Lying

## Judge setup

[Install on Confluence](https://developer.atlassian.com/console/install/49ffa6f4-93eb-41fb-8f2a-6a087aac4ac0?signature=AYABePL2xV9xjDb%2BabY%2FKJA8TaMAAAADAAdhd3Mta21zAEthcm46YXdzOmttczp1cy13ZXN0LTI6NzA5NTg3ODM1MjQzOmtleS83MDVlZDY3MC1mNTdjLTQxYjUtOWY5Yi1lM2YyZGNjMTQ2ZTcAuAECAQB4CxqLTo9l4lqXuFjNim1xJM%2Bp%2F3TVP9xHS2BrU5DRRucBJvE%2BVKNLIMGitmiSj4mo1AAAAH4wfAYJKoZIhvcNAQcGoG8wbQIBADBoBgkqhkiG9w0BBwEwHgYJYIZIAWUDBAEuMBEEDLx939ZsZeaijjKclgIBEIA75PYe66AVXchPBvFYZGZ6RpV2qg938MuNIm1YnNOnElpMmx%2FYysctVAqAcilhLPjAt1hq%2B02FG4bTUyIAB2F3cy1rbXMAS2Fybjphd3M6a21zOmV1LXdlc3QtMTo3MDk1ODc4MzUyNDM6a2V5LzQ2MzBjZTZiLTAwYzMtNGRlMi04NzdiLTYyN2UyMDYwZTVjYwC4AQICAHi9bVMAkme4qVQX1fQHo6ePw3H40A7cGfz7yrmSfBWMXgEulkTgaS9JUjTYO9cXswquAAAAfjB8BgkqhkiG9w0BBwagbzBtAgEAMGgGCSqGSIb3DQEHATAeBglghkgBZQMEAS4wEQQMfkteS1PqTPg5RzmrAgEQgDuvnEE0daVowBl1gRFACvqw4hbVNuTaanztMGjgJdsp6SmGqX6X8g1AS0U7787Lx9nBeFEYkNxkG8ws%2FgAHYXdzLWttcwBLYXJuOmF3czprbXM6dXMtZWFzdC0xOjcwOTU4NzgzNTI0MzprZXkvNmMxMjBiYTAtNGNkNS00OTg1LWI4MmUtNDBhMDQ5NTJjYzU3ALgBAgIAeDYASx0XCjkny4iLV6vz%2BKtEGSGT6kdt0QRpkn6D%2FlVEAU6KeoDU2JZ1u08L6bYqHukAAAB%2BMHwGCSqGSIb3DQEHBqBvMG0CAQAwaAYJKoZIhvcNAQcBMB4GCWCGSAFlAwQBLjARBAwwuh7aFba8s9D5yb8CARCAO%2Bnt4UNPgS3hrZOF8iMbxRnJj6Hm7Vz5mGk6%2BTLKRDBKLP4egurBHNOtoG9zgtNBz1ZrqfSSgCj4Yv%2FLAgAAAAAMAAAQAAAAAAAAAAAAAAAAAHZ7D8%2B%2FqGvAYC%2FDXNOCexb%2F%2F%2F%2F%2FAAAAAQAAAAAAAAAAAAAAAQAAADKJjuA2IkucvsdF0rCWjg1qStMzoFHgDwYkMEBplMBdjoP%2B3A8ISh1Yp1lWf4MVnMRlryC7m9ZOJqynX3y%2Bp00Yqx8%3D&product=confluence). You need to be an administrator on
a Confluence Cloud site.

1. Open **Get started** after installation. Choose **Use the demo repository**,
   save the settings and start indexing. The [public demo repository](https://github.com/himanshu748/payments-api-demo)
   works without a token.
2. Create a Confluence page, insert the **Runbook check** macro and paste the
   sample from **Copy sample runbook**. Publish and hover or focus a
   contradiction to see its source line.
3. Ask **Runbook checker** in Rovo whether the page is still true. To see the
   verdict change, replace the sample's `POST /v1/charge` with
   `POST /v2/payments` and publish again.

The [demo fixtures](../demo/README.md) and [seeding guide](../demo/confluence/SEEDING.md)
contain the exact examples. See the [verification results](integration-results.md)
and the [video](https://www.youtube.com/watch?v=GAsxA1YAr-4).

## Development

Use Node 22 or newer for the local checks and Node 24 for Forge CLI 15.
Run the following from the repo root:

~~~sh
npm ci
npm run typecheck && npm run lint && npm test
npm run build:ui
npx playwright install chromium
npm run test:e2e
~~~

For a live test, sign in with the Atlassian Forge CLI, build the UI, and run
`forge deploy -e development` and `forge install -e development -p confluence`.
After a scope change, upgrade the existing installation. Use `forge logs -e development`
for runtime logs. `forge register` creates a new app ID and does not transfer an
existing installation.

## Repository settings

Under **Manage apps**, choose **The Page Is Lying → Configure**. Set a GitHub or
Bitbucket Cloud repository and a branch. For GitHub, an optional read-only token
raises the rate limit and allows private repositories. Save and click **Index now**,
then check the displayed commit and coverage.

A scheduled job refreshes the index. To trigger it from repository pushes,
configure the `repo-push` web trigger and set `WEBHOOK_SECRET` as a Forge
variable. GitHub uses its signed webhook header. The trigger reads the
repository coordinates from the saved settings.

## External MCP clients

On the authorized Confluence site where the app is installed, a site or
organization administrator opens **Atlassian Administration → Apps → Sites →
the site → Connected apps → The Page Is Lying → View app details**. Under
**Tools**, select **Enable tools** and confirm. Atlassian saves this setting
per installation. If the panel offers individual tool controls, enable the
five below.

| Tool | What it returns |
| --- | --- |
| `check-page` | Checks an accessible Confluence page against the repository index. |
| `check-claim` | Checks one claim against the index. |
| `explain-claim` | Explains the verdict and its supporting evidence. |
| `suggest-fix` | Returns a grounded correction for a contradicted claim. |
| `audit-space` | Summarizes findings across accessible pages in a Confluence space. |

In Claude Code, add the server and open `/mcp` in a new session.

~~~sh
claude mcp add --transport http runbook-checker https://mcp.atlassian.com/forge/49ffa6f4-93eb-41fb-8f2a-6a087aac4ac0
~~~

Complete Atlassian OAuth in the client. Select the same Confluence site and
review the consent screen. In the client, select `runbook-checker` and compare
the discovered tool list with the five keys above. In MCP Inspector, the
equivalent is **Tools → List Tools** on the Streamable HTTP connection to the
same endpoint. Record any environment suffix on the returned tool names.
Run Inspector and its OAuth browser on the same computer so Atlassian can
return to Inspector's local callback.

If you configure OAuth scopes manually, include Atlassian's required
`read:me`, `read:account` and `offline_access` scopes alongside the
Confluence scopes the client needs. The last scope lets the client refresh its
grant. [Atlassian OAuth troubleshooting](https://support.atlassian.com/rovo/kb/mcp-v2-oauth-required-base-scopes-for-custom-clients/).

The app's tools are read-only and use the caller's page permissions. The
Atlassian gateway consent screen may list broader permissions than the app
uses. See the
[consent screenshot](screenshots/mcp-oauth-consent-production.png) and the
[five-call verification](agent-eval.md#3-mcp-server-fresh-install-checklist).

[Privacy policy](../PRIVACY.md)
