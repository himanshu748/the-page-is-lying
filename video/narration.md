# Narration script: The Page Is Lying (Codegeist 2026 demo)

Voice: Deepgram Aura-2 `aura-2-thalia-en`. One TTS call per scene (`video/narration/sNN.txt`). Scene timing in the composition follows the generated audio length.
Wording rules: "verified in code", "contradicted by code", "no evidence found". No other verdict words.

## s01 Problem
Runbooks drift from the code, and nobody notices until an incident. In the Q1 2025 SlashData developer survey, thirty-one percent of developers named insufficient or outdated documentation a top challenge. In organisations with over a thousand employees involved in software projects, it was forty-six percent. And Atlassian's State of Teams 2024 found that fifty-five percent of knowledge workers find it hard to track down information. A runbook you cannot trust makes that worse.

## s02 Setup
This is The Page Is Lying, a Forge app for Confluence. An admin points it at a public GitHub repository, here the payments API, and it indexes the code. The check is read-only, it runs on the Forge free tier, and there is no language model in the check. It is regular expressions and a code index.

## s03 The page
Here is a real runbook. The macro reads the claims in this section and compares each one with the code at a pinned commit. Two claims are verified in code, three are contradicted by code, and one has no evidence found. The first paragraph tells readers to call POST slash v1 slash charge. It is contradicted by code: no route matches, and the repository has POST slash v2 slash payments at src routes dot t s, line eighty-eight. The environment variable STRIPE underscore KEY is contradicted too. The code reads PAYMENTS underscore API underscore KEY at src config dot t s, line eight. The refund command with the force flag is contradicted: refund defines confirm and reason instead. Two claims are verified in code, with the file and line cited. The last one, ledgerctl reconcile, is grey. No evidence found. That is not a confirmation. Every state has an icon and a label, not just a colour.

## s04 Evidence card
Hover or tab to a claim and a card shows the evidence, with a permalink to the exact line on GitHub. Escape closes it.

## s05 Rovo
The same check is available in Rovo. The Runbook checker agent can only report what its read-only action returned. I ask, can I still call POST slash v1 slash charge? The answer: no, contradicted by code. No route matches. The repository has POST slash v2 slash payments at src routes dot t s, line eighty-eight, with an evidence id, the repository, the commit, the counts and the coverage limits.

## s06 MCP
The app also exposes two read-only tools through a Forge MCP server. Here is MCP Inspector, signed in over OAuth. It lists check-page and check-claim, and returns the same verdicts, the same file and line, and the same evidence ids. Same tool, same evidence, any MCP client.

## s07 Fix
Now we fix the page. Change the first claim to POST slash v2 slash payments, publish, and reload. That paragraph is verified in code, citing src routes dot t s, line eighty-eight. The counts are now three verified, two contradicted by code, and one with no evidence found.

## s08 Jira
For a contradicted claim you can draft a Jira task. The app shows the exact issue text first, and nothing is written until you click confirm.

## s09 Close
Deterministic, cites file and line, read-only, and it works on any public GitHub repository. The Page Is Lying. Documentation that checks itself against the code.
