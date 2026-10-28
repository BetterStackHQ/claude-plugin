---
name: dashboard-builder
description: Guide for building Better Stack dashboards. Load when asked to create a dashboard or add multiple charts in Better Stack.
---

# Dashboard Builder Guide

Dashboards only run metrics queries - never raw logs/traces queries. Log and span volumes are still available there: `sum(logs_count)` / `sum(spans_count)`, grouped by any label the source extracts (`level`, `service`, logs-to-metrics labels) - see `metrics-query`.
Only a log field that is not extracted needs a detour: suggest [Explore](https://telemetry.betterstack.com/team/t0/explore-logs/new) for one-off visualizations, or extracting it with logs-to-metrics - [Docs](https://betterstack.com/docs/logs/dashboards/logs-to-metrics) - to chart it on a dashboard

**Related skills:**

- `dashboard-layout` - Layout rules, row templates, coordinate math, planning process
- `metrics-query` - Query syntax, merge functions, time filters
- `chart-generation` - Chart types, units, axis settings

## Process

1. **Explore available prebuilt templates** - Find dashboard templates and offer building it based on given dashboard template, if available
2. **Plan the structure** - Decide what metrics/areas to cover before creating anything
3. **Plan or validate the layout** — load the `dashboard-layout` skill (it has the row templates and the six layout rules). Then:
   - **Building from scratch**: follow `dashboard-layout`'s planning process to draft the section/row structure.
   - **Building from a pre-existing plan** (e.g. a plan file the user gives you): treat the plan's layout as **untrusted input**. Walk every section's row spec against `dashboard-layout` Rules 3-6 BEFORE you add any chart. The most common plan-side violation: a `w:12` chart paired with a `w:6 + w:6` row above it (orphan-row + full-width, breaks Rules 3 and 4 at once). When you find a violation, propose the fix (e.g. three charts at `w:4+w:4+w:4`) and patch the plan (or flag it to the user) — never silently implement a layout that breaks the rules.
4. **Validate queries** - Execute each query with `query` to verify data exists and values make sense
5. **Build incrementally** - Add charts one by one in row order, verify each works
6. **Verify structure** - After finishing the generation - check if its structured logically, and if there aren't any useless or unrelated charts. Verify even after using prebuilt templates to make sure that source works with that, and it covers all requested features

## Query Validation

**Always execute queries before adding charts — this is mandatory, not optional.**

1. Run query with `query`
2. Check: Does the query SUCCEED (no `Unknown expression`, no `Code: 47`, no `function not found`)?
3. Check: Does data exist? Are values reasonable?
4. Only then add chart with `add_chart_to_dashboard`

**A chart with a broken query cannot be added.** If the query returns "no data found" or an error, fix the query (different aggregation, different metric, different filter) or drop the chart and tell the user about the gap. Do not add a chart whose query you have not successfully executed against real data.

Common issues:

- 100% CPU constantly -> wrong metric or calculation
- No data -> wrong time range or source doesn't have this data, or wrong aggregation state (e.g. `quantilesMerge` on a metric that doesn't populate `value_quantiles`)
- Single flat line -> missing GROUP BY time
- `Unknown expression identifier` -> the aggregation function doesn't exist for this source / metric — pick a different one or revisit the plan

## Default Behavior

If no specific instructions provided, create a **comprehensive health-check dashboard** that covers the main areas available for the source:

1. First, use `source` to understand what data is available
2. Use `metrics_schema` to discover available metrics for the platform
3. Cover key areas: resource usage, performance, errors/logs (whatever applies to the source)
4. Start with overview number charts, then add detailed trend charts

---

## Dashboard template variables

Charts filter through **template variables**, referenced in chart SQL two ways:

- `{{var}}` — **required**: interpolated inline; the variable MUST resolve to a value or the chart errors with `MissingVariableError`.
- `[[ AND col = {{var}} ]]` — **optional**: the whole `[[ ... ]]` block is dropped when `var` is empty.

Always-present special variables — never define or remove them: `{{source}}`, `{{start_time}}`, `{{end_time}}`, `{{time}}`, `{{sampling}}`.

