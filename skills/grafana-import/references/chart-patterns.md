# Line Chart Patterns

## Counter Rate with Label

**PromQL:** `irate(node_network_receive_bytes_total{device="eth0"}[5m])`

```sql
SELECT {{time}} AS time, label('device') AS series, avgMerge(rate_avg) AS "Bytes received"
FROM {{source}}
WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}}
  AND name = 'node_network_receive_bytes_total'
GROUP BY time, series ORDER BY time
```

## Sum by Label

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

## Multi-Metric Arithmetic

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

## Multiple Metrics as Series

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

## Composite Series — Tag + Metric Direction

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

## Bytes to Bits (Network Traffic)

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

## CloudWatch Line Chart — Average

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

## CloudWatch Line Chart — Sum (Request Count)

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

## Simple irate (Gauge)

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

## avg(irate()) Across Labels — CPU Busy %

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

## Instant Gauge Value (non-rate)

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

## Uptime (Monotonic Timestamps)

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

## Static Number (RAM Total)

**PromQL:** `node_memory_MemTotal_bytes`

```sql
SELECT 'RAM Total' AS series, avgMerge(value_avg) AS "RAM total"
FROM {{source}}
WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}} AND name = 'node_memory_MemTotal_bytes'
```

No time grouping needed for static values.

## CloudWatch Number Chart

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

## Grafana Stat reduceOptions Mapping

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
