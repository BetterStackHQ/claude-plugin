---
name: chart-styling
description: Better Stack chart styling and advanced settings reference - series colors and order, number chart coloring thresholds, heatmap color categories, gauge bounds, y-axis tuning, custom units, and the per-key settings table with cross-setting gotchas. Load when configuring how a chart looks beyond defaults, or when unsure which settings key applies to a chart type.
---

# Chart Styling & Advanced Settings

Detailed reference for the `settings` keys the chart tools accept beyond the basics covered in the `chart-generation` skill. The tool schema deliberately keeps its descriptions terse — this file is the authority on semantics, defaults, and per-type applicability.

## Per-key reference

| Key                                  | Applies to                          | Values / default                                                                | Notes                                                                                                                                                      |
| ------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unit` + `custom_unit`               | all except table                    | any supported unit / `auto`                                                     | `custom_unit: true` renders `unit` verbatim as a literal suffix, no auto-scaling                                                                           |
| `decimal_places`                     | all                                 | number, default `2`                                                             |                                                                                                                                                            |
| `time_column`                        | line, bar, number, scatter, heatmap | default `"time"`                                                                | The X-axis column despite the name; category bar charts point it at the grouping column                                                                    |
| `x_axis_type`                        | line, bar, scatter, heatmap         | `time` (default), `value`, `category`                                           | line: time/value; bar & heatmap: time/category; scatter: all three                                                                                         |
| `y_axis_type`                        | scatter only                        | `value` (default), `category`                                                   |                                                                                                                                                            |
| `point_size_column`                  | scatter only                        | default `"size"`                                                                | Column whose value sizes each point                                                                                                                        |
| `y_axis_min` / `y_axis_max`          | line, bar                           | numbers                                                                         | `y_axis_max: 1` for 0-1 ratios with percent unit                                                                                                           |
| `y_axis_auto_range`                  | line only                           | `include_zero` (default), `fit_data`                                            | `fit_data` for values far from zero; hidden when `y_axis_scale` is `log`                                                                                   |
| `y_axis_scale`                       | line, bar, scatter                  | `linear` (default), `log`                                                       |                                                                                                                                                            |
| `min` / `max`                        | gauge only                          | defaults `0` / `1`                                                              | `max` is the goal value; unset `max` falls back to the data maximum                                                                                        |
| `treat_missing_values`               | line, number                        | `connected`, `disconnected`, `zero`, `previous`                                 | See restrictions in Gotchas                                                                                                                                |
| `stacking`                           | line, bar                           | `dont_stack`, `stack`, `stack_to_100`                                           | line has no `stack_to_100`                                                                                                                                 |
| `orientation`                        | bar only                            | `vertical` (default), `horizontal`                                              | Horizontal suits category toplists                                                                                                                         |
| `legend`                             | line, bar, pie, scatter             | `hidden`, `shown_below` (default), `shown_below_with_statistics`, `shown_right` | `shown_below_with_statistics` adds min/mean/max per series (line/bar/scatter)                                                                              |
| `series_colors`                      | line, bar, scatter, pie             | map series name → hex                                                           |                                                                                                                                                            |
| `series_order`                       | line, bar, scatter, pie             | array of series names                                                           | Explicit display order                                                                                                                                     |
| `show_previous_period`               | line only                           | boolean                                                                         | Overlays the previous period as a comparison series                                                                                                        |
| `column_units`                       | table                               | map column → `{ unit, custom_unit }`                                            | Tables ignore chart-level `unit`; see chart-generation's Table Chart Settings                                                                              |
| `percentage_highlight_columns`       | table only                          | array of column names                                                           | In-cell progress bars for 0-1 ratio columns                                                                                                                |
| `series_unit` + `series_custom_unit` | heatmap only                        | same values as `unit`                                                           | Formats the Y-axis labels                                                                                                                                  |
| `heatmap_color_mode`                 | heatmap only                        | `gradient` (default), `categorized`                                             |                                                                                                                                                            |
| `value_categories`                   | heatmap only                        | map cell value → `{ label, color }`                                             | Only read in `categorized` mode                                                                                                                            |
| map & hierarchy keys                 | map, hierarchy                      |                                                                                 | `location_column`, `location_label`, `label_column`, `group_by_columns`, `palette`, `min_value`/`max_value`, `link_template` — load `map-hierarchy-charts` |

## Series colors & order

For line/bar/scatter/pie charts:

- `series_colors` — per-series color overrides, map of series name → CSS hex color: `{ "api": "#22c55e", "worker": "#ef4444" }`. Use sparingly; the default palette is usually right. Good uses: semantic colors (errors red, success green) or keeping one entity's color stable across charts.
- `series_order` — explicit display order, array of series names.

## Number chart coloring

`color_mode` colors the rendered value:

| `color_mode`     | Effect                             | Companion settings                                                                                                     |
| ---------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `auto`           | Default neutral color              | —                                                                                                                      |
| `high_green`     | High values green, low values red  | `color_upper_threshold` (green above), `color_lower_threshold` (yellow between the two, red below)                     |
| `high_red`       | High values red, low values green  | Same thresholds, inverted colors                                                                                       |
| `specific_words` | Color by matching the string value | `color_green_words`, `color_yellow_words`, `color_red_words` — comma-separated values; anything unmatched renders blue |

Example — error-rate KPI that goes red when high: `{ "color_mode": "high_red", "color_upper_threshold": 5, "color_lower_threshold": 1 }`.

## Heatmap colors

- `heatmap_color_mode: "gradient"` (default) — cell color scales with the value.
- `heatmap_color_mode: "categorized"` — each exact cell value gets a fixed color via `value_categories`, a map of cell value → `{ label, color }`. Example for HTTP status codes: `{ "200": { "label": "OK", "color": "#22c55e" }, "500": { "label": "Server error", "color": "#ef4444" } }`.

Format the Y-axis labels with `series_unit` (same values as `unit`; pair with `series_custom_unit: true` for a literal suffix).

## Gauge bounds

`min` (default 0) and `max` (default 1) — set both explicitly. `max` is the goal/target value the gauge fills toward; when unset the renderer falls back to the data maximum, which makes the gauge always look full. For 0-1 percentage values use `unit: "percent"` with `max: 1`.

## Cross-setting gotchas

Combinations the chart editor rewrites or that break other features — set them right the first time:

- `stacking: "stack"` on a line chart forces `treat_missing_values` to `zero`/`previous` (`connected` breaks stacking and is rewritten to `zero`).
- `stacking: "stack_to_100"` (bar) overwrites `unit` with `percent`.
- **A line/bar chart with `x_axis_type` other than `time` can't have chart alerts** — keep `time` if alerting matters.
- `number_chart` never renders `disconnected` gaps.
- Hierarchy charts with `unit: "percent"` auto-seed `min_value: 0` / `max_value: 1` when unset.
- Changing a heatmap's value column wipes its `value_categories`.
