---
name: incident-investigation
description: Investigate a Better Stack incident, alert or outage report end to end. Find the incident, check who is on call, drill into the metrics, logs, traces and errors around it, correlate with recent releases, and post a short situation report. Use when someone asks why something is down, slow or erroring, mentions a Better Stack incident, monitor or alert, or when Claude is working as an on-call first responder in an incident channel (for example in Claude Tag).
---

# Investigate an incident with Better Stack

You are the first responder. Tell the humans what is broken, since when, how bad it is and the most likely root cause, backed by data from Better Stack. Stay read-only unless someone in the thread explicitly asks you to act.

## Core principle: drill down

Start broad, find the anomaly, then narrow the focus. Aggregated data hides details.

```
BROAD SCAN (hours/days) → FIND ANOMALY → NARROW WINDOW (minutes) → COMPARE WINDOWS
```

- Time-series queries aggregate into buckets, so a 2-minute spike disappears in 1-hour buckets. When something looks interesting, query it again with a narrower window and smaller buckets.
- Check metrics before logs. Metrics quickly show what is anomalous and when ("memory spiked at 14:32"). Use that timing to target the log search.

## Phase 1: Orient

- **Clarify the symptom:** slow, erroring, down, or intermittent?
- **Establish the timeline:** when did it start, and was it sudden or gradual?
- **Check the existing context:**
  - Given an incident link or ID, call `incident`, `incident_timeline` and `incident_comments`. Otherwise call `incidents` with `status: ["ongoing", "acknowledged"]`, narrowed with `cause`, `monitor_id` or `from`/`to`.
  - Call `chart_alerts` to see which telemetry alerts are firing.
  - For a monitor incident, call `monitor`, then `monitor_response_times` and `monitor_availability`, to tell a total outage from a regional one or a latency-only one.
  - Call `on_calls` and `on_call` to see who is on call. If the incident is escalating, call `escalation_policy` to see who gets paged next.
- Don't repeat what the incident comments already say.

## Phase 2: Scope

- Call `sources` to find the affected service's sources, then `source` for its details, and `source_fields` to see which fields exist.
- For errors, call `applications` and then `errors` for the affected application.

Form a hypothesis based on the symptom:

| Symptom | Primary suspects | Start with |
| --- | --- | --- |
| Slow responses | CPU, memory, DB queries, network | Metrics: latency, resource saturation |
| Errors / 5xx | App bugs, dependency failures, OOM | Errors → metrics → logs |
| Intermittent issues | Resource contention, connection limits, GC | Metric spikes + log correlation |
| Complete outage | Crash, network partition, config change | Monitor checks, recent log events |
| After a deploy | Recent code, config or dependency changes | `releases`, then the diff if GitHub is connected |

## Phase 3: Investigate

**Before writing any SQL, call the help tool for that data type.** The query syntax is specific and will fail without it:

- logs and spans: `query_help` (with `source_type: "logs"` or `"spans"`)
- metrics: `metrics_schema` (filter by name, e.g. `*latency*`, `*memory*`) and `metrics_query_help`
- errors: `errors_query_help` (for custom error analytics beyond `errors` and `error`)

Then run the SQL with `query`. Bound every query in time, and call `query_windows` before querying more than a few hours.

**Metrics:**
- Resource saturation: CPU, memory, disk, network
- Application: request rate, error rate, latency (p50/p95/p99)
- Dependencies: DB connection pool, queue depth

**Logs and spans:**
- Error clustering: which messages are new or spiking? Group by message or error type over time rather than reading raw lines first.
- Log level distribution: count by level per minute to find the error spike.
- Timeline reconstruction: what happened right before the symptom?
- Spans: latency and error rate by service and operation, to find the slow or failing dependency.
- If a filter (level, service) returns nothing, retry without it. Not every log has a level field, and service names vary. Never conclude "no errors" from one filtered query.

**Errors:**
- In `errors`, look for patterns that are `new` or `reoccurred` inside the window, then call `error` on the top ones for stack traces, releases and affected users.

**Recent changes:**
- Call `releases` for the application. A release shortly before the onset is the first suspect.
- If a GitHub connection is available, compare the code between the last good release and the first bad one.

## Phase 4: Conclude

**Five whys.** Keep asking why until the answer is actionable:

- ✗ "Connections timed out" → why?
- ✗ "Pool exhausted" → why?
- ✗ "Slow queries held connections" → why?
- ✓ "Missing index on users.email" → actionable

**Before concluding, verify:**
- The cause preceded the effect (check the timestamps).
- The mechanism is clear (an A → B → C chain).
- The alternatives are ruled out.
- The finding isn't also present in the baseline.

## Hypothesis discipline

- **Never work with a single hypothesis.** Generate 2–3 competing explanations before investigating. For each one, ask what would confirm it and what would disprove it.
- **Actively look for disconfirming evidence.** Finding what you expected proves nothing.

## Cross-verification

Never conclude from a single data source. Logs explain what happened; metrics confirm whether it happened and when.

- Redis OOM in the logs → did Redis memory actually spike in the metrics?
- DB timeouts in the logs → check the connection pool and DB latency metrics.
- CPU spike in the metrics → what triggered it in the logs (a deploy, a traffic spike)?
- Errors starting at 14:00 → check the releases around 14:00.

## Noise vs signal

| Finding | Verify with | It's noise if… |
| --- | --- | --- |
| Cron job in the logs | Count by hour over 24h | Same count every hour |
| Errors exist | Error-rate baseline | Errors are present in healthy periods too |
| CPU high | CPU, memory and GC timeline | CPU rose after memory |

**Rule: if it exists in the baseline, it's not the cause.**

When you have an anomaly window, compare three windows: **before** (what's normal), **during** (what's different) and **after** (did it recover, and is there a new steady state).

## When the investigation stalls

1. Wrong service? Check the dependencies and upstream services in the spans.
2. Wrong time window? Ask when it started.
3. Is aggregation hiding it? Use smaller buckets and specific hosts.
4. Metrics normal? Try the logs. Logs normal? Try the traces.

Don't hide dead ends, because ruling things out is progress. If you're stuck, say: "I've checked X, Y and Z, and all are normal. To go further I need the exact time window or a specific example (request ID, URL), and any recent changes I should know about."

## Write the situation report

Post one compact message in the thread, and update it as you learn more rather than posting walls of text:

- **Status:** what is broken and for whom, whether it's ongoing or recovering, and when it started (UTC)
- **Impact:** the affected monitors, regions, services and users, with numbers
- **Timeline:** the key events in order
- **Root cause:** the A → B → C chain and how confident you are, or the competing hypotheses still open
- **Evidence:** the specific data points (timestamps, values, hosts), with links to the incident, error and dashboard pages from the tool results
- **Next steps:** a specific recommendation for a human to check or do. Suggest it; don't do it yourself.

Summarize trends instead of dumping raw data. Say clearly what you couldn't check (a missing source, a permission error) instead of guessing.

## Act only when asked

These tools change real state and notify people: `acknowledge_incident`, `resolve_incident`, `escalate_incident`, `create_incident_comment` and `create_status_page_report`. Use them only when a person in the thread asks for that specific action, and confirm what you did.