### Defining variables

A bare `{{var}}` only becomes a real (text) variable once a human opens the dashboard in the editor — when **you** build a chart, nothing auto-creates it, so a required `{{var}}` errors until it exists. **Define it with `set_dashboard_variable` before any chart references it.** Text inputs are the least useful — reach for the SQL selects so users pick from real data.

| Type                            | When to use                                          | Fields to send                                                                                                              |
| ------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `select_value`                  | Fixed option list                                    | `default_values`: the options (first = default selection)                                                                   |
| `select_with_sql`               | One value from the data (`allow_multiple_values: true` for several) | `sql_definition`: an expression yielding the option column, e.g. `label('_host')`; may reference other `{{vars}}` / `[[ ]]` |
| `multi_select_with_sql`         | Several values from the data (filter with `match`)   | `sql_definition`: same as above                                                                                             |
| `select_predefined_sql`         | Named presets, each backed by its own SQL filter     | `filters`: `[{label, sql}]`; `selected_label`: the default                                                                  |
| `string` / `number` / `boolean` | A typed literal the user edits                       | `default_values`: `[value]`                                                                                                 |
| `sql_expression`                | Raw SQL spliced in unescaped                         | `default_values`: `[sql]`                                                                                                   |
| `source`                        | Charts querying a different source than `{{source}}` | `source_ids`: `[id, ...]`; custom name required (`source` is reserved) — see below                                          |
| `date` / `datetime`             | A fixed point in time (as-of marker, baseline)       | `default_values`: `['2026-07-23T14:30:00Z']` (ISO 8601)                                                                     |

Prefer the SQL selects inside `[[ ... ]]` clauses or as menu selectors, not as bare required refs — their value resolves at runtime and may be empty. Use `dashboard` to see existing variables and any referenced-but-undefined ones, then remove with `remove_dashboard_variable`.

`select_with_sql` / `multi_select_with_sql` take an **expression**, not a full query — the platform wraps it as `SELECT DISTINCT <expr> AS option FROM {{source}} WHERE dt BETWEEN {{start_time}} AND {{end_time}} LIMIT 50` to populate the dropdown. **Validate it the way the dashboard will:** run that exact wrapped query via `query` and confirm it returns real values before calling `set_dashboard_variable` — if it errors or returns nothing, the dropdown will be empty.

`select_predefined_sql` filter SQL is a full query — filter time with `dt BETWEEN {{start_time}} AND {{end_time}}`, never `{{time}}` (that only buckets inside a chart and breaks here). E.g. `SELECT label('cmd') FROM {{source}} WHERE dt BETWEEN {{start_time}} AND {{end_time}} AND name = 'redis_commands_total' GROUP BY label('cmd') ORDER BY avgMerge(rate_avg) DESC LIMIT 5`.

### Referencing a variable in SQL — match the operator to the type

Each type interpolates to a different shape, so each pairs with a specific operator. Using the wrong operator silently returns no rows.

| Type                                        | Interpolates to                                   | Use in SQL                                |
| ------------------------------------------- | ------------------------------------------------- | ----------------------------------------- |
| `select_with_sql`, `select_value`, `string` | `'value'`                                         | `col = {{var}}`                           |
| `multi_select_with_sql`                     | a quoted regex: `'(a\|b)'` (single value → `'a'`) | `match(col, {{var}})` — **never** `IN`    |
| `select_predefined_sql`                     | a parenthesised list: `('a','b')`                 | `col IN {{var}}` — **no** wrapping parens |
| `number`                                    | `42`                                              | `col = {{var}}` / `col > {{var}}`         |
| `boolean`                                   | `true` / `false`                                  | `col = {{var}}`                           |
| `sql_expression`                            | raw text, spliced in unescaped                    | inline as written                         |
| `date` / `datetime`                         | `toDateTime64('…', 6)` (date → midnight)          | comparisons: `dt >= {{var}}`              |
| `source`                                    | the variable's source table                       | FROM only: `FROM {{var}}`                 |

