---
name: chart-generation
description: Complete reference for chart types, units, and settings on Better Stack dashboards. Load right before creating charts - after the queries are built with the query skills.
---

# Chart Generation Guide

This guide covers everything needed to create properly configured charts using the `add_chart_to_dashboard` and `edit_chart` tools. `chart_building_help` has the server's current reference.

To make a chart **filterable**, define a template variable with `set_dashboard_variable`, then reference it in the query as `{{var}}` (required) or `[[ ... {{var}} ... ]]` (optional). See the `dashboard-builder` skill's "Dashboard template variables" section.

## Chart Types

| Type                | Use Case                                                   | Key Requirement                                                                              |
| ------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `line_chart`        | Time-series trends, metrics over time                      | Query must have `time` column                                                                |
| `bar_chart`         | Comparisons, distributions                                 | Works with time or categories                                                                |
| `number_chart`      | Single KPI, current value                                  | Shows latest/aggregated value                                                                |
| `table_chart`       | Detailed data, logs, breakdowns                            | Any columnar data                                                                            |
| `pie_chart`         | Distribution, proportions                                  | Needs series + value columns                                                                 |
| `heatmap_chart`     | Correlation, density over time                             | Needs time, series, value                                                                    |
| `scatter_chart`     | Correlation between variables                              | X/Y numeric columns                                                                          |
| `gauge_chart`       | Percentage metrics (0-1 range)                             | Single value, use `unit: "percent"`                                                          |
| `map_chart`         | Geographic distribution (by IP, airport, city, or country) | Value column + a `location()` column, grouped by location. Load `map-hierarchy-charts` skill |
| `hierarchy_chart`   | Fleet overview — one colored hexagon per entity (host map) | One row per entity: value column + label column. Load `map-hierarchy-charts` skill           |
| `static_text_chart` | Markdown text, notes, documentation                        | Pass Markdown in `query` param                                                               |

See `metrics-query` skill for query syntax.

Funnels (`funnel_chart`, `funnel_trend_chart`) are not dashboard charts: they live in Explore, built from steps in the Better Stack UI.

## Units Reference

### Data Size

| Unit                         | Description                |
| ---------------------------- | -------------------------- |
| `B_si`                       | Bytes (SI: KB, MB, GB)     |
| `B_iec`                      | Bytes (IEC: KiB, MiB, GiB) |
| `kB`, `MB`, `GB`, `TB`, `PB` | Fixed unit                 |

### Data Transfer Rate

| Unit                         | Description                                   |
| ---------------------------- | --------------------------------------------- |
| `B_si/s`                     | Bytes per second (auto-scale)                 |
| `kB/s`, `MB/s`, `GB/s`       | Fixed rate unit                               |
| `bit_si/s`                   | Bits per second (auto-scale: bps, kbps, Mbps) |
| `kbit/s`, `Mbit/s`, `Gbit/s` | Fixed rate unit (renders as kbps, Mbps, Gbps) |

### Duration

| Unit | Description  |
| ---- | ------------ |
| `ns` | Nanoseconds  |
| `μs` | Microseconds |
| `ms` | Milliseconds |
| `s`  | Seconds      |
| `m`  | Minutes      |
| `h`  | Hours        |
| `d`  | Days         |

### Rates & Counts

| Unit        | Description          | Example Output |
| ----------- | -------------------- | -------------- |
| `shortened` | Auto-scale (K, M, B) | 1.5K, 2.3M     |
| `e/s`       | Events per second    | 150 e/s        |
| `rps`       | Requests per second  | 1.2K rps       |
| `rpm`       | Requests per minute  | 72K rpm        |

### Other

| Unit      | Description                                | Example Output        |
| --------- | ------------------------------------------ | --------------------- |
| `percent` | A 0-1 ratio, multiplied by 100 for display | `0.75` renders as 75% |
| `auto`    | Auto-detect                                | varies                |
| `none`    | Raw number                                 | 1234.56               |

### Percent takes 0-1 ratios

