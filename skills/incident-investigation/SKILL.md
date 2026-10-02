---
name: incident-investigation
description: Investigate a Better Stack incident, alert or outage report end to end. Find the incident, check who is on call, pull the logs, traces, metrics and errors around it, correlate with recent releases, and post a short situation report. Use when someone asks why something is down or slow, mentions a Better Stack incident or monitor, or when Claude is working as an on-call first responder in an incident channel (for example in Claude Tag).
---

# Investigate an incident with Better Stack

You are the first responder. Your job is to tell the humans what is broken, since when, how bad it is, and the most likely cause, backed by data from Better Stack. Stay read-only unless someone in the thread explicitly asks you to act.

## 1. Find the incident

- If you were given an incident link or ID, call `incident` and `incident_timeline` with it.
- Otherwise call `incidents` with `status: ["ongoing", "acknowledged"]`. Narrow the list with `cause` (a substring of the alert text), `monitor_id` or `from`/`to`.
- For a monitor-triggered incident, call `monitor` for its URL, regions and check type. Then call `monitor_response_times` and `monitor_availability` to see whether the problem is total, regional or only latency.
- Call `incident_comments` to see what the team already knows. Don't repeat it.

## 2. Check who is involved

- Call `on_calls` (and `on_call` for a calendar) to see who is on call right now.
- If the incident is escalating, call `escalation_policy` to see who gets paged next and when.

## 3. Pull the telemetry around the start time

Use a window from about 30 minutes before the incident started until now.

- **Errors:** call `applications` to find the affected app, then `errors` with `start_time` set to the window. Look for error patterns that are new or reoccurred inside the window (`state: "new"` or `"reoccurred"`). Call `error` on the top one for the stack trace and affected users.
- **Logs and traces:** call `sources` to find the service's log or span source. Call `query_help` with that source before you write SQL, then run `query`. Start with counts by level or status code per minute, then read sample error lines. Use `query_windows` before querying more than a few hours.
- **Metrics:** call `metrics_schema` with a name filter (for example `*http*`, `*latency*`, `*cpu*`), then `metrics_query_help`, then `query`. Compare the incident window with the same window a day earlier.
- **Recent changes:** call `releases` for the application. A release shortly before the start time is the first suspect.

Prefer a few targeted queries over many broad ones. Every query must cover a bounded time range.

## 4. Write the situation report

Post one compact message:

- **Status:** what is broken and for whom, ongoing or recovering, when it started (UTC)
- **Impact:** affected monitors, regions, error counts and users, with numbers
- **Likely cause:** the strongest correlated signal (a release, an error pattern, a resource metric) and how confident you are
- **Evidence:** links to the incident, error and dashboard pages from tool results
- **Next steps:** what a human should check or do. Suggest, don't act.

Say clearly what you could not check (a missing source, a permission error) instead of guessing.

## 5. Act only when asked

Write tools change real state and notify people: `acknowledge_incident`, `resolve_incident`, `escalate_incident`, `create_incident_comment`, `create_status_page_report`. Use them only when a person in the thread asks for that specific action, and confirm what you did.
