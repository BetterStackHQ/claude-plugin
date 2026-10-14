---
name: grafana-import
description: Import Grafana dashboards from grafana.com templates. Translates PromQL to ClickHouse. Load when user asks to import, convert, or recreate a Grafana dashboard in Better Stack.
---

# Grafana Dashboard Import

## Quick Start

```bash
# 1. Get summary first (always start here)
node <this skill's directory>/scripts/extract-layout.js --dashboard <ID> --summary
node <this skill's directory>/scripts/extract-layout.js --file <path> --summary

# 2. Extract and build section-by-section
node <this skill's directory>/scripts/extract-layout.js --dashboard <ID> --section 1
# ... build section 1 charts ...
node <this skill's directory>/scripts/extract-layout.js --dashboard <ID> --section 2
# ... build section 2 charts ... and so on
```

## Tool Setup

You need the Better Stack dashboard tools (`create_dashboard`, `add_chart_to_dashboard`, `set_dashboard_variable`) and the query tools (`sources`, `source`, `metrics_schema`, `query`). If your client loads tools on demand, load them before starting.

The extract script is `scripts/extract-layout.js` in this skill's directory, run with Node.js 18 or newer. If you can't run scripts, read the export yourself and pull out the same fields: sections, panels, their queries, units and template variables.

## Workflow

1. **Extract summary:** `node scripts/extract-layout.js --dashboard <ID> --summary` — see all sections and panel counts
2. **Check metrics:** `metrics_schema(id)` — identify available metrics AND their tags
3. **Discover tag names:** `SELECT DISTINCT tags FROM {{source}} WHERE name = 'your.first.metric' LIMIT 5` — use exact tag names from real data, never guess
4. **Create dashboard:** `create_dashboard(source_id, name)`
5. **Translate template variables** — For each `templating.list` entry, create a Better Stack variable with `set_dashboard_variable` AND reference it in the queries that used `$name` via an optional `[[ ]]` clause. Never just omit them. See Template Variable Translation below.
6. **Process section-by-section** — For each section:
   - Extract: `node scripts/extract-layout.js --dashboard <ID> --section <n>`
   - Build queries using translation rules below (load `metrics-query` skill)
   - Validate each query via `query` before creating charts
   - Add charts (load `chart-generation` + `dashboard-builder` skills), always pass `height: 6` and `section: "Name"`
   - Move to next section only after completing current one

**Query translation checklist:**

- Identify datasource type (Prometheus or CloudWatch) from extract output
- For PromQL: match `rate()`/`irate()` to correct merge function, handle `sum by`/`avg by` aggregations
- For CloudWatch: match `statistics` field (Average/Sum/Maximum/Minimum) to correct merge function
- Check for multi-metric arithmetic (`a / b`) requiring CTEs

### No-data mode (blind import)

**Use ONLY when explicitly requested** (e.g., "import without data", "no metrics available", "blind import"). Never default to this mode — always try the normal workflow first.

When the service has no metric data in Better Stack, you cannot validate queries. Instead:

1. **Extract layout** as normal with the extract script
2. **Skip `metrics_schema`** — you can't discover metrics or tags from live data
3. **Derive metric names from the Grafana query:**
   - PromQL metrics: use as-is (Prometheus metrics keep their exact names in Better Stack)
   - CloudWatch metrics: translate `namespace/metricName` → underscore format with suffix (see CloudWatch Translation below)
4. **Derive tag names from the query:**
   - PromQL `by (label)` → `label('label')` (Prometheus labels keep their names)
   - CloudWatch `dimensions` → `label('snake_case')` (CloudWatch tags are snake_case)