`unit: "percent"` multiplies the query's value by 100, so the query must return a 0-1 ratio. Never multiply by 100 in the query: `* 100` with `percent` renders 75% as 7500%. When a metric is already reported 0-100 (e.g. `cpu_percent`), divide it by 100.

```sql
-- GOOD: system_cpu_utilization_ratio is 0-1, so 0.75 renders as 75%
avgMerge(value_avg) AS "CPU usage"

-- BAD with unit: "percent": renders 75% as 7500%
avgMerge(value_avg) * 100 AS "CPU usage"

-- GOOD: a metric that is already 0-100, divided back to 0-1
avgMerge(value_avg) / 100 AS "CPU usage"
```

Every number you set on a `percent` chart is a 0-1 ratio too: `y_axis_max: 1`, gauge `max: 1`, `color_upper_threshold: 0.9`, and a chart alert's threshold `value: 0.9` for 90%.

The exception is `stacking: "stack_to_100"` on a bar chart: it sets `percent` itself and scales each bar to 100% when drawing, so its query returns raw values (counts, not shares).

## Column Mapping

### Core Columns

| Setting         | Purpose                             | Default     |
| --------------- | ----------------------------------- | ----------- |
| `time_column`   | Column for X-axis time              | `"time"`    |
| `series_column` | Column that groups data into series | `"series"`  |
| `value_columns` | Columns with numeric values to plot | `["value"]` |

These settings are optional — inferred from query results when not provided.

### `value_columns`

`value_columns` MUST exactly match the SQL column alias. If the query says `AS "Operations"`, then `value_columns: ["Operations"]`. A mismatch makes the chart appear empty because it can't find the data column — this is the #1 cause of empty charts. Never leave `value_columns` as the default `["value"]` when the SQL uses a descriptive alias.

For single-series charts, use a descriptive alias (not `AS value`):

```sql
SELECT {{time}} AS time, avgMerge(value_avg) AS "Memory usage" FROM ...
-- value_columns: ["Memory usage"]
```

**`AS value` is FORBIDDEN as the metric alias for ANY chart that renders a legend.** The chart engine displays the column alias in the legend when there's no `series_column`, or as the y-axis label / hover tooltip alongside series names when there IS one. A legend or hover that reads "value" is a visible bug. Always alias as the chart title (or a tighter version of it):

- Chart "Request rate" → `AS "Request rate"`, `value_columns: ["Request rate"]`
- Chart "Memory available" → `AS "Memory available"`, `value_columns: ["Memory available"]`
- Chart "Response time by app" → `AS "Response time"`, `value_columns: ["Response time"]`

This applies to single-series AND multi-series charts.

### `series_column` — auto-inferred, set explicitly to control

The backend **auto-infers `series_column` from query result columns when you omit it.** Omitting it does NOT prevent it from being set — to disable it you must explicitly pass `series_column: ""`.

- **Set to `"series"`** when the query has a `GROUP BY` on a label/tag aliased as `series` (e.g., `label('instance_name') AS series ... GROUP BY time, series`).
- **Set to `""` (empty string)** for charts that should have NO series grouping:
  - `number_chart` with a single aggregate value
  - single-aggregate error rate ratios (`errors / total`)
  - any query whose output has no column intended as a grouping label

If `series_column` is set incorrectly, the chart engine interprets data values as series names, producing broken visuals with garbage labels.

## Axis Configuration

### X-Axis Type (`x_axis_type`)

| Value      | Use Case                   |
| ---------- | -------------------------- |
| `time`     | Time-series data (default) |
| `category` | Discrete categories        |
| `value`    | Continuous numeric axis    |

Allowed per chart type: `line_chart` time/value; `bar_chart` and `heatmap_chart` time/category; `scatter_chart` all three. **A line/bar chart with `x_axis_type` other than `time` can't have chart alerts.**

### Y-Axis Type (`y_axis_type`) — scatter only

`scatter_chart` also takes `y_axis_type`: `value` (numeric Y axis, default) or `category` (evenly spaced rows). Other chart types ignore it.

