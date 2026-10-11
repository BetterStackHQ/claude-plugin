---
name: spans-query
description: MUST load BEFORE writing any Better Stack spans/traces SQL query. Contains required syntax for span queries - without this, queries will fail.
---

# Spans Query Building Guide

## Where the query runs

These queries read raw events, so they run ad hoc through `query` and `render_chart`; dashboard charts only read the metrics collection (see `dashboard-builder` for log and span volumes there). `query` and `render_chart` take no template variables. First call `query_help` with the source ID: it names the source's collections and the table to pass. Put the collection where `{{source}}` stands (e.g. `remote(t123_my_app_logs)` for the last ~30 minutes, `s3Cluster(primary, t123_my_app_s3)` with its row-type filter for older rows), a bucket such as `toStartOfInterval(dt, INTERVAL 5 MINUTE)` where `{{time}}` stands, and concrete bounds such as `dt > now() - INTERVAL 3 HOUR` for `{{start_time}}` and `{{end_time}}`. Add a `LIMIT`, and call `query_windows` before an `s3Cluster(...)` query over more than a few hours.

## Quick Reference

| Need             | Pattern                                                                                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Source           | `FROM {{source}}`                                                                                                       |
| Time filter      | `WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}}`                                                                |
| Time bucket      | `{{time}} AS time`                                                                                                      |
| Service filter   | `<service expression> = 'service-name'`                                                                                 |
| Group by service | `<service expression> AS series`                                                                                        |
| Extract field    | `JSONExtract(raw, 'span', 'field', 'Nullable(String)')`                                                                 |
| Trace ID         | `JSONExtractString(raw, 'span', 'trace_id')`                                                                            |
| Span ID          | `JSONExtractString(raw, 'span', 'span_id')`                                                                             |
| Duration (ns)    | `JSONExtract(raw, 'span', 'end_time_unix_nano', 'UInt64') - JSONExtract(raw, 'span', 'start_time_unix_nano', 'UInt64')` |

## Critical Rules

### 1. Span Data is in `raw` Column (JSON)

Spans follow OpenTelemetry format. All span fields are nested under `raw.span`, resource fields under `raw.resource`.

Enum values are stored as lowercase short names, not the proto constants: `kind` is `server` / `client` / `internal` / `producer` / `consumer` (never `SPAN_KIND_SERVER`), `status.code` is `ok` / `error` / `unset`.

```sql
-- Span fields (under "span" key)
JSONExtract(raw, 'span', 'trace_id', 'Nullable(String)') AS trace_id
JSONExtract(raw, 'span', 'span_id', 'Nullable(String)') AS span_id
JSONExtract(raw, 'span', 'parent_span_id', 'Nullable(String)') AS parent_span_id
JSONExtract(raw, 'span', 'name', 'Nullable(String)') AS span_name
JSONExtract(raw, 'span', 'kind', 'Nullable(String)') AS span_kind
JSONExtract(raw, 'span', 'root', 'Nullable(Boolean)') AS is_root

-- Duration (nanoseconds) - calculate from start/end
JSONExtract(raw, 'span', 'end_time_unix_nano', 'UInt64')
  - JSONExtract(raw, 'span', 'start_time_unix_nano', 'UInt64') AS duration_ns

-- Duration in milliseconds
(JSONExtract(raw, 'span', 'end_time_unix_nano', 'UInt64')
  - JSONExtract(raw, 'span', 'start_time_unix_nano', 'UInt64')) / 1000000 AS duration_ms

-- Status
JSONExtract(raw, 'span', 'status', 'code', 'Nullable(String)') AS status_code
```

### 2. Span Attributes (under `span.attributes`)

