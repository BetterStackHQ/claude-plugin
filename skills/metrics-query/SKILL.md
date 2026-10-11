---
name: metrics-query
description: MUST load BEFORE writing any Better Stack metrics SQL query. Better Stack's pre-aggregated metrics dialect (Merge functions, template variables, storage layouts, the ways a query silently blends series) - without it queries fail or return wrong numbers. Also load when the user asks how metrics queries look.
---

# Metrics Query Guide

Metrics tables hold pre-aggregated ClickHouse state columns. Below are the facts ClickHouse knowledge does not give you; everything else is standard SQL.

## Where the query runs

Better Stack runs SQL in two places, and the query text differs:

- **Dashboard charts and chart alerts** (`add_chart_to_dashboard`, `edit_chart`, `create_chart_alert`): write the query as this skill shows it, with the template variables `{{source}}`, `{{time}}`, `{{start_time}}` and `{{end_time}}`. The dashboard resolves them. Chart queries always read the source's metrics collection.
- **Ad-hoc queries** (`query`, `render_chart`): there are no template variables. First call the help tool for the data type with the source ID (`query_help` for logs and spans, `metrics_query_help` for metrics, `errors_query_help` for errors): it names the source's collections and the table to pass. Put the collection where `{{source}}` stands (e.g. `remote(t123_my_app_logs)` for the last ~30 minutes, `s3Cluster(primary, t123_my_app_s3)` with its row-type filter for older rows), a bucket such as `toStartOfInterval(dt, INTERVAL 5 MINUTE)` where `{{time}}` stands, and concrete bounds such as `dt > now() - INTERVAL 3 HOUR` for `{{start_time}}` and `{{end_time}}`. Add a `LIMIT`, and call `query_windows` before an `s3Cluster(...)` query over more than a few hours.

## Shape of a query

```sql
SELECT {{time}} AS time, avgMerge(value_avg) AS "Connected clients"
FROM {{source}}
WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}}
  AND name = 'redis_connected_clients'
GROUP BY time
ORDER BY time
```

- `{{source}}` is the table, never a hardcoded name (dashboards may substitute a source variable such as `{{redis_source}}`). `{{time}}` is the time bucket, sized from the range: never `dt` as the series column, never a function around it (`toStartOfHour({{time}})` fails). In ad-hoc queries, see above.
- The metric column is `name`, not `metric` or `metric_name`.
- Aliases become chart legends: descriptive (`AS "Memory used"`), never `AS value`. Several values in one chart are named columns plus chart settings `value_columns: [...]`, `series_column: ""`.
- Tables and number charts drop `{{time}}` and `GROUP BY time`.

## Two storage layouts (`metrics_query_help` says which; copy its expressions)

- **Row-based** (ingested Prometheus/OTel metrics, most extracted metrics): every metric shares the state columns `value_avg`, `value_min`, `value_max`, `rate_avg`, `bucket_*`, `events_count` (no `value_sum`, no `value_last`), selected by `WHERE name = '...'`. There are no per-metric columns: `memory_total_bytes_max` does not exist, `maxMergeIf(value_max, name = 'memory_total_bytes')` does. Labels live in the `tags` map and are read with `label('key')`.
- **Column-based** (errors, RUM, warehouse, legacy migrated metrics): each metric has its own `<name>_<agg>` columns (`anyLast` maps to `<name>_last`: `anyLastMerge(replay_city_last)`), never appears in `name` (a `name` filter returns 0 rows), and labels are bare columns (`city`, not `label('city')`, which returns NULL there).

## Merge functions