To query another source on the same dashboard, define a `source`-type variable and reference it in the chart's FROM: `set_dashboard_variable(dashboard_id, name: "prometheus_source", variable_type: "source", source_ids: [<id>])`, then `... FROM {{prometheus_source}}`. A chart takes its source from whichever source variable its FROM names, so define the variable **before** adding the chart — a chart whose FROM references an undefined source variable is rejected with guidance to create it first. `{{source}}` is the default source; use a named source variable only to target a different one.

**The most common mistake:** `multi_select_with_sql` produces a regex, not a list. `WHERE label('cmd') IN ({{cmd}})` becomes `IN ('(get|hgetall)')` and matches nothing — write `WHERE match(label('cmd'), {{cmd}})`. And `select_predefined_sql` is already parenthesised, so write `col IN {{var}}`, not `IN ({{var}})` (which double-wraps to `IN (('a','b'))`). `match` is also an **unanchored** regex search — selecting `frontend` silently pulls in `frontend-proxy` — so anchor it: `match(label('_container'), concat('^(', {{var}}, ')$'))`.

### Example — add a host filter to a CPU chart

1. Validate the options query: `query("SELECT DISTINCT label('_host') AS option FROM {{source}} WHERE dt BETWEEN {{start_time}} AND {{end_time}} LIMIT 50")` → returns host names.
2. `set_dashboard_variable(dashboard_id, name: "host", variable_type: "multi_select_with_sql", sql_definition: "label('_host')")`
3. In the chart query: `... WHERE dt BETWEEN {{start_time}} AND {{end_time}} [[ AND match(label('_host'), {{host}}) ]]`

---

## Naming Convention

**Always use sentence case** for all titles — dashboard names, section names, and chart names. Never use Title Case. Only capitalize the first word and proper nouns/acronyms (AWS, RDS, CPU, I/O, MySQL).

- Good: `"CPU utilization by instance"`, `"Query performance"`, `"Disk I/O"`
- Bad: `"CPU Utilization By Instance"`, `"Query Performance"`

**Never abbreviate words in titles. This is the most-violated rule — apply it even when copying from a plan, a metric name, or an upstream dashboard that uses the abbreviated form.** Dashboards are for humans, not terminals.

- Good: `"Average query latency"`, `"Maximum connections"`, `"Configuration reloads"`, `"Average response time"`
- Bad: `"Avg query latency"`, `"Max connections"`, `"Config reloads"`, `"Avg response time"`

If the plan markdown or the metric name contains `Avg` / `Max` / `Min` / `Util` / `Config` / `Mem` / `Conn` / `Resp` / `Req`, **expand at chart-create time** — do not pass through.

Common abbreviations to avoid: avg->average, max->maximum, min->minimum, config->configuration, conn->connections, mem->memory, util->utilization, info->information, stats->statistics, perf->performance, req->requests, resp->response, err->errors, msg->messages, num->number, alloc->allocations, exec->execution, init->initialization, auth->authentication, calc->calculation, temp->temperature, env->environment, proc->process, addr->address, params->parameters, docs->documents, desc->description, dup->duplicate, recv->received, xmit->transmitted

**Exception:** Well-known acronyms that are more recognizable than the full form are fine: CPU, GPU, RAM, IOPS, I/O, HTTP, DNS, TCP, UDP, TLS, SSL, JVM, GC, OS, PID, TTL, URL, API, SQL, SSD, HDD, NFS, EBS, RDS, EC2, S3.

**These abbreviation rules apply to tooltips too.** Borderline abbreviations a first-time reader might not recognize (NIC, SDK, SLO, ADLS, ...) get expanded inline: `"network interfaces"` not `"NICs"`, `"client library"` not `"SDK"`. Test: if you'd hesitate to use the abbreviation in onboarding documentation, expand it.

**Domain-specific acronyms** (e.g. `RU` request units, `PTU` provisioned throughput units, `DLQ` dead-letter queue, `DTU` database transaction units, `XTP` extreme transaction processing, `SNAT` source NAT, `RBAC`) sit between the two: a customer who doesn't already work with that Azure service will not recognize them. Two acceptable resolutions, pick per-chart:

