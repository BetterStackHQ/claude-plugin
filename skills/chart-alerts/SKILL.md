---
name: chart-alerts
description: Guide for creating and managing Better Stack chart alerts. Load when asked to set up alerting, create alerts on charts, or configure monitoring thresholds.
---

# Chart Alerts Guide

Chart alerts monitor metrics and logs queries and trigger incidents when conditions are met. They are attached to charts on dashboards or explorations. `chart_alert_help` has the server's current reference.

> **Two-tier thresholds:** a chart alert holds a single `value`. To reproduce a Datadog warning + critical monitor, create **two** alerts on the same chart (one per threshold).

## Alert Types

| Type           | Use Case                                                     | Key Parameters                                             |
| -------------- | ------------------------------------------------------------ | ---------------------------------------------------------- |
| `threshold`    | Known fixed limit exceeded (CPU > 90%, errors > 100)         | `value`, `operator`                                        |
| `relative`     | Value changes by percentage vs. the past (traffic drops 50%) | `value`, `operator`, `query_period`                        |
| `anomaly_rrcf` | Unpredictable patterns, no known threshold (ML-based)        | `shown_interval`, `anomaly_sensitivity`, `anomaly_trigger` |

## Operators

| Operator               | Description                            | Alert Types         |
| ---------------------- | -------------------------------------- | ------------------- |
| `higher_than`          | Value exceeds threshold                | threshold, relative |
| `lower_than`           | Value below threshold                  | threshold, relative |
| `higher_than_or_equal` | Value >= threshold                     | threshold, relative |
| `lower_than_or_equal`  | Value <= threshold                     | threshold, relative |
| `equal`                | Value equals threshold                 | threshold, relative |
| `increases_by`         | Value increases by X%                  | relative only       |
| `decreases_by`         | Value decreases by X%                  | relative only       |
| `changes_by`           | Value changes by X% (either direction) | relative only       |

## Chart Requirements

Only certain chart types support alerts:

| Chart Type     | Requirements                                   |
| -------------- | ---------------------------------------------- |
| `line_chart`   | Must be timeseries, query must have `{{time}}` |
| `bar_chart`    | Must be timeseries, query must have `{{time}}` |
| `number_chart` | Query must have `{{time}}`                     |
| `tail_chart`   | No additional requirements                     |

**Prefer line charts on dashboards** for alerts - they provide the best visibility into metric trends and make it easy to correlate alerts with visual data.

## Key Parameters

### Value (Threshold/Relative)

**Critical**: The `value` is compared with the raw numbers the chart query returns, not with what the chart displays.

| Chart                                          | Example Query                                                   | Alert Value for "85%" |
| ---------------------------------------------- | --------------------------------------------------------------- | --------------------- |
| `unit: "percent"`                              | `sumIf(logs_count, label('level') = 'error') / sum(logs_count)` | `0.85`                |
| Data already 0-100, without the `percent` unit | `avg(cpu_percent)`                                              | `85`                  |

A `percent` chart holds 0-1 ratios and multiplies them by 100 for display, so it shows 0.85 as 85% while its alert `value` stays `0.85`. The exception is a `stack_to_100` bar chart: it sets `percent` itself but its query returns raw values, so its thresholds are raw values too. A relative alert's `value` stays a percentage change either way (50 means 50%).

**Before creating an alert**, check the chart's `unit` and actual values using `chart`.

### Confirmation Period

How long the condition must persist before triggering an alert. Fixed buckets (seconds): `0, 30, 60, 120, 300, 600, 1800, 3600, 7200, 14400`.

### Recovery Period

How long the condition must be resolved before the incident is closed. Same fixed buckets as confirmation period, or `null` = no auto-recovery.

- Set equal to or higher than confirmation_period
- Prevents alert flapping

### Query Period (Relative Alerts)

How far back to look for comparison. Fixed buckets (seconds): `30, 60, 120, 300, 600, 1800, 3600` — **capped at 1 hour**; "vs 1 day/week ago" comparisons are not possible.

### Anomaly Settings

| Parameter             | Range                    | Description                                                                                                               |
| --------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `anomaly_sensitivity` | 1-10                     | Counter to its name: HIGHER = fewer alerts, LOWER = more sensitive (default: 5). Shown as **Significance** in the sidebar |
| `anomaly_trigger`     | `any`, `higher`, `lower` | Which anomalies to alert on                                                                                               |
| `shown_interval`      | seconds                  | Aggregation interval; the training window spans ~10× this (default: 10800 = 3h)                                           |

Don't guess a significance or a threshold: query the chart's data over the past days first (`chart`, then `query`) and say how often the condition would have been met.

