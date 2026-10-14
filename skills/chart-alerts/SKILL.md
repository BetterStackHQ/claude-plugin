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

**Critical**: The `value` must match the data format returned by the chart query.

| Chart Data Format  | Example Query                                                   | Alert Value for "85%" |
| ------------------ | --------------------------------------------------------------- | --------------------- |
| Percentage (0-100) | `avg(cpu_percent)`                                              | `85`                  |
| Ratio (0-1)        | `sumIf(logs_count, label('level') = 'error') / sum(logs_count)` | `0.85`                |

**Before creating an alert**, check the chart's actual values using `chart` or look at the dashboard to understand the data range.

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
value: 0.90  # Use 90 if chart shows 0-100, use 0.90 if chart shows 0-1
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

### Anomaly Detection

```
chart_id: 123
name: "Unusual Activity"
alert_type: "anomaly_rrcf"
operator: "higher_than"
anomaly_sensitivity: 5
shown_interval: 10800
anomaly_trigger: "any"
```

For anomaly alerts the direction comes from `anomaly_trigger` (`any` = both directions), not from `operator`/`value` (threshold parameters).

## Common Mistakes

| Mistake                                      | Correct Approach                               |
| -------------------------------------------- | ---------------------------------------------- |
| Using relative operators with threshold      | `increases_by` only works with `relative` type |
| Guessing at a significance or threshold      | Query the chart's history first, then quote how often it would fire |
| No confirmation period for noisy metrics     | Add 60-300s to prevent flapping                |
| Alerting on all series when only some matter | Specify `series_names` array                   |

## Managing Alerts

| Action             | Tool                       |
| ------------------ | -------------------------- |
| List all alerts    | `chart_alerts`             |
| Get alert details  | `chart_alert`              |
| Create             | `create_chart_alert`       |
| Edit configuration | `edit_chart_alert`         |
| Pause/unpause      | `toggle_chart_alert_pause` |
| Delete             | `delete_chart_alert`       |