1. **Spell it out in the title** — `"RU consumption"` → `"Request units consumption"`. Use when the spelled-out form fits the layout and reads naturally.
2. **Keep the acronym AND define it in the tooltip** — title stays `"RU consumption"`; tooltip leads with one clause defining the term (`"Request units (RU) — Cosmos's normalized cost unit. 1 RU ≈ a 1 KB document read."`). See the `chart-generation` skill's Explanation section for the rule.

Never leave a domain-specific acronym in a title without one of those two — a cold customer reading the dashboard should not have to Google a term.

**Never use parentheses** in dashboard, section, or chart titles — for any reason (qualifiers, series counts, etc.). The chart's legend and series labels carry the meaning.

- Bad: `"Response time (avg + max)"`, `"RU consumption (number_chart)"`, `"Per-partition RU allocation (line)"`
- Good: `"Response time"`, `"RU consumption"`, `"Per-partition RU allocation"`

**Never include units in titles** — parenthesised OR bare. The chart's `unit` setting renders the suffix at display time.

- Bad: `"Memory available %"`, `"Latency ms"`, `"Throughput rps"`, `"CPU utilization (%)"`, `"Network throughput (bytes/s)"`
- Good: `"Memory available"`, `"Latency"`, `"Throughput"`, `"CPU utilization"`, `"Network throughput"`

**Prefer "and" over "&"** in chart and dashboard titles. Reserve `&` for short 2-word section titles only.

- Section titles (2-word join): `"CPU & memory"`, `"Errors & throttling"`, `"Disk & I/O"` — `&` is fine
- Chart titles: `"Provisioned vs consumed RU"`, `"Capacity and compute units"`, `"Avg and max response time"` — use `and`
- Dashboard titles: `"Azure Service Bus and Event Hubs"` — use `and`

**Never start titles with "Per X" — use "X by Y" pattern.** "Per-partition RU allocation" → "Request units allocation by partition". "Per-host throughput" → "Throughput by host". "Per-app latency" → "Latency by app". The "Per X" framing reads as developer shorthand; "X by Y" reads as natural English.

**Avoid dashed compound words in titles and tooltips.** Compounds like "in-memory", "high-water", "tail-latency", "per-partition", "AppLevelReconnectStorm" sound techy and read like internal jargon. Spell them out plainly or drop the term and describe functionally.

- Bad: `"In-memory OLTP storage utilization"`, `"high-water reserved file size"`, `"per-partition RU"`
- Good: `"OLTP storage utilization"`, `"the space reserved on disk"`, `"RU by partition"`

## Series and Labels

Charts showing "null" labels or "value" legends are broken — `value_columns` and `series_column` settings must agree with the SQL output. The full reference for both settings (including `series_column` auto-inference) is in the `chart-generation` skill; the notes below are the dashboard-builder-specific operational rules.

### When the query has a `GROUP BY` on a tag

Alias the grouping column as `series` in the SQL so the chart can pick it up:

```sql
SELECT {{time}} AS time, avgMerge(value_avg) AS "CPU utilization",
       label('db_instance_identifier') AS series
FROM {{source}} WHERE ... GROUP BY time, series
```

Then set `series_column: "series"` and `legend: "shown_below"`. Without `series_column`, bar charts show "null" labels and line charts show "value" in the legend.

### Error rate ratio charts with avgMergeIf

When computing error rate ratios, wrap the numerator with `coalesce(..., 0)` so the chart shows 0% instead of empty/null when there are no errors:

```sql
coalesce(avgMergeIf(rate_avg, condition), 0) / nullIf(avgMerge(rate_avg), 0)
```

These are single-aggregate ratios with no grouping column — set `series_column: ""` (see `chart-generation`).

### Composite series labels

When a chart combines multiple metrics (in/out, read/write) AND groups by an instance tag, concat both into the series label so each line is unambiguous:

```sql
-- Good: "broker-1:7071 in", "broker-1:7071 out", "broker-2:7071 in", ...
concat(label('instance'), ' ', multiIf(name = 'metric_in', 'in', 'out')) AS series

-- Bad: just "in", "out" — which instance?
multiIf(name = 'metric_in', 'in', 'out') AS series
```

