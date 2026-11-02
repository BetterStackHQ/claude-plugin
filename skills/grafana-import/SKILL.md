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
   - CloudWatch metrics: translate `namespace/metricName` → underscore format with suffix (see `references/cloudwatch-translation.md`)
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
   - CloudWatch → use the CloudWatch translation rules in `references/cloudwatch-translation.md`
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

**CloudWatch dimensions are snake_case** — `DBInstanceIdentifier` → `db_instance_identifier`. See `references/cloudwatch-translation.md` for the full mapping.

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

For CloudWatch panels, read `references/cloudwatch-translation.md` (in this skill's directory): metric name translation, statistic mapping, the `Sum` statistic and hidden dimensions, dimension mapping and filters, and metric math.

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

Read `references/chart-patterns.md` (in this skill's directory) before you write a panel's query: it has worked PromQL and CloudWatch → ClickHouse translations for line charts (counter rates, sums by label, arithmetic, composite series, bytes to bits) and for gauge and number charts (irate, instant values, uptime, static numbers, Grafana Stat `reduceOptions`).

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
