---
name: slack-reports
description: Answer Better Stack questions in Slack (for example in Claude Tag) as a short report that Slack shows as a native table, instead of paragraphs or raw query output. Use when someone in a Slack channel or thread asks for numbers from Better Stack - incidents, uptime, errors, logs, metrics, traces, RUM or usage - or asks for a summary, a report or a table.
---

# Better Stack reports in Slack

People read Slack on phones, between other messages. Give them the answer in the first line and the numbers in one table they can scan, then let them open Better Stack for the rest.

## Shape of the reply

1. **One line with the answer**, the key number in bold and the time range in UTC: "**27,404** requests in the last hour (13 Nov 09:00-10:00 UTC), **1.0%** errors, most of them from consul-server."
2. **One Markdown table** with the numbers behind it. In Slack, Claude's Markdown table shows as a native Slack table.
3. **One line on what stands out** or what to check next, if anything does.
4. **Links** to the Better Stack pages the tools returned (the incident, error, monitor or dashboard), so people can open the details.

Keep it to that. No headings, no SQL, no JSON, no lists of what you queried. Say what you couldn't check (a missing source, a permission error) in one line.

## The table

- One table per reply, unless someone asks for more.
- At most 5 columns and about 15 rows. Sort by what the question is about (most errors first, slowest first) and say how many rows you left out: "…and 12 more services".
- Put the unit in the column name (`p95 (ms)`, `Error rate`), so cells hold only the value.
- Numbers: thousands separators (5,927), rates as percentages with one decimal (6.7%), durations in one unit per column. Slack aligns number columns to the right.
- Keep the name column short: drop the parts every row shares (`pokedex/Deployment/` in `pokedex/Deployment/rails-pokedex`).
- A trend over time is a table too: one row per hour or day, oldest first, with the change in the answer line ("up 40% since Monday").

## Example

> **266 errors** in the last hour (13 Nov 09:00-10:00 UTC), 1.0% of 27,404 requests. Most come from consul-server.
>
> | Service | Requests | Errors | Error rate | p95 (ms) |
> | --- | --- | --- | --- | --- |
> | postgres-db-2 | 5,927 | 0 | 0.0% | 476 |
> | gitlab | 5,832 | 0 | 0.0% | 42 |
> | consul-server | 3,582 | 241 | 6.7% | 8,762 |
> | nodejs-pokedex | 1,973 | 21 | 1.1% | 16 |
>
> consul-server is also the slowest, with p95 at 8.8 s. …and 4 more services, all under 1% errors.

## Incidents

When you are investigating an incident, the `investigate-incident` skill decides what the report says. Use a table from this skill for its evidence, such as errors per service or response times per region.