```sql
-- HTTP status
JSONExtract(raw, 'span', 'attributes', 'http.status_code', 'Nullable(Int64)') AS http_status
-- Or newer convention:
JSONExtract(raw, 'span', 'attributes', 'http.response.status_code', 'Nullable(Int64)') AS http_status

-- gRPC status
JSONExtract(raw, 'span', 'attributes', 'rpc.grpc.status_code', 'Nullable(Int64)') AS grpc_status

-- Database system
JSONExtractString(raw, 'span', 'attributes', 'db.system') AS db_type

-- Server address/port
JSONExtractString(raw, 'span', 'attributes', 'server.address') AS server_address
```

### 3. Resource Attributes (under `resource.attributes`)

```sql
-- Service name (try both)
JSONExtractString(raw, 'resource', 'attributes', '_service') AS service
JSONExtractString(raw, 'resource', 'attributes', 'service.name') AS service

-- Host
JSONExtractString(raw, 'resource', 'attributes', '_host') AS host

-- Kubernetes
JSONExtractString(raw, 'resource', 'attributes', 'k8s.namespace.name') AS namespace
JSONExtractString(raw, 'resource', 'attributes', 'k8s.pod.name') AS pod
```

**Important:** For service filtering/grouping, use the **service name expression** returned by `source` verbatim; never guess service field paths.

### 4. Use Template Variables

- `{{source}}` - table name (never hardcode)
- `{{time}}` - time bucket column (NOT `dt`)
- `{{start_time}}`, `{{end_time}}` - time range bounds

There is no service template variable: filter or group by service with the service name expression from `source`.

### 5. Error Detection

A span is an error if ANY of these conditions is true:

```sql
JSONExtract(raw, 'span', 'status', 'code', 'Nullable(String)') = 'error'
OR JSONExtract(raw, 'span', 'attributes', 'http.status_code', 'Nullable(Int64)') >= 400
OR JSONExtract(raw, 'span', 'attributes', 'http.response.status_code', 'Nullable(Int64)') >= 400
OR JSONExtract(raw, 'span', 'attributes', 'rpc.grpc.status_code', 'Nullable(Int64)') > 0
```

### 6. Standard Aggregations Only

Use `COUNT`, `AVG`, `SUM` - NOT `avgMerge`, `countMerge` (those are for pre-aggregated metrics).

### 7. Use Descriptive Column Aliases

Column aliases become chart legend labels. Use descriptive names.

### 8. Point Lookups: Add a `raw LIKE` Prefilter

When filtering on one specific ID (trace_id, span_id, session ID), add a substring prefilter before the extraction:

```sql
AND raw LIKE '%YOUR_TRACE_ID%'
AND JSONExtractString(raw, 'span', 'trace_id') = 'YOUR_TRACE_ID'
```

The cheap `LIKE` scan skips JSON-parsing rows that can't match; keep the equality as the authoritative filter. `LIKE` is case-sensitive — use the ID verbatim.

## Examples

**Span count over time:**

```sql
SELECT {{time}} AS time, COUNT(*) AS "Span count"
FROM {{source}}
WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}}
GROUP BY time
ORDER BY time
```

**Span count by service** - `series` uses the service name expression from `source`:

```sql
SELECT {{time}} AS time, JSONExtractCaseInsensitive(raw, 'service', 'Nullable(String)') AS series, COUNT(*) AS "Span count"
FROM {{source}}
WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}}
GROUP BY time, series
ORDER BY time
```

**Error rate (root spans only):**

```sql
SELECT
  {{time}} AS time,
  countIf(
    JSONExtract(raw, 'span', 'root', 'Nullable(Boolean)') = true AND (
      JSONExtract(raw, 'span', 'status', 'code', 'Nullable(String)') = 'error'
      OR JSONExtract(raw, 'span', 'attributes', 'http.status_code', 'Nullable(Int64)') >= 400
      OR JSONExtract(raw, 'span', 'attributes', 'http.response.status_code', 'Nullable(Int64)') >= 400
    )
  ) / countIf(JSONExtract(raw, 'span', 'root', 'Nullable(Boolean)') = true) AS "Error rate"
FROM {{source}}
WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}}
GROUP BY time
ORDER BY time
```

