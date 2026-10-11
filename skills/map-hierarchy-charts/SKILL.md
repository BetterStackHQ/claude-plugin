---
name: map-hierarchy-charts
description: Query shapes and settings for Better Stack map_chart (geographic map) and hierarchy_chart (host map hexagons). MUST load before creating either chart type — on dashboards or in Explore.
---

# Map & Hierarchy Charts

Both are **not** time-series: the query returns one row per location/entity — **no `time` column, no `GROUP BY time`, no series**. `AS value` is fine for both — neither renders a legend, so the value alias is never displayed. Load the query skill for the data type first (`metrics-query` / `logs-query`).

## Map Charts (`map_chart`)

Plot a numeric value at geographic points on a world map. Select exactly two things — a numeric value and a location — and group by the location.

**Metrics:**

```sql
SELECT
  avgMerge(rate_avg) AS value,
  location(label('colo')) AS location
FROM {{source}}
WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}}
  AND name = 'cloudflare_zone_colocation_requests_total'
GROUP BY location
```

**Raw events (logs / web events, e.g. in Explore):**

```sql
SELECT
  COUNT(*) AS value,
  location(JSONExtractCaseInsensitive(raw, 'remote_ip', 'Nullable(String)')) AS location
FROM {{source}}
WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}}
GROUP BY location
```

- **`location(...)`** resolves a string to coordinates: an **IP** (`'1.1.1.1'`), **airport code** (`'JFK'`), **city** (`'San Francisco, CA'`), or **country** (`'US'`, `'UK'`) — typically a metric label (`location(label('colo'))`) or a raw event field. Explicit coordinates work too: `tuple(lat, lng, 'custom_label')`.
- The location expression must be aliased `AS location` and the value `AS value` (or set `location_column` / `value_columns` to match your aliases).

### Settings

| Setting           | Purpose                                                                                                                       | Default       |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `location_column` | Result column holding the `location()` tuple                                                                                  | `"location"`  |
| `value_columns`   | Single-entry array with the numeric value column                                                                              | `["value"]`   |
| `location_label`  | `"automatic"` shows the closest city/country in tooltips; `"original_value"` shows the raw input (the IP, airport code, etc.) | `"automatic"` |
| `unit`            | Value formatting                                                                                                              | `"auto"`      |

Use `location_label: "original_value"` when the raw values matter to the reader (e.g. to see the actual IP addresses rather than the nearest city).

## Hierarchy Charts (`hierarchy_chart`)

Host maps: one colored hexagon per entity — host, service, pod — colored by a single numeric value on a min→max scale. Select a numeric value and an identifying label, one row per entity:

```sql
SELECT
  label('_host') AS host,
  avgMerge(value_avg) AS value
FROM {{source}}
WHERE {{time}} BETWEEN {{start_time}} AND {{end_time}}
  AND name = 'system_cpu_utilization_ratio'
GROUP BY host
-- Settings: value_columns: ["value"], label_column: "host"
```

- The label column identifies each hexagon (shown inside it / in the tooltip); the single `value_columns` entry colors it.
- To nest hexagons into groups (e.g. by environment or region), select up to two extra label columns, add them to `GROUP BY`, and list them in `group_by_columns` (first = outer group, second = sub-cluster).

### Settings

| Setting                   | Purpose                                                                                                                             | Default                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `value_columns`           | Single-entry array with the numeric value that colors each hexagon                                                                  | `["value"]`                              |
| `label_column`            | Result column identifying each hexagon                                                                                              | auto-detected (first non-numeric column) |
| `group_by_columns`        | Up to two columns to nest hexagons by (first = outer group, second = sub-cluster)                                                   | `[]`                                     |
| `palette`                 | `"green_to_red"` (low = green — for metrics where high is bad, e.g. CPU) or `"red_to_green"` (high is good)                         | `"green_to_red"`                         |
| `min_value` / `max_value` | Color scale bounds; set `0`/`1` for 0-1 ratios with `unit: "percent"`                                                               | data min / max                           |
| `link_template`           | URL opened when a hexagon is clicked; `{{column}}` placeholders are filled from the row (e.g. `https://example.com/hosts/{{host}}`) | none                                     |
| `unit`                    | Value formatting                                                                                                                    | `"auto"`                                 |
