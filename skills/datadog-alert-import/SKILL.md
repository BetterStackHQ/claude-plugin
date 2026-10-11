---
name: datadog-alert-import
description: Import Datadog monitors into Better Stack chart alerts. Maps each monitor type (metric threshold/change/anomaly/outlier/forecast, log, APM, process/integration/network, composite, Watchdog) to chart alerts, splitting warning+critical into two alerts. Load when asked to import, migrate, or recreate Datadog alerts/monitors in Better Stack.
---

# Datadog Alert Import

Recreate Datadog **monitors** as Better Stack **chart alerts**. A chart alert has no query of its own — it sits on a chart and watches that chart's value. So for each monitor: **translate its query into a chart, then attach the alert(s)** with `create_chart_alert`.

**Load first:** `datadog-import` (Datadog→ClickHouse query translation), the query skill for the data type (`metrics-query` / `logs-query` / `spans-query`), `chart-generation`, `chart-alerts`.

**Scope:** metric, log, APM, process/integration/network, composite, and Watchdog monitors. Out of scope: synthetics/uptime (see `uptime-monitors`) and _creating_ escalation policies (pick existing only).

## Read the monitor

Read monitors live through a Datadog MCP server if one is connected (discover its list/get tools at runtime), or from exported JSON. Capture: `type`, `query`, `options.thresholds.{critical,warning}`, `message` (`@`-handles), `priority`, `tags`, `name`.

## Parse the query

Metric/APM shape — `<reducer>(<window>):<metric query> <comparator> <threshold>`, e.g. `avg(last_5m):avg:system.cpu.user{env:prod} by {host} > 90`:

- **metric query** → the chart query (`datadog-import` rules: aggregation prefix → merge fn, `{tag:v}` → `label()`, `by {tag}` → series).
- **comparator** → `operator` (table below).
- **threshold** → alert `value`, in the chart's data format — see `chart-alerts`; check real values with `chart` first.
- **reducer(window)** → periods (below).

Log shape — `logs("<search>").rollup("count")… > N` → a `count()` chart (`logs-query`) + `threshold` on `N`.

## Monitor → alert

Build the chart, then `create_chart_alert` with the mapped `alert_type` / `operator` / `value`.

| Datadog monitor                         | `alert_type`                                                  | Notes                                                                                                                                                         |
| --------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Metric — threshold (`… > 90`)           | `threshold`                                                   | operator from comparator                                                                                                                                      |
| Metric — change (`change(...)`, %)      | `relative`                                                    | `increases_by`/`decreases_by`/`changes_by`; `value` = **percent**; set `query_period`. Percentage-only — absolute-change monitors can't be reproduced (flag). |
| Metric — anomaly (`anomalies(...)`)     | `anomaly_rrcf`                                                | `anomaly_trigger`: above→`higher`, below→`lower`, both→`any`; `anomaly_sensitivity` 1–10. RRCF ≠ Datadog's seasonal model — closest analog.                   |
| Metric — outlier (`outliers(...)`)      | `anomaly_rrcf` (best-effort)                                  | Datadog compares peers at one instant; BS anomaly is per-series over time. Flag the gap.                                                                      |
| Metric — forecast (`forecast(...)`)     | `threshold`/`anomaly_rrcf` on the current value (best-effort) | No predictive alerting in BS. Flag the gap.                                                                                                                   |
| Log — count over a window               | `threshold`                                                   | `value` = the count.                                                                                                                                          |
| APM — latency / error rate / throughput | `threshold` (or `relative`)                                   | `spans-query`: latency → percentile, throughput → count/rate, error rate → one `errors/total` expression (an alert has one condition on one query).           |
| Process / integration / network         | `threshold` on the backing metric                             | No numeric metric ("is it reporting?") → prefer an Uptime monitor (`uptime-monitors`).                                                                        |
| Composite (`a && b`, `a \|\| b`)        | one alert per sub-monitor                                     | No composite in BS. Separate alerts behave as **OR** (any fires → incident); **AND can't be enforced** — flag it, encode the intent in the names.             |
| Watchdog                                | `anomaly_rrcf` on the key metrics                             | Account-wide, zero-config breadth can't be replicated — create explicit anomaly alerts on the metrics that matter.                                            |

### Comparator → operator

Comparators map 1:1 to the operators in `chart-alerts` (`>` → `higher_than`, `==` → `equal`, ...). Datadog `!=` has no equivalent (flag).

## Periods

Datadog bakes the window into the query; BS splits it across the chart's aggregation and the alert's periods:

- "on average over last X" → chart aggregates to avg, `confirmation_period: 0`.
- "at all times over last X" → `confirmation_period: X` (breach must persist).
- "in total over last X" → chart aggregates to sum (e.g. log counts).

Periods take **fixed buckets** (valid values in `chart-alerts`) — round to the nearest and tell the user. `query_period` is **capped at 1h**, so "vs 1 day/week ago" isn't settable (flag).

`recovery_period` is a timer (condition cleared for N s → auto-resolve; `null` = manual). It is **not** Datadog's recovery _threshold_ (a value), which has no equivalent (flag).

## Warning + critical → two alerts

A chart alert holds one `value`; a monitor usually has both thresholds. Create **two** alerts on the same chart — same operator, different `value` and name:

- `"<name> (critical)"` — `thresholds.critical`, urgent policy + `call`/`push`.
- `"<name> (warning)"` — `thresholds.warning`, softer target (`current_team`, `email`).

## Escalation & notifications

From the monitor's `message` `@`-handles + `priority`: `escalation_policies`, pass the closest **existing** policy as `escalation_target` (`gid://uptime/Policy/<id>`), else `current_team`. Map urgency to channels — P1/P2 / paging → `call`/`push` (+`sms`); routine → `email`.

## Not settable via `create_chart_alert` — flag per monitor

No equivalent anywhere — note them: **outlier** (peer comparison), **forecast** (prediction), **composite AND**, **absolute-change**, **recovery threshold (value)**, **`!=`**, **evaluation/new-group delay**.

Supported by BS chart alerts but not by `create_chart_alert` — **set in the UI after import**: `on_missing_data` (Datadog's no-data behavior; `treat_as_zero`/`dont_fire`/`treat_as_previous`/`start_incident`) and `critical_alert`. `incident_per_series` (Datadog grouped/"multi alert" — one incident per host) is set afterwards with `edit_chart_alert`; or fan out one alert per group via `series_names`. Renotify cadence and per-`@`-handle routing live in the escalation policy, not the alert.

## Workflow (per monitor)

1. Fetch the monitor (Datadog MCP or JSON); parse the query → metric query, window, comparator, threshold(s).
2. Translate the query (`datadog-import`); build the chart (`line_chart`/`number_chart`, query must contain `{{time}}`) and **validate it returns data** before attaching.
3. `create_chart_alert` with the mapped `alert_type` / `operator` / `value` / periods. Two thresholds → two alerts.
4. Set `escalation_target` + channels (`escalation_policies`).
5. Emit a per-monitor note of anything flagged above.
