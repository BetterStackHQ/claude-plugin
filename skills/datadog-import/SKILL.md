---
name: datadog-import
description: Import Datadog dashboards from exported JSON files. Translates Datadog metric queries to ClickHouse. Load when user asks to import, convert, or recreate a Datadog dashboard in Better Stack.
---

# Datadog Dashboard Import

## Quick Start

```bash
node <this skill's directory>/scripts/extract-layout.js --file <path-to-json>
```

## Tool Setup

You need the Better Stack dashboard tools (`create_dashboard`, `add_chart_to_dashboard`, `set_dashboard_variable`) and the query tools (`sources`, `source`, `metrics_schema`, `query`). If your client loads tools on demand, load them before starting.

The extract script is `scripts/extract-layout.js` in this skill's directory, run with Node.js 18 or newer. If you can't run scripts, read the export yourself and pull out the same fields: sections, panels, their queries, units and template variables.

**Related skills (load before creating charts):**

- `dashboard-builder` — naming, series/labels, chart conventions, stacking, pitfalls
- `dashboard-layout` — layout rules, row templates, planning process
- `metrics-query` — query syntax, merge functions
- `chart-generation` — chart types, units, axis settings

## Workflow

1. **Extract:** `node scripts/extract-layout.js --file <path-to-json>`
2. **Check metrics:** `metrics_schema(id: source_id, name_filter: "<prefix>*")` — identify available metrics AND their tags
3. **Create dashboard:** `create_dashboard(source_id, name)`
4. **Translate template variables** — For each `template_variables` entry in the export, create a Better Stack variable with `set_dashboard_variable` AND reference it in the queries that used `$name` via an optional `[[ ]]` clause. Never silently omit them. See Template Variable Translation below.
5. **DISCOVER TAG NAMES FROM REAL DATA** — Before writing any queries, discover actual tag/label names by querying the source:
   - Run: `SELECT DISTINCT tags FROM {{source}} WHERE name = 'your.first.metric' LIMIT 5` — this returns the Map keys as they actually exist in the data
   - Read the keys from the result — use those exact strings in `label()` calls. Do NOT guess or convert from Datadog naming conventions. The real data is the only source of truth.
   - Tag names are typically snake_case (e.g. `db_instance_identifier`) but always verify — never assume
   - Write down the discovered tag names and use them consistently for ALL queries on this source
6. **Build queries** — Load `metrics-query` skill, then translate Datadog → ClickHouse using rules below. For EACH query, check:
   - Match the Datadog aggregation prefix (`avg:`/`sum:`/`max:`/`min:`) to the correct merge function — do NOT default everything to `avgMerge`
   - Check for `.as_count()` — needs `avg * count` on Prometheus
   - Check for hidden tag dimensions on `sum:`/`max:`/`min:` prefixes
7. **VALIDATE EVERY QUERY** — Run each query via `query` BEFORE creating the chart:
   - Replace `{{source}}` with the actual table, `{{time}}`/`{{start_time}}`/`{{end_time}}` with real values
   - Verify data exists (not all NULL) and labels resolve to real names (not "null")
   - For GROUP BY queries: confirm the series column shows actual values (instance names, cluster names) — if it shows "null", the label name is wrong
   - For `sum:`/`max:`/`min:` queries: compare value against Datadog — if significantly lower, check for missing tag dimensions
   - If a query fails or returns nulls, fix it before proceeding — do NOT create charts with broken queries
8. **Plan layout** — For each section, plan the full row layout BEFORE creating charts (see Layout Planning below). Log the plan visibly.
9. **Add charts** — Load `chart-generation` skill, then create charts in exact row order with validated queries. Always pass `height: 6` and `section: "Name"`.
10. **Cross-check values** — Compare a few key metrics against Datadog to verify correctness

### Context management

Each dashboard is a self-contained unit. If importing multiple dashboards:

- Complete one dashboard fully before starting the next
- If context runs low mid-dashboard, finish the current dashboard first — don't start new ones

### No-data mode (blind import)

