---
name: errors-query
description: Load BEFORE querying Better Stack exception or error-pattern data with SQL - exception counts, trends, first/last occurrence, affected users, raw stack traces. Contains instructions for querying errors/exceptions.
---

# Querying exceptions (Errors sources)

## Where the query runs

Better Stack runs SQL in two places, and the query text differs:

- **Dashboard charts and chart alerts** (`add_chart_to_dashboard`, `edit_chart`, `create_chart_alert`): write the query as this skill shows it, with the template variables `{{source}}`, `{{time}}`, `{{start_time}}` and `{{end_time}}`. The dashboard resolves them. Chart queries always read the source's metrics collection.
- **Ad-hoc queries** (`query`, `render_chart`): there are no template variables. First call the help tool for the data type with the source ID (`query_help` for logs and spans, `metrics_query_help` for metrics, `errors_query_help` for errors): it names the source's collections and the table to pass. Put the collection where `{{source}}` stands (e.g. `remote(t123_my_app_logs)` for the last ~30 minutes, `s3Cluster(primary, t123_my_app_s3)` with its row-type filter for older rows), a bucket such as `toStartOfInterval(dt, INTERVAL 5 MINUTE)` where `{{time}}` stands, and concrete bounds such as `dt > now() - INTERVAL 3 HOUR` for `{{start_time}}` and `{{end_time}}`. Add a `LIMIT`, and call `query_windows` before an `s3Cluster(...)` query over more than a few hours.

Error tracking has two data planes:

- **Occurrences** (this skill): ClickHouse - pre-aggregated exception metrics and raw exception events
- **State**: triage status (resolved/unresolved, who changed it, when) is returned ONLY by `errors` / `error` and changed with `update_error_state`. Never infer state from SQL.
- **Issues**: Linear/Jira issues linked to an error are listed by `error`; attach or file one with `link_error_issue` / `create_error_issue` (through the team's Better Stack integration, so state changes post comments on the issue), detach with `unlink_error_issue`.

## Exception metrics (counts, trends, first/last seen)

Query the application's metrics collection (`errors_query_help` names it). The schema is **fixed for all Errors sources** - query it directly, no field discovery needed:

- **Count exceptions with `sum(exceptions_count)`.** `exceptions_count` is a plain `UInt64` per-row column: the number of exceptions in that row. Aggregate it with `sum(...)`, **never** `countMerge(...)` (it is not an aggregate-state column). It self-scopes - it is `0` on non-exception rows - so you do **not** need a `_row_type` filter to isolate exceptions.
- **Never count exceptions with `countMerge(events_count)`.** `events_count` totals _every_ row type (spans, logs, web events, exceptions) and double-counts span event vs. duration rows, so it over-counts exceptions. Reach for it only when you deliberately want all row types at once.
- `pattern` - plain column holding the error-group hash: the same hash `errors` returns and `error` takes. Filter on it to scope any query to one error group
- `environment` - plain column (`production`, `staging`, ...)
- Aggregate-state columns (use their Merge function): `uniqMerge(user_uniq)` affected users, `minMerge(seen_at_min)` / `maxMerge(seen_at_max)` exact first/last occurrence, `anyLastMerge(type_last)` / `anyLastMerge(message_last)` / `anyLastMerge(call_site_file_last)` / `anyLastMerge(call_site_function_last)` group metadata

Exceptions over time:

```sql
SELECT {{time}} AS time,
  sum(exceptions_count) AS "Exceptions"
FROM {{source}}
WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}}
GROUP BY time
ORDER BY time
```

Per-pattern trend with readable labels ("errors by pattern"): there is no plain `message` column - group by `pattern` (the stable identity) and label the series with the message merge column. No hash-to-message mapping needed:

```sql
SELECT {{time}} AS time,
  anyLastMerge(message_last) AS series,
  sum(exceptions_count) AS "Errors"
FROM {{source}}
WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}}
GROUP BY time, pattern
ORDER BY time
```

`series` resolves per (time, pattern) group, so each pattern renders as one line labeled by its message. Prefix with the type when helpful: `concat(anyLastMerge(type_last), ': ', anyLastMerge(message_last)) AS series`.

Group metadata / first & last occurrence of one error pattern - pass a `start_time` spanning the source's retention (e.g. `now-30d`), otherwise `first_seen` is clipped to the query window:

```sql
SELECT
  anyLastMerge(type_last) AS type,
  anyLastMerge(message_last) AS message,
  minMerge(seen_at_min) AS first_seen,
  maxMerge(seen_at_max) AS last_seen,
  sum(exceptions_count) AS occurrences,
  uniqMerge(user_uniq) AS users,
  groupUniqArray(environment) AS environments
FROM {{source}}
WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}}
  AND pattern = '<hash>'
GROUP BY pattern
```

Add `{{time}} AS time, ... GROUP BY time` bucketing to trend any of these per error pattern.

## Raw exception events (stack traces, payloads)

`query` over the application's raw exception rows (`errors_query_help` names the collection and its row-type filter). Raw-JSON dialect like logs: event payload in the `raw` column read with `JSONExtractCaseInsensitive(raw, ...)`, the same `pattern` column for filtering, `dt` timestamps. Use a narrow time window around a known occurrence (e.g. `maxMerge(seen_at_max)` from the metrics query) - full-range scans over raw exceptions are slow.

Build exception trend charts from the metrics collection (queries above). Raw exceptions are for `query` drill-downs: stack traces, payload inspection, sample events.

## Related skills

- `metrics-query` - merge functions, template variables, and the general metrics dialect; load it when writing metrics queries beyond the canonical ones above
- `logs-query` - the raw-JSON extraction dialect used by raw exception events