## Extra Conditions: Unusual AND Bad

`additional_conditions` ANDs up to 4 more conditions onto the alert's own: it fires only when every
condition breaches in the same time bucket. Each is `{alert_type, operator, value, series_names,
series_names_except}`, `threshold` or `relative` only (anomaly detection can be the alert's own type,
not an extra condition), and each may scope its own series.

**Give every anomaly alert a floor by default.** On its own an anomaly alert fires on anything
unusual, including harmless shifts: after a node replacement, CPU moving to 21% or a p95 of 76 ms is
unusual but fine. A threshold condition such as "and CPU > 80" or "and p95 > 500 ms" keeps it to what
is both unusual and bad. Pick the floor from the chart's real values (`chart`), the way you would a
threshold alert's `value`.

On `edit_chart_alert` the list replaces the alert's conditions as a whole: omit it to keep them,
pass `[]` to remove them. `chart_alert` lists them as **Additional Conditions**.

Check a floor the way you would a threshold: query the chart's data over the past days (`chart`, then `query`) and count how often it crosses the floor. The alert fires at most where the metric is both unusual and past the floor.

## Metadata

`metadata` tags the alert, e.g. `{severity: "critical", owner: ["payments"]}`: each value a string or
a list of strings. The incidents the alert opens carry them. On `edit_chart_alert` it replaces the
alert's metadata as a whole; `{}` removes it.

## Series Names

Monitor specific series or all:

- Empty array `[]` = monitor all series
- `["production", "staging"]` = only these series
- Use when you want to alert on specific hosts/services

## Escalation Targets

| Value                      | Description                                               |
| -------------------------- | --------------------------------------------------------- |
| `current_team`             | Default on-call for the team                              |
| `gid://uptime/Policy/<id>` | A specific escalation policy (from `escalation_policies`) |
| `gid://uptime/Team/<id>`   | A specific team's default on-call                   |

To match a Datadog monitor's notification routing, call `escalation_policies` and pass the closest policy's gid.

## Notification Channels

| Channel | Default | Use Case             |
| ------- | ------- | -------------------- |
| `email` | `true`  | Always on            |
| `push`  | `false` | Mobile notifications |
| `sms`   | `false` | Urgent issues        |
| `call`  | `false` | Critical outages     |

## Process

Find or create the chart (`dashboard` / `add_chart_to_dashboard`) → verify it supports alerts and check its value range (`chart`, then `query` over a few days) → choose the alert type → `create_chart_alert`.

## Examples

### High CPU Alert

```
chart_id: 123
name: "High CPU Usage"
alert_type: "threshold"
operator: "higher_than"
value: 0.90  # On a `percent` chart (0-1 data shown as 90%); 90 only if the query returns 0-100
confirmation_period: 60
```

### Traffic Drop Alert

```
chart_id: 123
name: "Traffic Drop"
alert_type: "relative"
operator: "decreases_by"
value: 50
query_period: 3600
confirmation_period: 300
```

### Anomaly Detection with a Floor

```
chart_id: 123
name: "CPU unusually high"
alert_type: "anomaly_rrcf"
operator: "higher_than"
anomaly_sensitivity: 5
shown_interval: 10800
anomaly_trigger: "higher"
additional_conditions: [{ alert_type: "threshold", operator: "higher_than", value: 0.8 }]  # 80 only if the query returns 0-100
metadata: { severity: "critical" }
```

For anomaly alerts the direction comes from `anomaly_trigger` (`any` = both directions), not from `operator`/`value` (threshold parameters).

## Common Mistakes

| Mistake                                      | Correct Approach                                                 |
| -------------------------------------------- | ---------------------------------------------------------------- |
| Using relative operators with threshold      | `increases_by` only works with `relative` type                   |
| `value: 85` for 85% on a `percent` chart     | Its data is 0-1: use `0.85` (the chart and alert show it as 85%) |
| Guessing at a significance or threshold      | Query the chart's history first, then quote how often it would fire |
| No confirmation period for noisy metrics     | Add 60-300s to prevent flapping                                  |
| Alerting on all series when only some matter | Specify `series_names` array                                     |
| Anomaly alert with no floor                  | Add a threshold in `additional_conditions`                       |

## Managing Alerts

| Action             | Tool                       |
| ------------------ | -------------------------- |
| List all alerts    | `chart_alerts`             |
| Get alert details  | `chart_alert`              |
| Create             | `create_chart_alert`       |
| Edit configuration | `edit_chart_alert`         |
| Pause/unpause      | `toggle_chart_alert_pause` |
| Delete             | `delete_chart_alert`       |