### Y-Axis Scale (`y_axis_scale`)

| Value    | Use Case                                   |
| -------- | ------------------------------------------ |
| `linear` | Most data (default)                        |
| `log`    | Data spanning multiple orders of magnitude |

### Y-Axis Bounds

| Setting      | Purpose       | Example                                                                |
| ------------ | ------------- | ---------------------------------------------------------------------- |
| `y_axis_min` | Force minimum | `0` for percentages                                                    |
| `y_axis_max` | Force maximum | `1` with `unit: "percent"` (0-1 data), `100` for 0-100 data without it |

**Important**: For percentage data calculated as ratio (0-1), set `y_axis_max: 1`, NOT `100`.

## Handling Missing Values (`treat_missing_values`)

**Default: `connected` for non-stacked, `previous` for stacked.** Only deviate when the metric's semantics genuinely require it.

| Value          | When to use                                                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `connected`    | **Default for non-stacked.** Bridges polling gaps — for rates, gauges, percentages, latencies. Missing poll ≠ zero.                    |
| `previous`     | **Default for stacked.** `connected` breaks stacking (sawtooth collapse). Step-shapes between samples.                                 |
| `zero`         | Sparse-event charts where a missing bucket really means "zero events" (rare errors, throttle counts, deadlocks). Or `.fill(0)` source. |
| `disconnected` | Detecting outages — when showing the gap itself is the signal.                                                                         |

**Critical for cloud-pulled metrics (Azure / GCP / AWS / CloudWatch / Prometheus-pull)**: missing data ≠ zero events. These APIs poll on a schedule and occasionally miss a bucket. Using `zero` creates spurious dips that look like outages. Default to `connected` and only switch to `zero` when the source truly fills zeros.

**Stacking restriction**: when `stacking` is `"stack"` or `"stack_to_100"`, only `"previous"` and `"zero"` are available. `"connected"` and `"disconnected"` are not supported for stacked charts.

## Stacking (`stacking`) - Line/Bar Charts

| Value          | Behavior                                                                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `dont_stack`   | Overlapping series (line default)                                                                                                         |
| `stack`        | Stacked series (bar default)                                                                                                              |
| `stack_to_100` | Percentage stacking: sets `percent` itself and scales each bar to 100% when drawing, so its query returns raw values (counts, not shares) |

**Rule**: Stack only series that are **non-overlapping parts of a whole** (e.g. memory `Used + Cache + Free` — and exclude the `Total` series itself, it double-counts its parts). The full stack-vs-don't decision rules (including the default-to-stack style for line charts) live in the `dashboard-builder` skill's Stacking Rules — when both skills are loaded, follow those.

## Legend Placement

Prefer `"shown_below"` placement. Options: `hidden`, `shown_below`, `shown_below_with_statistics` (line/bar/scatter: renders min/mean/max next to each series name), `shown_right`.

## Chart-Specific Settings

| Chart Type        | Key Settings                                                                                                                                                                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `line_chart`      | `stacking` per Stacking section (`dashboard-builder` defaults lines to `stack`); `treat_missing_values`: `"connected"` non-stacked / `"previous"` stacked; `show_previous_period` overlays the prior period for comparison                    |
| `bar_chart`       | `stacking: "stack"`, `orientation: "vertical"` or `"horizontal"`                                                                                                                                                                              |
| `number_chart`    | Coloring via `color_mode` (load `chart-styling` skill). **Series labels are never displayed** — the chart title is the only visible label - make title descriptive. **Include `{{time}}`** — number charts render a line-chart in background. |
| `table_chart`     | See **Table Chart Settings** below                                                                                                                                                                                                            |
| `pie_chart`       | Requires `series_column` and `value_columns`                                                                                                                                                                                                  |
| `gauge_chart`     | `min` (default 0) and `max` (the goal value, default 1) — set both explicitly. For 0-1 percentage values use `unit: "percent"` with `max: 1`                                                                                                  |
| `heatmap_chart`   | `time_column` (X) + `x_axis_type`, `series_column` (Y) + `series_unit` (Y-label unit), single `value_columns` entry (cell color), `heatmap_color_mode` (`chart-styling` skill)                                                                |
| `scatter_chart`   | `time_column` (X) + `x_axis_type`, `value_columns` (Y) + `y_axis_type`, `series_column` groups points, `point_size_column` sizes them (default `"size"`)                                                                                      |
| `map_chart`       | Load `map-hierarchy-charts` skill                                                                                                                                                                                                             |
| `hierarchy_chart` | Load `map-hierarchy-charts` skill                                                                                                                                                                                                             |