- A state column is read only by its matching combinator: `avgMerge(value_avg)`, `minMerge(value_min)`, `maxMerge(value_max)`, `avgMerge(rate_avg)`, `sumMerge(bucket_sum)`, `countMerge(events_count)`; `anyLastMerge` exists only on column-based sources (`<name>_last`). `AVG(value_avg)`, `avgMerge(value)`, `sumMerge(rate_avg)` and `sumMerge(value_max)` fail with ILLEGAL_TYPE_OF_ARGUMENT. A total across series is `sum` of per-series merges in a two-level query (below), never `sumMerge`.
- **Count events with the per-row-type columns**, plain UInt64 read with `sum()` and `sumIf(col, cond)`: `sum(logs_count)`, `sum(spans_count)`, `sum(exceptions_count)`, `sum(web_events_count)`, `sum(replays_count)`, `sum(metrics_count)` (ingested metric data points). Each is 0 on other row types, so no `_row_type` filter is needed. Never count events with a label-filtered `countMerge(events_count)`: every aggregated metric extracted from an event (the collector's span `duration`, a logs-to-metrics cost or token count) adds a row with the same labels for each event that carries it, so those events count again (13,561 logs for a true 7,797; 7x the real span count). `countMerge(events_count)` is right only where rows of every type are meant: one metric's data points under `WHERE name = '<metric>'`, the event count on warehouse sources (row type `event`, no per-type column), and any-activity checks such as `HAVING countMerge(events_count) > 0`.
- **Counter or gauge.** Cumulative counters (`_total`; on Azure, GCP and OTel also names with `requests`, `bytes`, `count`, `seconds` and no suffix) read as a per-second rate: `avgMerge(rate_avg)`. Gauges read as `avgMerge(value_avg)` or `maxMerge(value_max)`. Never `value_avg / 60` on a counter. Unsure: probe `avgMerge(value_avg)` per hour over 24 h; a monotonic climb with resets is a counter. The symptom of getting it wrong is a line that ramps up for hours and drops to zero.
- **Percentiles.** Histogram metrics (aggregation `histogram` in the catalog): `histogramQuantile(0.95)`, several quantiles in one SELECT, but `WHERE name =` exactly one metric (no `-If` form exists; one histogram metric per query). `*_quantiles` columns: `quantilesMerge(0.5, 0.9, 0.95, 0.99)(duration_quantiles)[3]`, 1-based. Distribution metrics (GCP `_latencies`, `_durations`, `_rtt`): `value_avg` is NULL; the mean is `sumMerge(bucket_sum) / sumMerge(bucket_count)`, percentiles via `histogramQuantile`; GCP values are microseconds.

## Several metrics or series in one query

- One scan with `-If`: `avgMergeIf(value_avg, name = 'used') / avgMergeIf(value_avg, name = 'total')` with `name IN (...)` in WHERE. This is the only way to combine metrics: never JOIN `{{source}}` to itself or to a CTE on `{{time}}`, it does not resolve on this backend. One condition per `-If`, combined with `AND`; arithmetic stays outside the merge (`avgMergeIf(value_avg, c) / 1024`, not `avgMergeIf(value_avg / 1024, c)`).
- **Silent blending.** A bare merge whose WHERE matches several metrics (`name IN (a, b)` without `-If`) or several values of a label you neither filtered nor grouped by averages them into one number with no error. `avgMerge(value_avg)` on `system.cpu.utilization` across its `state` label produced a meaningless 22%; `maxMerge` across services is one service's max, not a total. Give every metric its own `-If`; filter or GROUP BY every label that varies. Discover labels with `SELECT DISTINCT label('k') FROM {{source}} WHERE ... AND name = '...' LIMIT 20` or the catalog.
- **Counter rates across hidden labels** come out as the mean per label tuple, N times under the truth (Azure `total_requests` split by `status_code` and `operation_type` read 0.17 rps for a true 1.18). Aggregate per (time, every label) in a CTE, then `sum()` outside. For gauges and averages accept the unweighted mean.
- **Two-level queries.** `{{source}}`, `{{time}}`, `name`, `label()` and the state columns exist only in the innermost SELECT that reads `{{source}}`. Merge and alias everything there; the outer level uses only those aliases with plain `sum`, `avg`, `max`. Otherwise: `label('x')` outside fails with UNKNOWN_IDENTIFIER `tags`, `{{time}}` outside with UNKNOWN_IDENTIFIER `dt`, `sum(rate_avg)` outside with ILLEGAL_TYPE_OF_ARGUMENT, `sum(avgMerge(...))` anywhere with ILLEGAL_AGGREGATION. No combinator merges across labels; `avgMergeIgnoringLabels` does not exist.

```sql
-- per-label rates summed to a true total, plus the Top N shape (a CTE joins a CTE on a plain column)
WITH per_series AS (
  SELECT {{time}} AS time, label('_host') AS series, label('device') AS device,
         avgMerge(rate_avg) AS rate
  FROM {{source}}
  WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}} AND name = 'node_disk_io_time_seconds_total'
  GROUP BY time, series, device
),
top AS (SELECT series FROM per_series GROUP BY series ORDER BY sum(rate) DESC LIMIT 5)
SELECT p.time, p.series, sum(p.rate) AS "IO busy"
FROM per_series p JOIN top t ON p.series = t.series
GROUP BY p.time, p.series
ORDER BY p.time
```

## Labels

- Row-based labels: `label('_host')`, `label('_service')`, `label('_container')`, `label('device')`, `label('mode')`. Values are strings, booleans included, in whatever form the label's expression produces: the collector's `root` reads `'true'`/`'false'`, but its `error` reads `'1'`, `'0'` or is absent, never `'true'`. Check `SELECT DISTINCT label('k')` before filtering on a value; never `= TRUE` or bare `error`.
- Logs-to-metrics labels (group-by fields, which users often call "metrics" after the feature's name) are in `tags` on every row their event produced. The event rows themselves (logs, spans, exceptions, web events) have a NULL `name`: that is normal, not a broken extraction; only ingested and aggregated metrics have a name. So never `WHERE name = '<label>'`: count the events with their per-row-type column grouped by the label, e.g. `sum(logs_count)` by `label('<label>')`, `sum(spans_count)` for span labels.
- Collector sources: infrastructure metrics (`node_*`, `container_*`) carry `_host`, `_service`, `_container`; the span-derived `duration` metric carries `service`, `kind`, `root`, `error`, `http_status`, `span_name`. Load `collector-queries` for the proven query set.
- Column-based sources: bare columns (`error`, `root`, `kind`, `city`).
- Dashboard queries only: `[[ AND label('_host') = {{host}} ]]` applies when the variable is set; multi-select variables need `match(label('_host'), {{host}})`, see `dashboard-builder`.

## Examples

Counter rate per label value (one line per device):

```sql
SELECT {{time}} AS time, label('device') AS series, avgMerge(rate_avg) AS "Received bytes/s"
FROM {{source}}
WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}} AND name = 'node_network_receive_bytes_total'
GROUP BY time, series ORDER BY time
```

Ratio of two metrics in one scan (0-1, chart `unit: "percent"`):

```sql
SELECT {{time}} AS time,
  avgMergeIf(value_avg, name = 'node_memory_MemAvailable_bytes')
    / avgMergeIf(value_avg, name = 'node_memory_MemTotal_bytes') AS "Memory available"
FROM {{source}}
WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}}
  AND name IN ('node_memory_MemAvailable_bytes', 'node_memory_MemTotal_bytes')
GROUP BY time ORDER BY time
```

Percentiles of one histogram metric (chart `value_columns: ["p50", "p95", "p99"]`, `series_column: ""`):

```sql
SELECT {{time}} AS time,
  histogramQuantile(0.50) AS p50, histogramQuantile(0.95) AS p95, histogramQuantile(0.99) AS p99
FROM {{source}}
WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}} AND name = 'duration' AND label('kind') = 'server'
GROUP BY time ORDER BY time
```

Error rate of server spans on the metrics plane:

```sql
SELECT {{time}} AS time,
  sumIf(spans_count, label('error') = '1') / sum(spans_count) AS "Error rate"
FROM {{source}}
WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}}
  AND label('kind') = 'server' AND label('root') = 'true'
GROUP BY time ORDER BY time
```

On column-based sources write `error = TRUE`, `root` and `kind = 'server'` as bare columns.

Log volume by level without touching raw logs. The metrics table has no `raw` column; log fields exist there only as extracted labels (`severity_text` on OTel sources, `level` on others, per `metrics_schema`):

```sql
SELECT {{time}} AS time, lower(label('severity_text')) AS series, sum(logs_count) AS "Logs"
FROM {{source}}
WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}} AND label('severity_text') != ''
GROUP BY time, series ORDER BY time
```

Ranking table, no time column:

```sql
SELECT label('_container') AS "Container", avgMerge(value_avg) AS "RSS", maxMerge(value_max) AS "Peak RSS"
FROM {{source}}
WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}} AND name = 'container_resources_memory_rss_bytes'
GROUP BY "Container" ORDER BY "RSS" DESC LIMIT 15
```

## Units and charts

- Ratios stay 0-1 with `unit: "percent"`; never `* 100`. Bytes and seconds stay raw with `B_iec`, `B_si`, `s`, `ms`: convert in the chart unit, not in SQL (`/ 1024 / 1024` with `B_si` renders 573 MiB as 573 B).
- Map and host-map charts have no `time` column; load `map-hierarchy-charts`.

## Workflow

1. `metrics_schema` with the source ID: a large catalog answers with name-prefix groups; pass a `name_filter` (`redis*`, `*_total`) to list those metrics and their labels.
2. Write the query per the rules above, with `now-3h` style bounds.
3. Run it with `query` and read the window, the row count and the values before trusting or charting a number. 0 rows means the window, the metric name or a label filter is wrong, in that order.

## Mistakes seen in the wild

- `histogram(...)`, `histogramMerge(...)`, `p95Merge`: the only percentile functions are `histogramQuantile(q)` and `quantilesMerge(...)(col)`.
- `anyLastMerge(value_last)` or `sumMerge(value_sum)` on a row-based source: no such columns. `_info` metrics are gauges of 1 whose payload is in labels: `SELECT DISTINCT label('version') ... WHERE name = 'redis_instance_info'`.
- `{{time}}` repeated in the outer SELECT of a two-level query: UNKNOWN_IDENTIFIER `dt`; outside, select the alias: `SELECT time, sum(rate) ... GROUP BY time`.
- `avgMerge(value_avg, cond)`: a condition needs the `-If` form, `avgMergeIf(value_avg, cond)`. `countMerge(events_count, cond)` is a per-row-type count instead: `sumIf(logs_count, cond)`.
- `WHERE name IN ('provider', 'event_type')` after the user called their logs-to-metrics labels "metrics": 0 rows. They are labels: `sum(logs_count)` grouped by `label('provider')`.
- `concat(label('provider'), ' / ', label('event_type')) AS series` when some events lack `event_type`: `label()` of a missing key is NULL and `concat` with a NULL is NULL, so those events land in a "null" series. Wrap optional labels: `ifNull(label('event_type'), 'none')`.
- `{{level}}`, `{{service}}` or any other custom variable outside a dashboard: custom `{{var}}` and `[[ ... ]]` blocks exist only in dashboard charts, and `query` takes no template variables at all.
- `JSONExtract(raw, ...)` against the metrics collection: it has no `raw`; query the extracted label, or query the logs collection instead.
- `WHERE metric_name = ...` or `metric = ...`: the column is `name`.
- `AS value` on a chart query: the legend reads "value".
- `avgMerge(value_avg)` for a percentile: that is the average; use `histogramQuantile`.
- `histogramQuantile` with `name IN (a, b)`: mixes histograms; one metric per query.
- NULL from a latency or duration metric: it is a distribution metric; use `bucket_*`.
- `label('city')` on an errors or RUM source: NULL; it is a bare column there.
- `sumIf` or `avgIf` over a merged alias in an outer level returns NULL, not 0, when no row matches (the alias is Nullable): wrap rates that should read zero in `coalesce(..., 0)`.
- `toStartOfHour(dt)` with `dt >= now() - INTERVAL 24 HOUR` in a dashboard chart: runs, but ignores the dashboard's time range; use `{{time}}` and `{{start_time}}`/`{{end_time}}` there.
