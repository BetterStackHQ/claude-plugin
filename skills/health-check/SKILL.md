---
name: health-check
description: Quick health assessment of servers or services (databases, webservers) from their Better Stack telemetry. Checks metrics, logs, dependencies for anomalies. Use for "how is Nginx and Redis doing?" questions, not incident diagnosis.
---

# Health check of service

Applies to full servers or specific services (e.g., database, Redis, webserver). Prefer charts (`render_chart`) when presenting results - show a chart and a short comment, e.g. how CPU or memory is doing.

## Step 1: Find the source

Call `sources` to find the server's or service's sources, then `source` for each: its platform, its services and which data (logs, spans, metrics) it has. Keep progress notes short while you collect data.

## Default Parameters

- **Time window:** Last 3 hours (unless user specifies otherwise)

## What to Check

### 1. Metrics Anomalies

- Resource saturation spikes (CPU, memory, disk, network)
- Latency increases for certain services (p50/p95/p99)
- Error rate changes
- Throughput drops

Compare current values against the 3-hour baseline. Flag deviations.

### 2. Log Distribution

Query log counts by level over time:

- Sudden increase in error/warn logs?
- Drop in info logs (service stopped logging)?
- New log patterns appearing?
- Is there a spike in logs count by any level?

Group by `_pattern` (the message with IDs and numbers stripped) to see which kinds of lines are new or spiking; `query_help` has the syntax.

### 3. Dependencies

From spans (`spans-query`) or, on a Collector source, the requests-by-destination queries in `collector-queries`, check:

- Request rate, error rate and latency between services
- Dependencies showing elevated error rates
- Latency spikes between services

## Output

Provide a simple overview of system's health, show visualizations about key metrics and point out potential issues and your finding.

For each key metric (load, memory, disk, network, ...), repeat this rhythm:

1. Write the `### <Metric name>` heading
2. Call `render_chart` with that metric's query (a real tool call; writing the tool's name in text renders nothing)
3. Write 1-2 sentences interpreting what the chart shows

Chart each metric once, in the summary, not while collecting data. One chart at a time: chart, then its comment, then the next heading. Never a wall of text describing charts that were never rendered.

## Collector sources

When `source` reports platform Collector, load `collector-queries`: it carries the proven host queries (CPU, memory, load, disk, network, pressure) and the per-container pass (usage against limits, throttling, pressure, OOM kills, restarts) that host averages hide, plus the "keeping up" rubric for the verdict. Compare the 3-hour window against the same window a day earlier before calling a level normal. Ratios stay 0-1 with `unit: "percent"`; bytes stay raw with `B_iec`. Syntax: `metrics-query`.

## If Anomalies Found

1. Report findings with specifics (timestamps, values)
2. Ask user: "Want me to investigate deeper?"
3. If yes → load the `investigate-incident` skill and continue