All charts support: `unit` (+ `custom_unit: true` for a literal suffix outside the supported list), `decimal_places: 2`, `legend`. Exception: `table_chart` ignores the chart-level `unit` — use `column_units`.

## Styling & advanced settings

Series colors and order, number chart coloring thresholds, heatmap color categories (`heatmap_color_mode` + `value_categories`), gauge bounds, y-axis tuning (`y_axis_auto_range`, log scale), `show_previous_period`, and the full per-key settings reference with cross-setting gotchas: load the `chart-styling` skill.

## Bar Chart Configuration

**Two types of bar charts — configure each differently:**

1. **Category bar charts** (toplists, rankings) — NO time dimension:
   - `x_axis_type: "category"` (NOT "time" — there is no time column)
   - `time_column: "series"` (point to the category/grouping column, NOT "time")
   - `orientation: "horizontal"` (category labels are usually names)
   - Query has NO `{{time}}`, groups by a tag only

2. **Time-series bar charts** (values over time) — HAS time dimension:
   - `x_axis_type: "time"` (default)
   - `orientation: "vertical"`
   - Query has `{{time}} AS time` and `GROUP BY time, series`

**Common mistakes:**

- Using `x_axis_type: "time"` on a category bar chart — breaks rendering (no time column exists)
- Using `time_column: "time"` on a category bar chart — must be `"series"` (the grouping column)
- Always check: does the query have `{{time}}`? No -> `x_axis_type: "category"` + `time_column: "series"`

## Table Chart Settings

Table charts format **each column independently** — they ignore the chart-level `unit` setting. Configure per-column units and progress bar highlighting via the settings object.

### `column_units`

Set units for individual columns. Each key is the column alias from the query, value is an object with `unit` and `custom_unit`:

```json
{
  "column_units": {
    "CPU usage": { "unit": "percent", "custom_unit": false },
    "Memory usage": { "unit": "percent", "custom_unit": false },
    "Uptime": { "unit": "s", "custom_unit": false },
    "Disk used": { "unit": "B_si", "custom_unit": false }
  }
}
```

Column names must exactly match the SQL alias. The `unit` values are the same as chart-level units (see Units Reference above).

### `percentage_highlight_columns`

Add colored progress bar backgrounds to percentage columns (0-1 range values). Pass an array of column names:

```json
{
  "percentage_highlight_columns": ["CPU usage", "Memory usage"]
}
```

This renders a colored horizontal bar behind each cell value, making it easy to spot high/low values at a glance. Only use for columns that contain 0-1 ratio values displayed as percentages.

## Map & Hierarchy Charts

`map_chart` and `hierarchy_chart` are not time-series and have their own query shapes and settings — load the `map-hierarchy-charts` skill before creating either.

## Chart Title Rules

- Always sentence case ("CPU utilization by service", not "CPU Utilization By Service"). Never units in titles — bare or parenthesised — the `unit` setting renders the suffix; titles say _what_, not _how much_ ("CPU utilization", not "CPU utilization (%)").
- Never abbreviate words ("Average query latency", not "Avg query latency"). Universal acronyms (CPU, HTTP, DNS, ...) are fine; narrower ones (NIC, SDK, SLO, ADLS) are not — if you'd hesitate to use it in onboarding documentation, spell it out. Applies to titles AND tooltips.
- The full naming rules (abbreviation list, domain acronyms, parentheses ban, "X by Y" phrasing, "&" vs "and") live in the `dashboard-builder` skill — follow them for every dashboard, section, and chart title.