**Use ONLY when explicitly requested** (e.g., "import without data", "no metrics available", "blind import"). Never default to this mode — always try the normal workflow first.

When the service has no metric data in Better Stack (e.g., infrastructure was torn down, not yet deployed, or a service like MSK that never emitted metrics), you cannot validate queries. Instead:

1. **Extract layout** as normal with the extract script
2. **Skip `metrics_schema`** — you can't discover metrics or tags from live data
3. **Derive metric names from the Datadog query** — dots are preserved, add suffix for the variant:
   - Keep dots as-is: `aws.kafka.messages_in_per_sec` stays `aws.kafka.messages_in_per_sec`
   - Add suffix for non-average variants: `_sum`, `_max`, `_min`, `_count`
   - The base name (no suffix) stores the average — use it for `avg:` prefix queries
   - For `sum:` prefix on CloudWatch: use `<metric>_sum` with `maxMerge(value_max)`
   - Example: `sum:aws.lambda.invocations{*}` → metric name `aws.lambda.invocations_sum`
4. **Derive tag names from the Datadog `by {tag}` clause** — convert to snake_case:
   - `by {cluster_name}` → `label('cluster_name')`
   - `by {ConsumerGroup}` → `label('consumer_group')`
   - When the Datadog query uses `$scope` or `$var` filters with a tag, that tag exists