Use this pattern for any "per-instance + per-direction" chart. Think about multi-instance deployments even if the current data has only one instance — dashboards are templates.

### Legend visibility

**Rule: Any chart with `series_column` set MUST use `legend: "shown_below"`.** If the chart has multiple series (GROUP BY on a tag), users need the legend to identify them.

Hide the legend ONLY when ALL of these are true:

1. The chart has NO `series_column` (single-series only)
2. The query produces exactly one series
3. The value_columns alias matches or restates the chart title

**Exception — category bar charts:** A category bar chart (toplist) with `series_column` should use `legend: "hidden"` because the category labels are already shown on the axis.

## Bar Chart Configuration

See the `chart-generation` skill's Bar Chart Configuration — category bar charts (no `{{time}}`) need `x_axis_type: "category"` + `time_column: "series"`.

## Section Organization

Charts MUST be placed in semantically correct sections. Common mistakes to avoid:

- CPU metrics -> "System" or "CPU & memory", NEVER in "Disk" or "Storage"
- Memory metrics -> "Memory" or "CPU & memory", NEVER in "Disk" or "I/O"
- Swap -> "Memory", NOT "Storage & I/O"
- Tasks/processes -> "System" or "Process", NOT "Disk"

When translating source dashboard groups to sections, verify each chart belongs. If the source has a chart in the wrong group, fix it — don't reproduce the mistake.

## Pie/Donut Charts

**Never use pie charts for single-category data.** A donut showing one slice at 100% is useless:

- If only 1 instance/cluster exists -> use a number chart or bar chart instead
- Pie charts need 2+ meaningful categories with different proportions
- If data might be single-category, default to bar chart — it degrades gracefully

## Stacking Rules

**Default to `stack` for line charts.** The filled-area look reads better than thin overlapping lines and adds visual weight. The exceptions are narrow.

- **Single-series line chart → `stack`.** Produces a filled area under the line. Looks polished. **This includes anomaly counters** (Nodes not ready, Pods pending, Throttle events, Deadlocks, Failed jobs): stacking makes a non-zero value pop as a bold filled spike — exactly when you want the eye drawn — and an all-zero series correctly reads as nothing to show, i.e. healthy. A blank chart at 0 is fine; the filled spike on a non-zero value is the whole point.
  - **Exception: single-series ratio / percentage lines → `dont_stack` + `connected`** (cache hit rate, a lone error-rate %, a single utilization %). A filled block under a steady ~90% ratio reads worse than a clean line, and `connected` bridges polling gaps rather than the sawtooth a stacked `previous` series gives.
- **Multi-series additive (parts of a whole) → `stack`.** Read+write IOPS, sent+received bytes, by-status-class (2xx/3xx/4xx/5xx), by-phase (Running/Pending/Failed), by-condition (Ready/MemoryPressure/DiskPressure), per-core CPU summing to total CPU. The stacked total is meaningful.
- **Multi-series independent → `dont_stack`.** Latency per service, error rate per endpoint, CPU% per VM, memory% per app — each line is one entity's measurement, not a piece of a whole. Stacking these would invent a misleading "total latency" or "total CPU%" that has no meaning.
- **Heuristic**: if you can name a sensible "Total" the stacked area would represent, stack. If "Total CPU% across 12 VMs = 943%" is nonsense, don't stack.

## treat_missing_values Rules

Full rules in the `chart-generation` skill's Handling Missing Values table. In short: non-stacked -> `connected` (default); stacked -> ALWAYS `previous` (`connected` breaks stacking into a sawtooth); `zero` only when a missing bucket truly means zero events (sparse errors, throttles) — never as the default for cloud-polled metrics (Azure / GCP / AWS / CloudWatch poll on a schedule; missing poll ≠ zero events).

## Units and Readability