5. **Build queries using known patterns** — follow ALL translation rules from this skill
6. **Self-review every query before creating the chart:**
   - Re-read the SQL character by character
   - Check: Does `{{time}}` only appear where `dt` is in scope? (pitfall #1)
   - Check: Does `value_columns` match the SQL alias exactly? (Mismatch = chart appears empty. Never leave as default `["value"]` when SQL uses a descriptive alias.)
   - Check: Is the merge function correct for the statistic/aggregation?
   - Check: Is `series_column` set when there's a GROUP BY on a tag?
   - Check: For `unit: "percent"`, are values 0–1? (divide by 100 if needed)
7. **Create the dashboard and charts** — follow all layout rules, height: 6, section naming
8. **No cross-checking is possible** — there's no data to compare against

**Key principle:** In no-data mode, the queries may not return results, but they must be **structurally correct** so they work once data starts flowing. A broken query (wrong column name, bad syntax, missing GROUP BY) is worse than no chart at all.

---

## Interpreting Extract Script Output

The extract script shows each panel with its type, queries, and layout info:

```
- **Panel Title** | chart_type (Grafana: grafana_type) | unit | x:N y:N w:N h:N {settings}
  `PromQL expression` → "Legend format"
```

Or for CloudWatch panels:

```
- **Panel Title** | chart_type (Grafana: grafana_type) | unit | x:N y:N w:N h:N {settings}
  CW: AWS/RDS.CPUUtilization [Average] dims: DBInstanceIdentifier=$dbinstance
```

**Decision tree for each panel:**

1. **Check datasource type** — Prometheus (has `expr`) vs CloudWatch (has `namespace.metricName`):
   - PromQL → use PromQL translation rules
   - CloudWatch → use CloudWatch translation rules
   - Both use `label()` for tag/label access

2. **Check panel type** — determines chart type:
   - `timeseries` / `graph` → `line_chart` (default)
   - `timeseries` with `drawStyle: bars` → `bar_chart` with time dimension
   - `timeseries` with `stacking: normal` → `line_chart` with `stacking: "stack"`
   - `stat` / `singlestat` → `number_chart`, single scalar value
   - `gauge` / `bargauge` → `gauge_chart` or `bar_chart`
   - `table` → `table_chart`
   - `piechart` → `pie_chart`
   - `barchart` → `bar_chart` (category bar, no time dimension)
   - `heatmap` → `heatmap_chart`

3. **Check for `by (labels)`** in PromQL or multi-dimension CloudWatch:
   - Present → Add tag-based series column and include in GROUP BY
   - Absent → single-series chart

4. **Check for instant vs range queries:**
   - `instant: true` or stat/gauge panel → no `{{time}}`, scalar result
   - Range query or timeseries panel → needs `{{time}} AS time` and `GROUP BY time`

---

## PromQL → ClickHouse Translation

### Function Mapping

| PromQL                  | Line Chart                  | Gauge/Number                           |
| ----------------------- | --------------------------- | -------------------------------------- |
| `rate(metric[5m])`      | `avgMerge(rate_avg)`        | `avgMerge(rate_avg)`                   |
| `irate(metric[5m])`     | `avgMerge(rate_avg)`        | **`argMax(rate, time)`** from subquery |
| `metric` (gauge)        | `avgMerge(value_avg)`       | `argMax(value, time)` from subquery    |
| `sum(...)` / `avg(...)` | CTE + `sum()`/`avg()`       | same                                   |
| `count by (label)`      | `uniqExact(label('label'))` | same                                   |
| `clamp_min(x, 0)`       | `greatest(x, 0)`            | same                                   |
| `clamp_max(x, 100)`     | `least(x, 100)`             | same                                   |

### Why irate() Needs argMax for Gauges

| Function                        | Computes                         |
| ------------------------------- | -------------------------------- |
| Prometheus `irate()`            | Instant rate from last 2 samples |
| ClickHouse `avgMerge(rate_avg)` | Average rate over entire window  |

Use `argMax(rate, time)` to get the most recent bucket's rate (90-99% match vs Prometheus).

### Aggregation Over Time

| PromQL                      | ClickHouse            |
| --------------------------- | --------------------- |
| `avg_over_time(metric[5m])` | `avgMerge(value_avg)` |
| `max_over_time(metric[5m])` | `maxMerge(value_max)` |
| `min_over_time(metric[5m])` | `minMerge(value_min)` |

### Arithmetic Operations

| PromQL                | ClickHouse                                              |
| --------------------- | ------------------------------------------------------- |
| `metric_a / metric_b` | CTE + `sumIf(value, name='a') / sumIf(value, name='b')` |
| `metric * 100`        | `avgMerge(value_avg) * 100`                             |
| `1 - metric`          | `1 - avgMerge(value_avg)`                               |

### Tag Access

All metric types (Prometheus, CloudWatch, collector) use `label('tag_name')` to access tags:

```sql
-- Access a tag
label('device') AS series

-- Filter by tag
WHERE label('mode') = 'idle'

-- Group by tag
GROUP BY label('device')
```

**Prometheus labels keep their original names** — `instance`, `job`, `device`, `mode`, `cpu`, etc. Always verify with a test query.

**CloudWatch dimensions are snake_case** — `DBInstanceIdentifier` → `db_instance_identifier`. See CloudWatch Translation section for the full mapping.

### PromQL Variable Translation

| Grafana token      | ClickHouse handling                                               |
| ------------------ | ----------------------------------------------------------------- |
| `$__rate_interval` | Ignore — `{{time}}` handles bucketing                             |
| `$__interval`      | Ignore                                                            |
| `{label="$var"}`   | `[[ AND label('label') = {{var}} ]]` (single-value variable)      |
| `{label=~"$var"}`  | `[[ AND match(label('label'), {{var}}) ]]` (multi-value variable) |
| `{job="$job"}`     | `[[ AND label('job') = {{job}} ]]`                                |

Do NOT just omit `$var` label filters — recreate each as a dashboard variable and reference it with an optional `[[ ]]` clause. See Template Variable Translation below.

### Template Variable Translation

Grafana `templating.list` variables (the `$var` selectors at the top) must be recreated as **Better Stack dashboard variables** — a variable only appears once a query references it, so do BOTH steps.

For each entry in `templating.list` (skip `type: interval` → `{{time}}` handles it; skip `datasource`/`adhoc`):

1. **Create the variable** with `set_dashboard_variable` (type reference: `dashboard-builder` skill → "Dashboard template variables"):
   - `type: query` (e.g. `label_values(node_cpu_seconds_total, instance)`) → `multi_select_with_sql` (or `select_with_sql` if `multi: false`), `sql_definition: "label('<label>')"` where `<label>` is the label the variable queries (Prometheus labels keep their names; CloudWatch dimensions → snake_case).
   - `type: custom` (fixed options) → `select_value`, `default_values: [the option values]`.
   - `type: constant` / `textbox` → `string`, `default_values: [value]`.
2. **Reference it in every query that used `$name`** (or `${name}` / `[[name]]`), as an OPTIONAL `[[ ]]` clause so charts render with nothing selected (matches Grafana's "All" default):
   - multi: `[[ AND match(label('<label>'), {{name}}) ]]`
   - single: `[[ AND label('<label>') = {{name}} ]]`

Name the variable after the Grafana variable's `name`.

Example — `templating.list: [{ name: "instance", type: "query", query: "label_values(node_cpu_seconds_total, instance)", multi: true }]`, PromQL `rate(node_cpu_seconds_total{instance=~"$instance"}[5m])`:

1. `set_dashboard_variable(dashboard_id, name: "instance", variable_type: "multi_select_with_sql", sql_definition: "label('instance')")`
2. `SELECT {{time}} AS time, label('instance') AS series, avgMerge(rate_avg) AS "CPU" FROM {{source}} WHERE name = 'node_cpu_seconds_total' [[ AND match(label('instance'), {{instance}}) ]] GROUP BY time, series`

---

## CloudWatch → ClickHouse Translation

### Metric Name Translation

CloudWatch metrics in Better Stack follow the pattern: `aws_<service>_<metric_name>_<statistic_suffix>`

| CloudWatch                          | ClickHouse metric name           |
| ----------------------------------- | -------------------------------- |
| `AWS/RDS` / `CPUUtilization`        | `aws_rds_cpuutilization_average` |
| `AWS/EC2` / `CPUUtilization`        | `aws_ec2_cpuutilization_average` |
| `AWS/ELB` / `RequestCount` [Sum]    | `aws_elb_request_count_sum`      |
| `AWS/Lambda` / `Duration` [Average] | `aws_lambda_duration_average`    |

Common suffixes: `_average`, `_sum`, `_count`, `_max`, `_min`

**Always use `metrics_schema` to discover the actual name:**

```
metrics_schema(id, name_filter: "aws_rds*")
```

The naming convention is not always predictable. CamelCase → lowercase, but word boundaries vary. Always verify.

### Statistic Mapping

| CloudWatch statistic | ClickHouse merge function                | Notes                                                                           |
| -------------------- | ---------------------------------------- | ------------------------------------------------------------------------------- |
| `Average`            | `avgMerge(value_avg)`                    | Most common                                                                     |
| `Sum`                | `maxMerge(value_max)` on `_sum` metric   | CloudWatch `_sum` stores pre-aggregated counts; using `avgMerge` smooths spikes |
| `Maximum`            | `maxMerge(value_max)`                    |                                                                                 |
| `Minimum`            | `minMerge(value_min)`                    |                                                                                 |
| `SampleCount`        | `maxMerge(value_max)` on `_count` metric |                                                                                 |

### CRITICAL: CloudWatch `Sum` Statistic and Hidden Tag Dimensions

When CloudWatch queries use `Sum` statistic with multiple dimensions, the same hidden-tag problem applies as with Datadog `sum:` prefix.

**When the query has NO dimension grouping** (single aggregate value), you MUST:

1. Check `metrics_schema` for ALL tags on the metric
2. GROUP BY ALL tag dimensions in inner query
3. Wrap with SUM in outer query

```sql
-- CloudWatch: AWS/RDS RequestCount [Sum] — no dimension grouping
-- WRONG: gives per-instance count, not total
SELECT maxMerge(value_max) AS "Requests"
FROM {{source}} WHERE name = 'aws_rds_request_count_sum'

-- CORRECT: GROUP BY all tags, SUM in outer query
SELECT SUM(requests) AS "Requests"
FROM (
  SELECT label('db_instance_identifier') AS instance,
    maxMerge(value_max) AS requests
  FROM {{source}}
  WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}}
    AND name = 'aws_rds_request_count_sum'
  GROUP BY instance
)
```

### CloudWatch Dimension Mapping

CloudWatch dimensions are stored as **snake_case** tags accessed via `label()`:

**Dimension name mapping:**

| Grafana dimension      | ClickHouse label key     |
| ---------------------- | ------------------------ |
| `DBInstanceIdentifier` | `db_instance_identifier` |
| `DBClusterIdentifier`  | `db_cluster_identifier`  |
| `InstanceId`           | `instance_id`            |
| `FunctionName`         | `function_name`          |
| `BucketName`           | `bucket_name`            |
| `LoadBalancer`         | `load_balancer`          |
| `TargetGroup`          | `target_group`           |
| `QueueName`            | `queue_name`             |
| `TopicName`            | `topic_name`             |
| `CacheClusterId`       | `cache_cluster_id`       |
| `VolumeId`             | `volume_id`              |
| `AvailabilityZone`     | `availability_zone`      |

**CRITICAL: `label()` returns NULL (not empty string) for absent tags.** Using `= ''` or `!= ''` does NOT work — both evaluate to NULL and exclude the row. Use `IS NULL` / `IS NOT NULL`:

```sql
-- Instance-level only (tag present)
WHERE label('db_instance_identifier') IS NOT NULL
-- Cluster-level only (cluster present, instance absent)
WHERE label('db_cluster_identifier') IS NOT NULL AND label('db_instance_identifier') IS NULL
```

**Multiple aggregation levels:** AWS metrics often have multiple series at different granularities (account-level, cluster-level, instance-level). Some rows have absent instance tags. Always filter to the correct level.

### CloudWatch Dimension Filter Translation

| Grafana dimension                       | ClickHouse equivalent                                                                                                             |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `"DBInstanceIdentifier": "$dbinstance"` | Create a `dbinstance` variable + `[[ AND label('db_instance_identifier') = {{dbinstance}} ]]` (see Template Variable Translation) |
| `"DBInstanceIdentifier": "my-db"`       | `AND label('db_instance_identifier') = 'my-db'`                                                                                   |
| `"DBInstanceIdentifier": "*"`           | (no filter — return all)                                                                                                          |
| `matchExact: false`                     | No extra filtering needed                                                                                                         |

### CloudWatch Metric Math

Grafana CloudWatch metric math uses `expression` field referencing other targets by `id`:

```json
{ "id": "m1", "metricName": "CPUUtilization", ... },
{ "expression": "m1/100", "id": "e1", ... }
```

Translate to CTE pattern:

```sql
WITH metrics AS (
  SELECT {{time}} AS time, avgMerge(value_avg) AS cpu
  FROM {{source}}
  WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}}
    AND name = 'aws_rds_cpuutilization_average'
  GROUP BY time
)
SELECT time, cpu / 100 AS "CPU utilization" FROM metrics ORDER BY time
```

---

## Panel Type Mapping

| Grafana panel                   | Better Stack chart | Notes                                                                                                      |
| ------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------- |
| `timeseries`                    | `line_chart`       | Default; time-series with `{{time}}`                                                                       |
| `timeseries` (drawStyle: bars)  | `bar_chart`        | Time-series bars — needs `{{time}}`                                                                        |
| `timeseries` (stacking: normal) | `line_chart`       | `stacking: "stack"`                                                                                        |
| `graph` (legacy)                | `line_chart`       | Same as timeseries                                                                                         |
| `stat`                          | `number_chart`     | Single value, no time                                                                                      |
| `singlestat` (legacy)           | `number_chart`     | Same as stat                                                                                               |
| `gauge`                         | `gauge_chart`      |                                                                                                            |
| `bargauge`                      | `gauge_chart`      |                                                                                                            |
| `table` / `table-old`           | `table_chart`      | Set `column_units` per column + `percentage_highlight_columns` for ratio cols (see chart-generation skill) |
| `barchart`                      | `bar_chart`        | Category bar, no time dimension                                                                            |
| `piechart`                      | `pie_chart`        |                                                                                                            |
| `heatmap`                       | `heatmap_chart`    |                                                                                                            |

**Skip:** `text`, `row`, `news`, `dashlist`, `alertlist`, `annolist`, `logs`, `nodeGraph`, `traces`, `flamegraph`, `canvas`, `geomap`

### Bar chart configuration

Grafana **`barchart`** → category bar chart (no `{{time}}`); **`timeseries` with drawStyle bars** → time-series bar chart. Configure per the `chart-generation` skill's Bar Chart Configuration (category bars need `x_axis_type: "category"` + `time_column: "series"`).

---

## Unit Mapping (Grafana → Better Stack)

| Grafana unit        | Better Stack unit | Notes                                                                                       |
| ------------------- | ----------------- | ------------------------------------------------------------------------------------------- |
| `bytes`, `decbytes` | `B_si`            |                                                                                             |
| `bits`, `decbits`   | `bps`             | Only if rate; otherwise `B_si`                                                              |
| `Bps` (bytes/sec)   | `B_si`            |                                                                                             |
| `bps` (bits/sec)    | `bps`             | PromQL `* 8` for bytes→bits                                                                 |
| `s`                 | `s`               |                                                                                             |
| `ms`                | `ms`              |                                                                                             |
| `us`, `µs`          | `μs`              |                                                                                             |
| `ns`                | `ns`              |                                                                                             |
| `percent`           | `percent`         | **Grafana `percent` = 0–100 input; Better Stack `percent` = 0–1 input. MUST divide by 100** |
| `percentunit`       | `percent`         | Grafana `percentunit` = 0–1 input — maps directly, no conversion                            |
| `short`             | `shortened`       |                                                                                             |
| `none`              | `shortened`       |                                                                                             |
| `ops`, `iops`       | `e/s`             |                                                                                             |
| `reqps`             | `rps`             |                                                                                             |
| `locale`            | `shortened`       |                                                                                             |
| `celsius`           | (custom)          | Last resort — use `unit: "none"`, add "°C" in title                                         |
| `hertz`             | `e/s`             |                                                                                             |

**Always prefer predefined units.** The table above covers nearly all Grafana units. Never use `custom_unit` when a predefined Better Stack unit exists (e.g., use `B_si` not `custom_unit: "bytes"`, use `e/s` not `custom_unit: "/s"`, use `B_si/s` not `custom_unit: "bytes/sec"`). Custom units lack auto-scaling and produce worse formatting. Only use `custom_unit` for truly exotic units like °C where no predefined equivalent exists.

**CRITICAL: Grafana `percent` vs `percentunit`:**

- Grafana `percent` → values are 0–100. Better Stack `percent` expects 0–1. **You MUST divide by 100 in the query** or values will display as 4000% instead of 40%.
- Grafana `percentunit` → values are 0–1. Maps directly to Better Stack `percent`. No conversion needed.

**Default unit for counts:** Connection counts, query counts, transaction counts, and similar integer metrics should use `unit: "shortened"` for auto-scaling (1.5K, 2.3M). Do NOT leave unit unset on count metrics.

---

## Naming Convention

Follow the `dashboard-builder` skill's naming rules (sentence case, no abbreviations, no units or parentheses in titles). Grafana templates often use "Avg"/"Max"/"Config" and parenthetical units ("Output events bytes rate (bytes/sec)") — always expand/strip at chart-create time.

---

## Line Chart Patterns

### Counter Rate with Label

**PromQL:** `irate(node_network_receive_bytes_total{device="eth0"}[5m])`

```sql
SELECT {{time}} AS time, label('device') AS series, avgMerge(rate_avg) AS "Bytes received"
FROM {{source}}
WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}}
  AND name = 'node_network_receive_bytes_total'
GROUP BY time, series ORDER BY time
```

### Sum by Label

**PromQL:** `sum by (mode)(irate(node_cpu_seconds_total[5m]))`

```sql
WITH cpu AS (
  SELECT {{time}} AS time, label('mode') AS mode, label('cpu') AS cpu, avgMerge(rate_avg) AS rate
  FROM {{source}}
  WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}} AND name = 'node_cpu_seconds_total'
  GROUP BY time, mode, cpu
)
SELECT time, mode AS series, sum(rate) AS "CPU usage" FROM cpu GROUP BY time, mode ORDER BY time
```

### Multi-Metric Arithmetic

**PromQL:** `(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)`

```sql
WITH mem AS (
  SELECT {{time}} AS time, name, avgMerge(value_avg) AS value
  FROM {{source}}
  WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}}
    AND name IN ('node_memory_MemTotal_bytes', 'node_memory_MemAvailable_bytes')
  GROUP BY time, name
)
SELECT time,
  (1 - sumIf(value, name='node_memory_MemAvailable_bytes') / sumIf(value, name='node_memory_MemTotal_bytes')) AS "Memory used"
FROM mem GROUP BY time ORDER BY time
```

### Multiple Metrics as Series

**PromQL:** `node_memory_Cached_bytes`, `node_memory_Buffers_bytes` (separate targets)

```sql
SELECT {{time}} AS time,
  multiIf(name='node_memory_Cached_bytes', 'Cache', name='node_memory_Buffers_bytes', 'Buffers', name) AS series,
  avgMerge(value_avg) AS "Usage"
FROM {{source}}
WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}}
  AND name IN ('node_memory_Cached_bytes', 'node_memory_Buffers_bytes')
GROUP BY time, name ORDER BY time
```

### Composite Series — Tag + Metric Direction

When a chart shows multiple metrics (e.g., bytes in/out) grouped by an instance tag, concat both dimensions into the series label. This is critical for multi-instance deployments where "Bytes in" / "Bytes out" alone doesn't identify which instance.

**Pattern:** `concat(label('instance_tag'), ' ', direction_label)`

```sql
-- Bytes in/out per broker (Kafka example)
SELECT {{time}} AS time,
  concat(label('instance'), ' ', multiIf(name = 'bytes_in_metric', 'in', 'out')) AS series,
  avgMerge(rate_avg) AS "Throughput"
FROM {{source}}
WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}}
  AND name IN ('bytes_in_metric', 'bytes_out_metric')
GROUP BY time, name, series ORDER BY time
```

**When to use:** Any chart combining multiple metrics (in/out, read/write, sent/received) where instances are also grouped by a tag. Without this, multi-instance deployments show ambiguous series like "in", "out" with no way to tell which instance they belong to.

### Bytes to Bits (Network Traffic)

**PromQL:** `rate(node_network_receive_bytes_total[5m]) * 8`

```sql
SELECT {{time}} AS time,
  concat(if(name='node_network_receive_bytes_total', 'Rx ', 'Tx '), label('device')) AS series,
  avgMerge(rate_avg) * 8 AS "Throughput"
FROM {{source}}
WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}}
  AND name IN ('node_network_receive_bytes_total', 'node_network_transmit_bytes_total')
GROUP BY time, name, label('device') ORDER BY time
```

### CloudWatch Line Chart — Average

**Grafana:** `AWS/RDS` / `CPUUtilization` / `Average` / dims: `DBInstanceIdentifier = $dbinstance`

```sql
SELECT {{time}} AS time, label('db_instance_identifier') AS series,
  avgMerge(value_avg) AS "CPU utilization"
FROM {{source}}
WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}}
  AND name = 'aws_rds_cpuutilization_average'
  AND label('db_instance_identifier') IS NOT NULL
GROUP BY time, series ORDER BY time
```

### CloudWatch Line Chart — Sum (Request Count)

**Grafana:** `AWS/ELB` / `RequestCount` / `Sum`

```sql
SELECT {{time}} AS time, maxMerge(value_max) AS "Request count"
FROM {{source}}
WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}}
  AND name = 'aws_elb_request_count_sum'
GROUP BY time ORDER BY time
```

---

## Gauge/Number Chart Patterns

**For irate() in gauges, always use argMax() pattern**

### Simple irate (Gauge)

**PromQL:** `irate(node_pressure_cpu_waiting_seconds_total[5m])`

```sql
SELECT 'CPU Pressure' AS series, argMax(rate, time) AS "Pressure"
FROM (
  SELECT {{time}} AS time, avgMerge(rate_avg) AS rate
  FROM {{source}}
  WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}}
    AND name = 'node_pressure_cpu_waiting_seconds_total'
  GROUP BY time
)
```

### avg(irate()) Across Labels — CPU Busy %

**PromQL:** `100 * (1 - avg(irate(node_cpu_seconds_total{mode="idle"}[5m])))`

```sql
WITH cpu_rates AS (
  SELECT {{time}} AS time, label('cpu') AS cpu, avgMerge(rate_avg) AS rate
  FROM {{source}}
  WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}}
    AND name = 'node_cpu_seconds_total' AND label('mode') = 'idle'
  GROUP BY time, cpu
),
latest_per_cpu AS (
  SELECT cpu, argMax(rate, time) AS rate
  FROM cpu_rates
  GROUP BY cpu
)
SELECT 'CPU Busy' AS series, (1 - avg(rate)) AS "CPU busy"
FROM latest_per_cpu
```

Returns 0–1. Use `unit: percent`, `y_axis_max: 1`.

### Instant Gauge Value (non-rate)

**PromQL:** `node_memory_MemFree_bytes`

```sql
SELECT 'Memory Free' AS series, argMax(value, time) AS "Memory free"
FROM (
  SELECT {{time}} AS time, avgMerge(value_avg) AS value
  FROM {{source}}
  WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}}
    AND name = 'node_memory_MemFree_bytes'
  GROUP BY time
)
```

### Uptime (Monotonic Timestamps)

**PromQL:** `node_time_seconds - node_boot_time_seconds`

```sql
WITH metrics AS (
  SELECT name, maxMerge(value_max) AS value
  FROM {{source}}
  WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}}
    AND name IN ('node_time_seconds', 'node_boot_time_seconds')
  GROUP BY name
)
SELECT 'Uptime' AS series,
  sumIf(value, name = 'node_time_seconds') - sumIf(value, name = 'node_boot_time_seconds') AS "Uptime"
FROM metrics
```

Use `maxMerge(value_max)` for timestamps — they increase monotonically so max = latest.

### Static Number (RAM Total)

**PromQL:** `node_memory_MemTotal_bytes`

```sql
SELECT 'RAM Total' AS series, avgMerge(value_avg) AS "RAM total"
FROM {{source}}
WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}} AND name = 'node_memory_MemTotal_bytes'
```

No time grouping needed for static values.

### CloudWatch Number Chart

**Grafana:** `AWS/RDS` / `FreeableMemory` / `Average` / stat panel with `lastNotNull`

```sql
SELECT 'Freeable memory' AS series, argMax(value, time) AS "Freeable memory"
FROM (
  SELECT {{time}} AS time, avgMerge(value_avg) AS value
  FROM {{source}}
  WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}}
    AND name = 'aws_rds_freeable_memory_average'
  GROUP BY time
)
```

### Grafana Stat reduceOptions Mapping

Grafana stat panels have `reduceOptions.calcs` controlling how values reduce:

| Grafana calc  | ClickHouse equivalent               | Notes                      |
| ------------- | ----------------------------------- | -------------------------- |
| `lastNotNull` | `argMax(value, time)` from subquery | Most recent non-null value |
| `last`        | `argMax(value, time)` from subquery | Same in practice           |
| `mean`        | Plain query (no wrapper)            | Average over window        |
| `max`         | CTE + `MAX()` wrapper               | Peak over window           |
| `min`         | CTE + `MIN()` wrapper               | Minimum over window        |
| `sum`         | CTE + `SUM()` wrapper               | Total over window          |
| `count`       | CTE + `COUNT()` wrapper             | Number of data points      |

---

## Layout Conversion

- **Grafana grid:** 24 columns → divide x and w by 2 for Better Stack's 12-column grid
- **Heights:** Always `height: 6` (ignore Grafana heights)
- **Rows:** `type: "row"` panels → `section: "Row Title"`

Then apply the `dashboard-layout` skill's rules and planning process (rows sum to 12, prefer 3 per row, no full-width charts, no orphan rows, number charts ≤ w:4).

---

## Additional Rules

For series_column, value_columns, legend, section organization, pie charts, stacking, and treat_missing_values — see `dashboard-builder` skill.

**Import-specific:** Latency — always check the source metric's native unit FIRST with `query` before applying any conversion. Some metrics are in seconds (→ `* 1000`, `unit: "ms"`), others are already in milliseconds. Don't assume.

---

## Common Pitfalls

1. **Macros in nested queries** — `{{time}}`, `label()`, `{{source}}` only work directly against `{{source}}`, not in outer queries. See `dashboard-builder` skill.

2. **Nested aggregates forbidden** → Use CTEs for `sum by (label)(rate(...))` patterns.

3. **Uptime/timestamps** → Use `maxMerge(value_max)` not `avgMerge(value_avg)`.

4. **Gauge/number charts need series label** → Always include `'Label' AS series`. Number charts only display the chart title, so make it descriptive.

5. **Always validate queries** — Run `query` before creating charts. A broken chart wastes more time than validating upfront.
