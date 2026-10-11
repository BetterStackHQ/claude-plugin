---
name: logs-query
description: MUST load BEFORE writing any Better Stack logs or web-events SQL query. Contains required syntax for raw-event queries - without this, queries will fail. Compatible with Explore. Also load when the user asks how raw-event queries look.
---

# Logs Query Building Guide

## Where the query runs

These queries read raw events, so they run ad hoc through `query` and `render_chart`; dashboard charts only read the metrics collection (see `dashboard-builder` for log and span volumes there). `query` and `render_chart` take no template variables. First call `query_help` with the source ID: it names the source's collections and the table to pass. Put the collection where `{{source}}` stands (e.g. `remote(t123_my_app_logs)` for the last ~30 minutes, `s3Cluster(primary, t123_my_app_s3)` with its row-type filter for older rows), a bucket such as `toStartOfInterval(dt, INTERVAL 5 MINUTE)` where `{{time}}` stands, and concrete bounds such as `dt > now() - INTERVAL 3 HOUR` for `{{start_time}}` and `{{end_time}}`. Add a `LIMIT`, and call `query_windows` before an `s3Cluster(...)` query over more than a few hours.

## Quick Reference

| Need             | Pattern                                                                  |
| ---------------- | ------------------------------------------------------------------------ |
| Source           | `FROM {{source}}`                                                        |
| Time filter      | `WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}}`                 |
| Time bucket      | `{{time}} AS time`                                                       |
| Service filter   | `<service expression> = 'service-name'`                                  |
| Group by service | `<service expression> AS series`                                         |
| Extract field    | `JSONExtractCaseInsensitive(raw, 'field', 'Nullable(String)')`           |
| Nested field     | `JSONExtractCaseInsensitive(raw, 'parent', 'child', 'Nullable(String)')` |
| Keyword search   | `positionCaseInsensitive(field, 'keyword') > 0`                          |

## Critical Rules

### 1. Log Data is in `raw` Column (JSON)

```sql
-- Always use JSONExtractCaseInsensitive with Nullable types
JSONExtractCaseInsensitive(raw, 'level', 'Nullable(String)') AS log_level
JSONExtractCaseInsensitive(raw, 'metadata', 'user_id', 'Nullable(Int32)') AS user_id

-- Fields with dots in name: use single string (NOT separate args)
JSONExtractCaseInsensitive(raw, 'field.with.dots', 'Nullable(String)')
```

List of fields coming from `source_fields` lists fields as which are nested in `raw` - always access using `JSONExtractCaseInsensitive(raw, 'nginx', 'agent', 'Nullable(String)')`, not `SELECT nginx.agent FROM {{source}}`

### 2. Use Template Variables

- `{{source}}` - table name (never hardcode)
- `{{time}}` - time bucket column (NOT `dt`)
- `{{start_time}}`, `{{end_time}}` - time range bounds

### Service filtering and grouping

`source` returns the source's **service name expression** (a `JSONExtractCaseInsensitive(...)` or `COALESCE(...)` snippet) - copy it verbatim into SELECT / WHERE / GROUP BY. A service listed there with its own `field:` is extracted from that path instead; never guess service field paths.

### 3. Standard Aggregations Only

Use `COUNT`, `AVG`, `SUM` - NOT `avgMerge`, `countMerge` (those are for pre-aggregated metrics).

### 4. Use Descriptive Column Aliases

Column aliases become chart legend labels. Use descriptive names instead of generic `value`.

```sql
-- BAD: Legend shows "value"
SELECT {{time}} AS time, COUNT(*) AS value FROM ...

-- GOOD: Legend shows "Error count"
SELECT {{time}} AS time, COUNT(*) AS "Error count" FROM ...
```

### 5. Point Lookups: Add a `raw LIKE` Prefilter

When filtering on one specific ID (session ID, trace_id, request ID, user ID), add a substring prefilter before the extraction:

```sql
AND raw LIKE '%YOUR_SESSION_ID%'
AND JSONExtractCaseInsensitive(raw, 'session_id', 'Nullable(String)') = 'YOUR_SESSION_ID'
```

The cheap `LIKE` scan skips JSON-parsing rows that can't match; keep the equality as the authoritative filter. `LIKE` is case-sensitive — use the ID verbatim.

## Examples

**Time-series (single):**

```sql
SELECT {{time}} AS time, COUNT(*) AS "Log count"
FROM {{source}}
WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}}
GROUP BY time
ORDER BY time
```

**Time-series (multi-series by service)** - `series` uses the service name expression from `source`:

```sql
SELECT {{time}} AS time, JSONExtractCaseInsensitive(raw, 'service', 'Nullable(String)') AS series, COUNT(*) AS "Log count"
FROM {{source}}
WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}}
GROUP BY time, series
ORDER BY time
```

**Time-series (multi-series by level):**

```sql
SELECT
  {{time}} AS time,
  JSONExtractCaseInsensitive(raw, 'level', 'Nullable(String)') AS series,
  COUNT(*) AS "Log count"
FROM {{source}}
WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}}
GROUP BY time, series
ORDER BY time
```

**Error rate:**

```sql
SELECT
  {{time}} AS time,
  countIf(JSONExtractCaseInsensitive(raw, 'level', 'Nullable(String)') = 'ERROR') / COUNT(*) AS "Error rate"
FROM {{source}}
WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}}
GROUP BY time
ORDER BY time
```

**Keyword search:**

```sql
SELECT {{time}} AS time, JSONExtractCaseInsensitive(raw, 'message', 'Nullable(String)') AS message
FROM {{source}}
WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}}
  AND positionCaseInsensitive(JSONExtractCaseInsensitive(raw, 'message', 'Nullable(String)'), 'timeout') > 0
ORDER BY time DESC
LIMIT 100
```

**Map (geographic by IP) — for `map_chart`:** wrap the source's IP field (or any city/country/airport string) in `location()`, group by it, no `time` column — load the `map-hierarchy-charts` skill for the query shape and settings.

## Common Mistakes

| Mistake                         | Fix                                                        |
| ------------------------------- | ---------------------------------------------------------- |
| `{{_service}}`                  | Removed - use the expression from `source`     |
| Guessed service field path      | Copy the service name expression from `source` |
| `WHERE dt BETWEEN`              | `WHERE {{time}} BETWEEN ...`                               |
| `raw.level` or just `level`     | `JSONExtractCaseInsensitive(raw, 'level', ...)`            |
| `'String'` type                 | `'Nullable(String)'`                                       |
| `'parent.child'` for nested     | `'parent', 'child'` as separate arguments                  |
| `avgMerge(...)` on logs         | `AVG(...)` - logs are not pre-aggregated                   |
| `AS value` for chart queries    | Use descriptive alias: `AS "Log count"`                    |
| ID equality without a prefilter | Add `raw LIKE '%<id>%'` before the extraction (see rule 5) |

## Web Events (browser/RUM)

Web events are browser events from the Better Stack JS tag on Errors sources (Applications): page views/navigation, web vitals, and user/session context. They are stored and queried exactly like logs — raw JSON rows in the `raw` column with the same template variables.

- `query_help` names the application's web-events collection; `source_fields` lists their fields. Don't guess field paths.
- Event payload is nested JSON, e.g. the page URL sits at `payload.meta.url` (path at `payload.meta.path`): `JSONExtractCaseInsensitive(raw, 'payload', 'meta', 'path', 'Nullable(String)')`.

## Data volume check

To check the volume of rows by type (`log`, `span`, `web_event`, `exception`) without any `WHERE` filtering, always use a metrics query instead of scanning raw events — load the `metrics-query` skill and use its per-row-type counts (`sum(logs_count)`, `sum(spans_count)`, `sum(web_events_count)`, `sum(exceptions_count)`).
