# CloudWatch → ClickHouse Translation

## Metric Name Translation

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

## Statistic Mapping

| CloudWatch statistic | ClickHouse merge function                | Notes                                                                           |
| -------------------- | ---------------------------------------- | ------------------------------------------------------------------------------- |
| `Average`            | `avgMerge(value_avg)`                    | Most common                                                                     |
| `Sum`                | `maxMerge(value_max)` on `_sum` metric   | CloudWatch `_sum` stores pre-aggregated counts; using `avgMerge` smooths spikes |
| `Maximum`            | `maxMerge(value_max)`                    |                                                                                 |
| `Minimum`            | `minMerge(value_min)`                    |                                                                                 |
| `SampleCount`        | `maxMerge(value_max)` on `_count` metric |                                                                                 |

## CRITICAL: CloudWatch `Sum` Statistic and Hidden Tag Dimensions

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

## CloudWatch Dimension Mapping

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

## CloudWatch Dimension Filter Translation

| Grafana dimension                       | ClickHouse equivalent                                                                                                             |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `"DBInstanceIdentifier": "$dbinstance"` | Create a `dbinstance` variable + `[[ AND label('db_instance_identifier') = {{dbinstance}} ]]` (see Template Variable Translation) |
| `"DBInstanceIdentifier": "my-db"`       | `AND label('db_instance_identifier') = 'my-db'`                                                                                   |
| `"DBInstanceIdentifier": "*"`           | (no filter — return all)                                                                                                          |
| `matchExact: false`                     | No extra filtering needed                                                                                                         |

## CloudWatch Metric Math

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