5. **Build queries using known patterns** — follow ALL translation rules from this skill (aggregation prefix mapping, hidden tag dimensions, `{{time}}` macro rules, etc.)
6. **Self-review every query before creating the chart:**
   - Re-read the SQL character by character
   - Check: Does `{{time}}` only appear where `dt` is in scope? (pitfall #1)
   - Check: Does `value_columns` match the SQL alias exactly?
   - Check: Is the merge function correct for the prefix? (`avg:` → `avgMerge`, `max:` → `maxMerge`, etc.)
   - Check: Are tag names snake_case in `label()` calls?
   - Check: Is `series_column` set when there's a GROUP BY on a tag?
   - Check: For `unit: "percent"`, are values 0–1? (query raw values first — some AWS metrics are 0–1, others are 0–100)
7. **Create the dashboard and charts** — follow all layout rules, height: 6, section naming
8. **Skip cross-checking** — there's no data to compare against

**Key principle:** In no-data mode, the queries may not return results, but they must be **structurally correct** so they work once data starts flowing. A broken query (wrong column name, bad syntax, missing GROUP BY) is worse than no chart at all.

---

## Interpreting Extract Script Output

The extract script shows: `chart_type (DD: datadog_type) [response_format]`

**Decision tree for each chart:**

1. **Check `[response_format]`** — most important indicator:
   - `[scalar]` → Single value. NO `{{time}}`, NO `GROUP BY time`
   - `[timeseries]` → Time-series. MUST have `{{time}} AS time` and `GROUP BY time`

2. **Check `(DD: datadog_type)`** — determines chart type:
   - `(DD: timeseries:bars)` → `bar_chart` WITH time dimension (stacked bars over time)
   - `(DD: timeseries:area)` → `line_chart` with `stacking: "stack"`
   - `(DD: timeseries)` → `line_chart` (default)
   - `(DD: toplist)` → `bar_chart` WITHOUT time, add `ORDER BY value DESC LIMIT N`
   - `(DD: query_value)` → `number_chart`, single scalar value

3. **Check for `by {tags}`** in the query:
   - Present → Add `label('snake_case_tag') AS series` and include `series` in GROUP BY
   - Absent with `sum:`/`max:`/`min:` prefix → CHECK `metrics_schema` for ALL tags, GROUP BY all, aggregate in outer query

4. **Check aggregation prefix** (`sum:`, `avg:`, `max:`):
   - `sum:`/`max:`/`min:` without `by` → **Must** aggregate across tag dimensions (see CRITICAL section below)
   - `avg:` → Plain `avgMerge()`, do NOT sum across tags

**Example interpretations:**

```
bar_chart (DD: timeseries:bars) [timeseries]
  query1: `sum:aws.s3.get_requests{...} by {bucketname} .as_count()`
```

→ Time-series bar chart, grouped by bucket, needs `{{time}}` + `GROUP BY time, series`

```
number_chart (DD: query_value) [scalar]
  query1: `sum:aws.s3.bucket_size_bytes{...}` [aggregator: max]
```

→ Single value, no time. Check tags with `metrics_schema`, GROUP BY all tags, SUM in outer query

```
bar_chart (DD: toplist) [scalar]
  query1: `max:aws.s3.latency{...} by {bucket}` [aggregator: avg]
  sort: desc, limit: 10
```

→ Static ranking, no time dimension, group by bucket, ORDER BY DESC LIMIT 10

---

## Quick Reference

```
[scalar]                     → NO {{time}}, single value
[timeseries]                 → MUST have {{time}} AS time, GROUP BY time
(DD: timeseries:bars)        → bar_chart WITH time dimension
(DD: toplist)                → bar_chart WITHOUT time dimension
avg:metric{filters}          → avgMerge(value_avg) — do NOT sum across tags
sum:metric{filters}          → Check tags! GROUP BY all tags + SUM wrapper. CloudWatch _sum metrics: maxMerge(value_max). Others: avgMerge(value_avg)
max:metric{filters}          → maxMerge(value_max) — same hidden-tag issue as sum: on toplists/numbers
min:metric{filters}          → minMerge(value_min) — same hidden-tag issue
by {tag}                     → label('snake_case_tag') AS series + GROUP BY series
{$var}                       → create a dashboard variable + reference with [[ ]] (see Template Variable Translation)
.as_count()                  → sumMerge(value_sum) if column exists; avgMerge(value_avg) * countMerge(events_count) on Prometheus (see CRITICAL note below)
.as_rate()                   → avgMerge(rate_avg)
.rollup(avg, N)              → ignore, {{time}} handles this
.fill(zero)                  → use treat_missing_values: "zero" chart setting
stacked line chart           → ALWAYS use treat_missing_values: "previous" (connected causes sawtooth)
formula: 100 * (q1 / q2)    → CTE + sumIf pattern (see metrics-query skill)
```

---

## Datadog → ClickHouse Translation

### Metric Name Translation

Datadog metric names are **preserved with dots** in Better Stack. Each base metric has variants with aggregation suffixes:

| Datadog metric                | Better Stack base name        | Variants                                                         |
| ----------------------------- | ----------------------------- | ---------------------------------------------------------------- |
| `aws.s3.bucket_size_bytes`    | `aws.s3.bucket_size_bytes`    | `_sum`, `_max`, `_min`, `_count`                                 |
| `aws.lambda.invocations`      | `aws.lambda.invocations`      | `aws.lambda.invocations_sum`, `aws.lambda.invocations_max`, etc. |
| `aws.amazon_mq.enqueue_count` | `aws.amazon_mq.enqueue_count` | `aws.amazon_mq.enqueue_count_sum`, etc.                          |

**Dots are preserved in the namespace** (`aws.<service>.<metric>`). Only the metric's own internal words use underscores (e.g., `bucket_size_bytes`, `enqueue_count`).

Common suffixes: `_sum`, `_count`, `_max`, `_min` (the base name without suffix stores the average)

**Always use `metrics_schema` to discover the actual name:**

```
metrics_schema(id: source_id, name_filter: "aws.s3*")
```

### Aggregation Prefix Mapping

| Datadog prefix | ClickHouse merge function | Notes                                                                         |
| -------------- | ------------------------- | ----------------------------------------------------------------------------- |
| `avg:`         | `avgMerge(value_avg)`     | Default. Do NOT sum across tags                                               |
| `sum:`         | See `sum:` section below  | MUST sum across tag dimensions. Inner merge function depends on metric origin |
| `max:`         | `maxMerge(value_max)`     | Same hidden-tag caveat on toplists/numbers                                    |
| `min:`         | `minMerge(value_min)`     | Same hidden-tag caveat                                                        |
| (no prefix)    | `avgMerge(value_avg)`     | Datadog defaults to avg                                                       |

### CRITICAL: `sum:` Prefix — Inner Merge Function

The `sum:` prefix tells Datadog to **sum across tag dimensions**. The inner merge function depends on the metric's origin:

**CloudWatch metrics** (tags contain `dimension_*`, metric names start with `aws_`):

- Metrics ending in `_sum` → use `maxMerge(value_max)`. These store pre-aggregated counts per CloudWatch interval. The scraper collects them at sub-minute intervals as gauge-like values, so `avgMerge` averages across sub-scrape samples and smooths out the actual count.
- Metrics ending in `_average` → use `avgMerge(value_avg)`

**Native Prometheus / StatsD metrics** (no `dimension_*` tags):

- Use `avgMerge(value_avg)` as default
- Metrics ending in `_total` → use `avgMerge(rate_avg)` (counters)

### CRITICAL: Space Aggregation and Hidden Tag Dimensions

Datadog **implicitly aggregates across ALL tag dimensions** using the prefix's function. In ClickHouse, each tag combination is a separate row, so a plain merge function only aggregates within each tag combo, not across them.

**This applies to `sum:`, `max:`, and `min:` — NOT `avg:` (which already averages correctly).**

**When the query uses `sum:`/`max:`/`min:` with NO `by {tag}` clause**, you MUST:

1. Check `metrics_schema` for ALL tags on the metric
2. GROUP BY ALL tag dimensions
3. Wrap with matching aggregate (SUM/MAX/MIN) in outer query

```sql
-- Datadog: sum:aws.s3.bucket_size_bytes{*}
-- WRONG → gives 1.6TB instead of 5.38TB (averages instead of summing across tags)
SELECT maxMerge(value_max) AS "Bucket Size"
FROM {{source}} WHERE name = 'aws.s3.bucket_size_bytes'

-- CORRECT → GROUP BY all tags, SUM in outer query
SELECT SUM(size) AS "Bucket Size"
FROM (
  SELECT label('bucket_name') AS bucket,
    label('storage_type') AS storage_type,
    maxMerge(value_max) AS size
  FROM {{source}}
  WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}}
    AND name = 'aws.s3.bucket_size_bytes'
  GROUP BY bucket, storage_type
)
```

**With `by {tag}` on TOPLIST charts** — aggregate across OTHER hidden tags per group:

```sql
-- sum: prefix → SUM across hidden StorageType per bucket
SELECT bucket AS series, SUM(size) AS "Size"
FROM (
  SELECT label('bucket_name') AS bucket,
    label('storage_type') AS storage_type,
    avgMerge(value_avg) AS size
  FROM {{source}}
  WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}}
    AND name = 'aws.s3.bucket_size_bytes'
  GROUP BY bucket, storage_type
)
GROUP BY bucket ORDER BY "Size" DESC

-- max: prefix → MAX across hidden tags per bucket
SELECT bucket AS series, MAX(latency) AS "Latency"
FROM (
  SELECT label('bucket_name') AS bucket,
    label('filter_id') AS filter_id,
    maxMerge(value_max) AS latency
  FROM {{source}}
  WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}}
    AND name = 'aws.s3.total_request_latency'
  GROUP BY bucket, filter_id
)
GROUP BY bucket ORDER BY "Latency" DESC
```

**When to apply:**

- ✅ `sum:`/`max:`/`min:` without `by` — number charts especially
- ✅ `sum:`/`max:`/`min:` with `by {tag}` on TOPLIST charts — aggregate across OTHER tags
- ❌ `avg:` — plain `avgMerge()` is correct, NO wrapper
- ❌ Any prefix with `by {tag}` on TIME-SERIES charts — each series is already one tag combo

**Detection:** If value is off by 2-3x vs Datadog, check for hidden tags. Common: `StorageType`, `FilterId`, `Region`, `AccountId`, `device`, `db`, `shard`

### CRITICAL: Aggregation Prefix Must Match Merge Function

The Datadog aggregation prefix (`avg:`, `sum:`, `max:`, `min:`) determines which ClickHouse merge function to use. **Always match the prefix to the function — do NOT default to `avgMerge(value_avg)` for everything.**

```sql
-- Datadog: max:aws.lambda.duration.maximum{*} by {functionname}
-- WRONG — uses avgMerge, returns average of maximums (0.25 instead of 0.39)
SELECT label('function_name') AS fn,
  avgMergeIf(value_avg, name = 'aws.lambda.duration_max') AS duration
...

-- CORRECT — uses maxMerge to get the true peak value
SELECT label('function_name') AS fn,
  maxMergeIf(value_max, name = 'aws.lambda.duration_max') AS duration
...
```

| Prefix | Function                  | Column                                                                  |
| ------ | ------------------------- | ----------------------------------------------------------------------- |
| `avg:` | `avgMerge` / `avgMergeIf` | `value_avg`                                                             |
| `sum:` | Depends on origin         | CloudWatch `_sum`: `maxMerge(value_max)`. Others: `avgMerge(value_avg)` |
| `max:` | `maxMerge` / `maxMergeIf` | `value_max`                                                             |
| `min:` | `minMerge` / `minMergeIf` | `value_min`                                                             |

### Tag Access — `label()` with snake_case keys

Use `label('tag_name')` to access metric tags. **Tag names are snake_case** — this is the #1 source of null labels.

```sql
-- Access a tag value
label('db_instance_identifier') AS instance

-- Filter by tag
WHERE label('engine') = 'postgres'

-- Group by tag
GROUP BY label('db_instance_identifier')

-- Filter out aggregate rows (no instance tag)
WHERE label('db_instance_identifier') != ''
```

**Tag naming — CRITICAL:** AWS CloudWatch tags are stored in **snake_case**, NOT CamelCase or dimension-prefixed. Always convert:

| Datadog tag                      | ClickHouse label key     |
| -------------------------------- | ------------------------ |
| `DBInstanceIdentifier`           | `db_instance_identifier` |
| `DBClusterIdentifier`            | `db_cluster_identifier`  |
| `dimension_DBInstanceIdentifier` | `db_instance_identifier` |
| `EngineName`                     | `engine_name`            |
| `FunctionName`                   | `function_name`          |
| `BucketName`                     | `bucket_name`            |
| `StorageType`                    | `storage_type`           |

**Engine-specific dashboards:** When importing a dashboard scoped to a specific engine or service variant, add a `WHERE label('engine_or_variant_tag')` filter to ALL queries — including aggregate/cluster-level queries that might otherwise mix data from different variants.

**Multiple aggregation levels:** AWS metrics often have multiple series at different granularities (account-level, cluster-level, instance-level). Some rows have absent instance tags. Always filter to the correct level.

**CRITICAL: `label()` returns NULL (not empty string) for absent tags.** Using `= ''` or `!= ''` does NOT work — both evaluate to NULL and exclude the row. Use `IS NULL` / `IS NOT NULL`:

```sql
-- Instance-level only (tag present)
WHERE label('db_instance_identifier') IS NOT NULL
-- Cluster-level only (cluster present, instance absent)
WHERE label('db_cluster_identifier') IS NOT NULL AND label('db_instance_identifier') IS NULL
```

**IMPORTANT:** Always discover the actual tag names first (workflow step 5's `SELECT DISTINCT tags` probe).

### Filter Translation

| Datadog filter        | ClickHouse equivalent                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `{*}`                 | (no extra filter)                                                                        |
| `{tag:value}`         | `AND label('snake_case_tag') = 'value'`                                                  |
| `{tag:val1,tag:val2}` | `AND label('snake_case_tag') IN ('val1', 'val2')`                                        |
| `{!tag:value}`        | `AND label('snake_case_tag') != 'value'`                                                 |
| `{$variable}`         | Create a dashboard variable + reference with `[[ ]]` (see Template Variable Translation) |

### Group-by Translation

| Datadog          | ClickHouse                                                    |
| ---------------- | ------------------------------------------------------------- |
| `by {tag}`       | `label('snake_case_tag') AS series` + `GROUP BY time, series` |
| `by {tag1,tag2}` | `concat(label('tag1'), ' - ', label('tag2')) AS series`       |

### Template Variable Translation

Datadog `template_variables` (the `$var` selectors at the top of the dashboard) must be recreated as **Better Stack dashboard variables** — do NOT silently drop them, or the imported dashboard loses its filters. A variable is only shown once a query references it, so you must do BOTH steps below.

For each entry in the export's `template_variables`:

1. **Create the variable** with `set_dashboard_variable` (type reference: `dashboard-builder` skill → "Dashboard template variables"):
   - Tag-backed (has a `prefix`, e.g. `prefix: "service"`) → `multi_select_with_sql`, `sql_definition: "label('<prefix_snake_case>')"` — the user picks real values from the data.
   - Fixed enumerated list (`available_values`, no useful tag) → `select_value`, `default_values: [the values]`.
2. **Reference it in every query that used `$name`**, as an OPTIONAL `[[ ]]` clause so charts still render with nothing selected (matches Datadog's "all" default):
   - multi: `[[ AND match(label('<tag>'), {{name}}) ]]`
   - single: `[[ AND label('<tag>') = {{name}} ]]`

Name the variable after the Datadog variable's `name` (snake_case it). Skip variables that only scope the time range — Better Stack's `{{start_time}}`/`{{end_time}}`/`{{time}}` already cover those.

Example — `template_variables: [{ name: "service", prefix: "service" }]`, query `avg:trace.flask.request.hits{service:$service} by {resource_name}`:

1. `set_dashboard_variable(dashboard_id, name: "service", variable_type: "multi_select_with_sql", sql_definition: "label('service')")`
2. `SELECT {{time}} AS time, label('resource_name') AS series, avgMerge(value_avg) AS "Hits" FROM {{source}} WHERE name = 'trace.flask.request.hits' [[ AND match(label('service'), {{service}}) ]] GROUP BY time, series`

### Scalar Aggregator Translation (number charts / toplists)

Scalar requests have an `aggregator` field controlling how values reduce over the time window:

| Datadog aggregator | ClickHouse equivalent    | Notes                         |
| ------------------ | ------------------------ | ----------------------------- |
| `avg`              | Plain query (no wrapper) | Default behavior              |
| `max`              | CTE + `MAX()` wrapper    | Peak value over window        |
| `min`              | CTE + `MIN()` wrapper    | Minimum over window           |
| `last`             | Plain query (no wrapper) | Recent data approximates this |
| `sum`              | CTE + `SUM()` wrapper    | Total over window             |

Example — `aggregator: max`:

```sql
WITH per_time AS (
  SELECT {{time}} AS time, avgMerge(rate_avg) AS rate
  FROM {{source}}
  WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}}
    AND name = 'metric_name'
  GROUP BY time
)
SELECT MAX(rate) AS "Peak Rate" FROM per_time
```

### Modifier Translation

| Datadog modifier  | ClickHouse handling                                                                                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.as_count()`     | `sumMerge(value_sum)` if column exists; fallback `avgMerge(value_avg) * countMerge(events_count)` on Prometheus (reconstructs true sum from avg × count) |
| `.as_rate()`      | `avgMerge(rate_avg)`                                                                                                                                     |
| `.fill(zero)`     | Use `treat_missing_values: "zero"` chart setting                                                                                                         |
| `.rollup(avg, N)` | Ignore — `{{time}}` bucketing handles this                                                                                                               |

### Formula Translation

| Datadog formula       | ClickHouse equivalent                               |
| --------------------- | --------------------------------------------------- |
| `query1 + query2`     | CTE + `sumIf(val, name='a') + sumIf(val, name='b')` |
| `query1 / query2`     | CTE + `sumIf(val, name='a') / sumIf(val, name='b')` |
| `0 - query1`          | `-avgMerge(value_avg)` (negation)                   |
| `top(query1, N, ...)` | Just use grouped query — charts auto-limit series   |
| `default(query1, N)`  | `COALESCE(avgMerge(value_avg), N)`                  |

### Untranslatable Features (skip or add as note)

`forecast()`, `week_before()`, `month_before()`, `timeshift()`, `anomalies()`, `outliers()`, `change()`

---

## Widget Type Mapping

| Datadog widget       | Extract output                     | Better Stack chart  | Notes                               |
| -------------------- | ---------------------------------- | ------------------- | ----------------------------------- |
| `timeseries`         | `line_chart (DD: timeseries)`      | `line_chart`        | Time-series with `{{time}}`         |
| `timeseries` (bars)  | `bar_chart (DD: timeseries:bars)`  | `bar_chart`         | Time-series bars — needs `{{time}}` |
| `timeseries` (area)  | `line_chart (DD: timeseries:area)` | `line_chart`        | `stacking: "stack"`                 |
| `query_value`        | `number_chart (DD: query_value)`   | `number_chart`      | Single value, no time               |
| `toplist`            | `bar_chart (DD: toplist)`          | `bar_chart`         | Static ranking, no time             |
| `query_table`        | `table_chart`                      | `table_chart`       |                                     |
| `treemap`/`sunburst` | `pie_chart`                        | `pie_chart`         |                                     |
| `heatmap`            | `heatmap_chart`                    | `heatmap_chart`     |                                     |
| `change`             | `number_chart`                     | `number_chart`      | Current value only                  |
| `note`               | —                                  | `static_text_chart` | Informational                       |

**Skip:** `image`, `check_status`, `manage_status`, `list_stream`, `hostmap`, `embedded_app`, `event_timeline`, `event_stream`, `free_text`

**Skip non-metrics data sources:** `logs`, `events`, `network`, `database_recommendations_stream`

### Bar chart configuration

Datadog **toplist / `[scalar]`** → category bar chart (no `{{time}}`); **timeseries:bars / `[timeseries]`** → time-series bar chart. Configure per the `chart-generation` skill's Bar Chart Configuration (category bars need `x_axis_type: "category"` + `time_column: "series"`).

---

## Unit Mapping (Datadog → Better Stack)

The extract script auto-maps common units. Notable Datadog-specific mappings:

| Datadog               | Better Stack | Notes |
| --------------------- | ------------ | ----- |
| `byte`                | `B_si`       |       |
| `kibibyte`/`mebibyte` | `B_iec`      |       |
| `operation`           | `e/s`        |       |
| `request`             | `rps`        |       |
| (no unit)             | `shortened`  |       |

**Default unit for counts:** Connection counts, query counts, transaction counts, and similar integer metrics should use `unit: "shortened"` for auto-scaling (1.5K, 2.3M). Do NOT leave unit unset on count metrics.

See `chart-generation` skill for full unit reference and the 0-1 percentage rule.

---

## Naming Convention

Follow the `dashboard-builder` skill's naming rules (sentence case, no abbreviations, no units or parentheses in titles) — e.g. "CPU utilization", not "CPU utilization (%)".

## Layout Conversion

- **Ordered layout:** Groups → sections (`section: "Group Title"`). Grid is 12-column.
- **Free layout:** Convert absolute coords to 12-col grid. Colored note widgets → sections.
- Ignore Datadog heights — always use `height: 6`.

See `dashboard-layout` skill for layout rules, row templates, and the mandatory planning process.

---

## General chart rules

Series/labels, legends, section organization, pie-chart rules, units, stacking, and treat_missing_values all follow the `dashboard-builder` skill — apply its rules and checklist.

### Import-specific checklist

Before creating each chart, verify the items in the `dashboard-builder` checklist plus:

- [ ] If engine-specific dashboard → ALL queries filter by engine
- [ ] Replication lag uses the correct metric for the dashboard's engine scope
- [ ] If bar chart with no `{{time}}` → `x_axis_type: "category"`, `time_column: "series"`
- [ ] If `unit: "percent"` → values MUST be 0–1 range. Query raw values first to check — divide by 100 only if 0–100
- [ ] If count metric (connections, queries, transactions) → `unit: "shortened"`

**Import-specific latency note:** check the source metric's native unit FIRST. AWS CloudWatch `read_latency` and `write_latency` are in seconds (→ `* 1000`, `unit: "ms"`). But `commit_latency` is already in milliseconds (→ NO multiplication). Always verify with `query` before applying `* 1000`.

---

## Common Pitfalls

1. **Macros in nested queries** — See `dashboard-builder` skill. `{{time}}`, `label()`, and `{{source}}` only work directly against `{{source}}`, not in outer queries wrapping subqueries.
2. **Hidden tag dimensions** — `sum:`/`max:`/`min:` without `by` loses tags. Check `metrics_schema`, GROUP BY all, aggregate in outer query. If value is off by 2-3x, you're missing a tag.
3. **Hidden tags on toplists too** — `sum:`/`max:` WITH `by {tag}` still needs to aggregate across OTHER hidden tags per group. However, if the `by {tag}` already uniquely identifies each series (no other hidden dimensions), use a simple single-level `maxMerge(value_max) GROUP BY tag` — unnecessary double-wrapping can cause ordering issues.
4. **`sum:` vs `avg:` confusion** — `sum:` needs GROUP BY + SUM wrapper. `avg:` needs plain `avgMerge()`, NO wrapper. Off by Nx if wrong.
5. **toplist vs timeseries:bars** — Both map to `bar_chart`. `[scalar]` = no time. `[timeseries]` = needs `{{time}}`. Check `[response_format]`.
6. **Not validating queries** — ALWAYS validate via `query` before creating charts.
7. **Ignoring scalar `aggregator`** — `aggregator: "max"` means peak over window, needs CTE + `MAX()`.
8. **`.as_count()` on Prometheus** — Prometheus sources lack `value_sum`. Using plain `avgMerge(value_avg)` gives only the average per bucket, NOT the true count — values will be orders of magnitude too low on toplists/number charts. The correct fallback is `avgMerge(value_avg) * countMerge(events_count)`, which reconstructs the original sum from the pre-aggregated average and data point count. **Detection:** if toplist/number values are ~10-100x lower than Datadog, this is likely the cause.
9. **Metric name mismatch** — Datadog metric names preserve dots in Better Stack (e.g., `aws.lambda.invocations_sum`). Do NOT convert dots to underscores. Always verify with `metrics_schema`.
10. **`.fill(zero)` as SQL** — Use `treat_missing_values: "zero"` chart setting, not COALESCE.
11. **`sum:` prefix on CloudWatch `_sum` metrics** — CloudWatch `_sum` metrics (e.g., `aws.dynamo_db.throttled_requests_sum`, `aws.lambda.errors_sum`) store pre-aggregated counts per interval. They are scraped at sub-minute intervals as gauge-like values. Using `avgMerge(value_avg)` averages across sub-scrape samples, smoothing out spikes (e.g., showing 60 instead of 2,000). Use `maxMerge(value_max)` for these. **Detection:** metric starts with `aws.`, ends in `_sum`. This does NOT apply to native Prometheus `_sum` metrics (like histogram sums) — those use `avgMerge(value_avg)` normally.
12. **Percentage metrics — verify raw values before using `unit: "percent"`** — `unit: "percent"` expects 0–1 input and multiplies by 100 for display. Cloud provider metrics are inconsistent — some report 0–1, others 0–100. ALWAYS query raw values first (`SELECT avgMerge(value_avg) ... LIMIT 5`) to determine the range before deciding whether to divide by 100.

    ```sql
    -- If raw values are 0–1 (e.g., 0.0005): use directly
    avgMerge(value_avg) AS "CPU utilization"  -- with unit: "percent" → shows 0.05%

    -- If raw values are 0–100 (e.g., 40.5): divide by 100
    avgMerge(value_avg) / 100 AS "CPU utilization"  -- with unit: "percent" → shows 40.5%

    -- Computed ratio: never multiply by 100
    (db_conn / max_allowed) AS "Connections used"  -- with unit: "percent"
    ```