## Explanation (tooltip)

Shows as a tooltip next to the chart title. Use rarely — charts must be comprehensible without it. A tooltip earns its place only by teaching something the chart can't show on its own: a non-obvious threshold ("DiskPressure flips at 85% used — once tripped, kubelet evicts pods until usage drops"), an invariant ("Capture backlog > 0 means the pipeline is falling behind"), a debugging hint, or a one-clause definition of an unfamiliar term used in the title (PTU, DLQ, ...). If you can't meet that bar, **leave the field empty** — the chart is better without filler.

**Forbidden content** (these belong on the chart visually, not in prose):

- How the metric is computed — aggregations, ratios, per-tag fan-outs are chart properties, not tooltip topics
- That the value reflects the selected time window (every chart does)
- Paraphrases of the chart title ("Availability — shows the availability of the resource" adds zero; cut it)
- Unit explanations or conversions (the `unit` setting handles that)
- What the legend already shows
- Unexplained abbreviations or internal-sounding jargon ("tail latency events", "poison-message queue", "AppLevelReconnectStorm") — write plain English a customer reading the dashboard for the first time understands
- Anything pointing outside the dashboard — other tools, how the dashboard was sourced, build/review process, "previously this was X". The customer sees only the dashboard; it must be self-contained. This rule applies to titles, section titles, and descriptions too.

**Punctuation:** single-sentence tooltip → no trailing full-stop; 2+ sentences → every sentence ends with one. No parentheses. No code-shaped symbols (`=`, `→`, `&`, ASCII art) — write words ("caps at 100", not "caps = 100"); real numbers ("above 85%") and conventional abbreviations (`vs.`, `e.g.`) are fine. `vs` always with a period — in tooltips and titles.

## Common Mistakes

| Mistake                                                                         | Correct Approach                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `y_axis_max: 100` for 0-1 ratio                                                 | Use `y_axis_max: 1`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `* 100` in the query with `unit: "percent"`                                     | Return the 0-1 ratio: `percent` multiplies by 100 itself, so `* 100` shows 100x too much                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Forgetting `series_column`                                                      | Set when query has grouping column                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Using `%` as unit                                                               | Use `percent`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Using `bytes` as unit                                                           | Use `B_si` or `B_iec`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Defining a custom unit when a built-in exists                                   | Prefer built-in units (`B_si`, `B_iec`, `B_si/s`, `ms`, `s`, `percent`, `shortened`, `e/s`, `rps`, etc.). Built-ins auto-scale (`B_si/s` renders as `kB/s`, `MB/s`, `GB/s` as values grow); custom-string units stay fixed and read worse at scale. Only define a custom unit when nothing in the built-in list fits the metric. **If you ever find yourself typing a built-in name (`shortened`, `percent`, `ms`, etc.) as the custom-unit string, stop — you're meant to set the `unit` field to that built-in value, not the custom-string field.** Both fields exist; using the wrong one breaks auto-scaling. **For network throughput use `B_si/s`** — `B_iec/s` is accepted by the chart formatter but is NOT in the UI's unit dropdown and gets rendered as raw `B_iec/s` instead of `MB/s`. |
| Slashes in series names (`Read / Write`, `vm-1 / read`)                         | Use a space or dash instead (`Read Write`, `vm-1 read`). Slashes read as path separators and clutter the legend; the structure is conveyed by the series naming pattern, not the punctuation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Legend would display only the literal word `"value"` (single un-aliased series) | Set `legend: "hidden"`. A legend that just says `value` adds no information and clutters the chart. Aliased series (`UNION ALL` with `'Read' AS series` / `'Write' AS series`) keep the legend on — the labels carry meaning.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## Dashboard Layout

See `dashboard-layout` skill for layout rules, row templates, coordinate math, and the mandatory planning process.

## Critical checklist

Before creating each chart:

- [ ] Query executed and data verified that its not all null