- **Never leave units unset.** Every chart must have an explicit unit.
- **Use human-readable units.** Values should never display as `0.00` anything. If a metric is sub-second, convert to milliseconds in the query (`* 1000`) and use `unit: "ms"`.
- **Latency:** Check the source metric's native unit FIRST. Some are seconds (-> `* 1000`, `unit: "ms"`), others are already milliseconds (-> NO multiplication, just `unit: "ms"`). Always verify with `query` before applying `* 1000`.
- **GCP distribution metrics (latencies, durations, rtt):** `avgMerge(value_avg)` returns NULL on these — see the `metrics-query` skill's Distribution section for the `bucket_*` pattern and unit conversion.
- **IOPS:** Use `unit: "e/s"` (events per second), NOT `unit: "shortened"`.
- **Counts** (connections, deadlocks, items): Use `decimal_places: 0` — these are integers. Use `unit: "shortened"` for auto-scaling.
- **Decimal places:** Use `decimal_places: 1` for most values. Use `0` for counts. Never use `4`.
- **Consistent naming:** Use the same name for the same metric across all charts AND all dashboards.
- **Prefer predefined units over custom units.** Never use `custom_unit` when a predefined unit exists (e.g., use `B_si` not `custom_unit: "bytes"`, use `e/s` not `custom_unit: "/s"`). Custom units lack auto-scaling. See `chart-generation` skill for the full unit reference.

## Common Pitfalls

### Macros in nested queries

`{{time}}`, `label()`, and `{{source}}` are macros that expand to raw column references (`dt`, `tags`, table name). They only work where those columns exist — i.e., directly against `{{source}}`. Once you wrap a subquery, the outer query can ONLY reference columns the subquery SELECTed.

**Rule of thumb:** After a subquery boundary `)`, only use column aliases from the inner SELECT. Never use macros that reference source-table columns.

```sql
-- WRONG: outer query uses {{time}} but dt doesn't exist there
SELECT {{time}} AS time, SUM(val) AS total
FROM (SELECT {{time}} AS time, label('x') AS x, maxMerge(value_max) AS val
      FROM {{source}} WHERE ... GROUP BY time, x)
GROUP BY time

-- CORRECT: outer query references 'time' column from subquery
SELECT time, SUM(val) AS total
FROM (SELECT {{time}} AS time, label('x') AS x, maxMerge(value_max) AS val
      FROM {{source}} WHERE ... GROUP BY time, x)
GROUP BY time
```

Same applies to CTEs — `WITH cte AS (SELECT ... FROM {{source}})` produces named columns. The final `SELECT` must reference those names, not re-use macros.

### Percentage metrics already in 0-100 range

`unit: "percent"` in Better Stack expects 0-1 input and multiplies by 100 for display. Many AWS metrics report 0-100 already. **ALWAYS divide by 100 in the query when using `unit: "percent"`:**

```sql
-- WRONG: shows 4000% instead of 40%
avgMerge(value_avg) AS "CPU %"  -- with unit: "percent"
-- CORRECT: shows 40%
avgMerge(value_avg) / 100 AS "CPU %"  -- with unit: "percent"
```

If you compute a ratio (a/b), do NOT multiply by 100 when using `unit: "percent"`. The unit does it for you.

---

## Checklist

Before adding each chart:

- [ ] Query executed and data verified (not all null)
- [ ] Values make sense (not all zeros, not all 100%)
- [ ] Correct chart type for the data
- [ ] `value_columns` matches SQL alias exactly
- [ ] If GROUP BY on a tag -> `series_column` is set AND `legend: "shown_below"`
- [ ] If single-series -> query alias is descriptive (not "value")
- [ ] If bar chart with no `{{time}}` -> `x_axis_type: "category"`, `time_column: "series"`
- [ ] If `unit: "percent"` -> values are 0-1 range
- [ ] If count metric -> `unit: "shortened"`, `decimal_places: 0`
- [ ] Unit is set (never leave unset) and uses a predefined unit (not custom_unit)
- [ ] `height: 6` passed explicitly
- [ ] If number chart -> query includes `{{time}}` bucketing + `GROUP BY time` for sparkline backdrop (exception: current-value KPIs like status/version use `argMax` without time bucketing)
- [ ] If table chart -> `column_units` set for each column, `percentage_highlight_columns` for 0-1 ratio columns

After successful generation of the dashboard, provide a concise overview and the dashboard's link from the tool result.