**Average duration by span name (top 10 slowest):**

```sql
SELECT
  JSONExtract(raw, 'span', 'name', 'Nullable(String)') AS span_name,
  AVG(
    (JSONExtract(raw, 'span', 'end_time_unix_nano', 'UInt64')
     - JSONExtract(raw, 'span', 'start_time_unix_nano', 'UInt64')) / 1000000
  ) AS "Avg duration (ms)",
  COUNT(*) AS "Count"
FROM {{source}}
WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}}
GROUP BY span_name
ORDER BY "Avg duration (ms)" DESC
LIMIT 10
```

**P95 latency over time (root spans):**

```sql
SELECT
  {{time}} AS time,
  quantile(0.95)(
    (JSONExtract(raw, 'span', 'end_time_unix_nano', 'UInt64')
     - JSONExtract(raw, 'span', 'start_time_unix_nano', 'UInt64')) / 1000000
  ) AS "P95 latency (ms)"
FROM {{source}}
WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}}
  AND JSONExtract(raw, 'span', 'root', 'Nullable(Boolean)') = true
GROUP BY time
ORDER BY time
```

**Find all spans for a trace:**

```sql
SELECT
  JSONExtract(raw, 'span', 'name', 'Nullable(String)') AS span_name,
  JSONExtract(raw, 'span', 'span_id', 'Nullable(String)') AS span_id,
  JSONExtract(raw, 'span', 'parent_span_id', 'Nullable(String)') AS parent_span_id,
  (JSONExtract(raw, 'span', 'end_time_unix_nano', 'UInt64')
   - JSONExtract(raw, 'span', 'start_time_unix_nano', 'UInt64')) / 1000000 AS duration_ms,
  JSONExtract(raw, 'span', 'status', 'code', 'Nullable(String)') AS status
FROM {{source}}
WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}}
  AND raw LIKE '%YOUR_TRACE_ID%'
  AND JSONExtractString(raw, 'span', 'trace_id') = 'YOUR_TRACE_ID'
ORDER BY dt, _insert_index
```

**Slow database queries:**

```sql
SELECT
  JSONExtract(raw, 'span', 'name', 'Nullable(String)') AS operation,
  JSONExtractString(raw, 'span', 'attributes', 'db.system') AS db_type,
  (JSONExtract(raw, 'span', 'end_time_unix_nano', 'UInt64')
   - JSONExtract(raw, 'span', 'start_time_unix_nano', 'UInt64')) / 1000000 AS duration_ms
FROM {{source}}
WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}}
  AND JSONExtractString(raw, 'span', 'attributes', 'db.system') != ''
ORDER BY duration_ms DESC
LIMIT 20
```

## Common Mistakes

| Mistake                                 | Fix                                                               |
| --------------------------------------- | ----------------------------------------------------------------- |
| `JSONExtract(raw, 'trace_id', ...)`     | `JSONExtract(raw, 'span', 'trace_id', ...)`                       |
| `JSONExtract(raw, 'service.name', ...)` | `JSONExtract(raw, 'resource', 'attributes', 'service.name', ...)` |
| `{{_service}}` or a guessed field       | Use the service name expression from `source`         |
| `duration` column                       | Calculate: `end_time_unix_nano - start_time_unix_nano`            |
| `WHERE dt BETWEEN`                      | `WHERE {{time}} BETWEEN ...`                                      |
| `'String'` type                         | `'Nullable(String)'` - prevents failures on missing fields        |
| ID equality without a prefilter         | Add `raw LIKE '%<id>%'` before the extraction (see rule 8)        |
| `avgMerge(...)` on spans                | `AVG(...)` - spans are not pre-aggregated                         |
| `SELECT *` for raw span data            | Select specific columns: `dt, _insert_index, raw`                 |
| `kind = 'SPAN_KIND_SERVER'`             | Lowercase short names: `kind = 'server'`, `status.code = 'error'` |
