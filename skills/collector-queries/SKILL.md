---
name: collector-queries
description: Proven metrics queries for Better Stack Collector sources (the source tool's Platform "Collector") - per-host node_* metrics, per-container and per-service container_resources_*, requests and errors by destination, TCP health, and the container-level saturation checks that host averages hide. Load after metrics-query when the source platform is Collector, for health checks, resource questions and service dashboards.
---

# Collector sources: proven queries

Taken from the Hosts and Services dashboard templates; every metric and label below was verified on a live Collector source. Queries use `{{source}}`, `{{time}}`, `{{start_time}}`, `{{end_time}}` exactly as `metrics-query` describes.

## What the collector emits

- Every infrastructure metric carries `_host`, `_service`, `_container`; `_container` is the readable container name (`namespace/pod/container` on Kubernetes). Prefer these `container_*` and `node_*` families over the OTel `container.*` (dotted, docker-stats) family, whose labels are resource attributes.
- Per host, node exporter: `node_cpu_seconds_total` (`mode`, `cpu`), `node_memory_*_bytes`, `node_load1/5/15`, `node_disk_*` (`device`), `node_filesystem_*` (`mountpoint`, `fstype`), `node_network_*` (`device`), `node_pressure_{cpu,io,memory}_{waiting,stalled}_seconds_total`, `node_vmstat_oom_kill`, `node_procs_{running,blocked}`, `node_netstat_Tcp*`.
- Per container: `container_resources_cpu_usage_seconds_total`, `_cpu_limit_cores`, `_cpu_throttled_seconds_total`, `_cpu_delay_seconds_total`, `_memory_rss_bytes`, `_memory_cache_bytes`, `_memory_limit_bytes`, `_{cpu,memory,io}_pressure_waiting_seconds_total` (`kind` is `some` or `full`; filter one), `_disk_{used,size}_bytes` (`mount_point`, `device`), `container_oom_kills_total`, `container_restarts_total`.
- Per container and peer (`actual_destination` is ip:port): `container_net_tcp_active_connections`, `_successful_connects_total`, `_failed_connects_total` (`destination`), `_retransmits_total`, `_bytes_{sent,received}_total`; requests `container_{http,postgres,redis,kafka,zookeeper,...}_{requests,queries}_total` (`status`) with `_duration_seconds_total` histograms; `container_dns_requests_total` (`domain`, `status`).
- Maps: `container_net_tcp_listen_info` (`listen_addr` to `_container` and `_service`), `ip_to_fqdn` (`ip` to `fqdn`). Join them to name the peers in dependency and RED questions (see Requests and errors by destination).
- Span-derived metric `duration` with `service`, `kind`, `root`, `error`, `http_status`, `span_name`: the metrics-plane error rate and latency of the instrumented applications.

## Host

CPU busy per host (rates by mode, then one minus the idle share):

```sql
WITH per_mode AS (
  SELECT {{time}} AS time, label('_host') AS host, label('mode') AS mode, avgMerge(rate_avg) AS v
  FROM {{source}}
  WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}} AND name = 'node_cpu_seconds_total'
  GROUP BY time, host, mode
)
SELECT time, host AS series, 1 - sumIf(v, mode = 'idle') / nullIf(sum(v), 0) AS "CPU busy"
FROM per_mode GROUP BY time, host ORDER BY time
```

Add `sumIf(v, mode = 'iowait') / sum(v)` and `mode = 'system'` for IO wait and the kernel share.

Memory (`unit: B_iec`, or the ratio with `percent`):

```sql
SELECT {{time}} AS time,
  avgMergeIf(value_avg, name = 'node_memory_MemTotal_bytes') - avgMergeIf(value_avg, name = 'node_memory_MemAvailable_bytes') AS "Used",
  avgMergeIf(value_avg, name = 'node_memory_MemAvailable_bytes') AS "Available"
FROM {{source}}
WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}}
  AND name IN ('node_memory_MemTotal_bytes', 'node_memory_MemAvailable_bytes')
GROUP BY time ORDER BY time
```

Swap: `node_memory_SwapTotal_bytes`, `node_memory_SwapFree_bytes`; a zero total means nothing stands between memory pressure and the OOM killer.

Load per core: `avgMergeIf(value_avg, name = 'node_load1') / uniqExactIf(label('cpu'), name = 'node_cpu_seconds_total')` with both names in WHERE.

Pressure (PSI), the signal that separates "at the limit" from "hurt by it": `avgMergeIf(rate_avg, name = ...)` of `node_pressure_memory_stalled_seconds_total`, `node_pressure_io_stalled_seconds_total`, `node_pressure_cpu_waiting_seconds_total` as named columns; 0.5 means half of wall-clock time stalled.

Disk: utilization is `avgMerge(rate_avg)` of `node_disk_io_time_seconds_total` per `label('device')` (0-1); wait time per operation is the rate of `node_disk_{read,write}_time_seconds_total` over the rate of `node_disk_{reads,writes}_completed_total`; space is `node_filesystem_avail_bytes` per `label('mountpoint')` with `label('fstype') != 'rootfs'`.

Network per host: `avgMerge(rate_avg)` of `node_network_receive_bytes_total` and `node_network_transmit_bytes_total` per `label('device')` in the inner level, summed per host outside (`unit: B_si/s`).

OOM kills and restarts in the window (counter increase; a reset undercounts): `maxMerge(value_max) - minMerge(value_min)` of `node_vmstat_oom_kill` per host, of `container_oom_kills_total` and `container_restarts_total` per `label('_container')`.

Processes: `avgMerge(value_avg)` of `node_procs_blocked` against `node_procs_running`; blocked processes wait on IO.

## Containers and services

Host averages hide per-container saturation: a host at 35% CPU can have containers pinned at their cgroup limit. Always run this pass on a Collector source.

CPU per container, in cores and as a share of its limit:

```sql
SELECT {{time}} AS time, label('_container') AS series,
  avgMergeIf(rate_avg, name = 'container_resources_cpu_usage_seconds_total') AS "Cores",
  avgMergeIf(rate_avg, name = 'container_resources_cpu_usage_seconds_total')
    / nullIf(avgMergeIf(value_avg, name = 'container_resources_cpu_limit_cores'), 0) AS "Of limit"
FROM {{source}}
WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}}
  AND name IN ('container_resources_cpu_usage_seconds_total', 'container_resources_cpu_limit_cores')
GROUP BY time, series ORDER BY time
```

Same shape for memory: `container_resources_memory_rss_bytes` (plus `_memory_cache_bytes` for total used) over `container_resources_memory_limit_bytes`. Throttling and delay: `avgMerge(rate_avg)` of `container_resources_cpu_throttled_seconds_total` and `_cpu_delay_seconds_total`, seconds per second; sustained throttling means the container is starved. Pressure: `container_resources_memory_pressure_waiting_seconds_total` per container with `label('kind') = 'full'` (`some` counts any task stalled, `full` counts everyone stalled; a bare merge blends the two). `"Of limit"` is NULL for containers without a limit.

Ranking without a time column: `GROUP BY label('_container') ORDER BY avgMerge(value_avg) DESC LIMIT 15` on the RSS metric, the same on `rate_avg` for CPU.

Per service: sum the per-container values by `label('_service')` in the outer level of a two-level query (the Top N shape in `metrics-query`); CPU share of the host is the summed cores over `uniqExact(label('cpu'))` from `node_cpu_seconds_total`.

Never add container RSS across containers and compare it with host memory: cgroup accounting attributes shared page cache to every container, so the sum overshoots the host.

## Requests and errors by destination

Request metrics are recorded on the client side, keyed by `actual_destination`. Aggregate per series first, then sum; a bare `avgMerge` across series is the mean per series, not the total:

```sql
WITH per_series AS (
  SELECT {{time}} AS time, label('actual_destination') AS dest, label('status') AS status, series_id,
         avgMerge(rate_avg) AS rps
  FROM {{source}}
  WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}}
    AND (name LIKE 'container_%_requests_total' OR name LIKE 'container_%_queries_total')
    AND label('actual_destination') != ''
  GROUP BY time, dest, status, series_id
)
SELECT time, dest AS series, sum(rps) AS "Requests/s",
  coalesce(sumIf(rps, status IN ('4xx', '5xx', 'failed') OR (startsWith(status, 'grpc:') AND status != 'grpc:OK')), 0)
    / nullIf(sum(rps), 0) AS "Error rate"
FROM per_series GROUP BY time, dest ORDER BY time
```

To name a destination, join `dest` to `label('listen_addr')` of `container_net_tcp_listen_info` (gives `_container` and `_service`) or its ip part to `ip_to_fqdn`; several containers can share a listen address, so split the rate across them. Latency: `histogramQuantile(0.95)` on one `container_<protocol>_requests_duration_seconds_total` at a time.

## TCP

Per container and destination, `avgMerge(rate_avg)`: `container_net_tcp_successful_connects_total`; `container_net_tcp_failed_connects_total` (rising means the peer is unreachable or refusing); `container_net_tcp_retransmits_total` (rising means packet loss or congestion). `avgMerge(value_avg)` of `container_net_tcp_active_connections`. Group by `label('_container')` and `label('actual_destination')`. Host-wide: rates of `node_netstat_TcpExt_ListenOverflows`, `node_netstat_TcpExt_ListenDrops`, `node_netstat_Tcp_RetransSegs`.

## Reading the numbers

Keeping up means: CPU busy under about 70% sustained, load per core under 1, no container above about 90% of its CPU or memory limit while throttling or pressure is non-zero, memory stall rate near 0, OOM kills and restarts at 0, the collector's exporter queue (`otelcol_exporter_queue_size` over `_capacity`) under half, and error rate and p95 flat against the same window a day earlier. Failing any two of these is worth digging into; a limit being touched without pressure is fine.
