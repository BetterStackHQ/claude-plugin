---
name: dashboard-layout
description: Definitive guide for Better Stack dashboard layout — grid system, layout rules, row templates, planning process, coordinate math, section manipulation. Load when creating or modifying dashboard layouts.
---

# Dashboard Layout Guide

This is the single source of truth for all layout decisions. Referenced by the `dashboard-builder` and `grafana-import` skills.

## Grid System

Better Stack dashboards use a **12-column grid**. Charts have `(x, y, w, h)` coordinates:

- `x`: column position (0-11)
- `y`: row position (0-based)
- `w`: width in columns (must sum to 12 per row)
- `h`: height in rows (always 6 — see Height section)

**Section headers** occupy exactly 1 row of height (h=1) in the y-coordinate space. Charts in a section start at `section_y + 1`.

## Height

**ALL charts use `height: 6`.** Always pass `height: 6` explicitly — the default is 8, which is too tall.

### Minimum chart heights

| Min Height | Chart Types                                                                             |
| ---------- | --------------------------------------------------------------------------------------- |
| 6 units    | `line_chart`, `bar_chart`, `scatter_chart`, `heatmap_chart`, `gauge_chart`, `map_chart` |
| 4 units    | `pie_chart`, `number_chart`, `table_chart`, `tail_chart`                                |
| 2 units    | `static_text_chart`, `text_chart`                                                       |
| 1 unit     | sections                                                                                |

## Layout Rules (priority order)

These rules are ranked. When two rules conflict, the higher-priority rule wins.

**Rule 1 (highest): No vertical gaps.** Every row must be filled. No empty rows between charts within a section.

**Rule 2: No horizontal empty space.** Every row must sum to exactly 12 width units. No gaps on the right side.

**Rule 3: No full-width charts.** A single chart spanning w:12 is almost always wrong. If you have a lone chart, pull it up to share a row with another chart, or push it down to join the next row. Exception: tables or heatmaps that genuinely need the full width.

**Rule 4: No orphan rows.** If the last row has fewer charts than the rows above, merge it into the previous row. Up to 4 charts per row is fine.

**Rule 5: Even widths within a row.** Charts sharing a row should be equal width when possible:

- 2 charts -> w:6 + w:6
- 3 charts -> w:4 + w:4 + w:4
- 4 charts -> w:3 + w:3 + w:3 + w:3

Relax this only if needed to satisfy Rules 1-4.

**Rule 6: Prefer 3 charts per row.** This is the ideal density. 2 per row is acceptable for line charts. 4 per row is acceptable for number/gauge charts. 1 per row is a last resort.

## Number Chart (KPI) Rules

Number charts are compact — they should NEVER be as wide as line/bar charts:

- **Maximum width: w:4.** Number charts should be w:3 (default) or w:4. Never wider.
- **Mixed rows:** When a number chart shares a row with a line/bar chart, make the number chart narrow and give the remaining space to the line/bar chart.

Examples:

- 1 number + 1 line -> Number(w:3) + Line(w:9) = 12
- 1 number + 2 lines -> Number(w:3) + Line(w:5) + Line(w:4) = 12
- 2 numbers + 1 line -> Number(w:3) + Number(w:3) + Line(w:6) = 12

## Row Templates

Use these pre-approved row configurations:

```
3 line/bar charts:        w:4 + w:4 + w:4 = 12   (best overall)
2 line/bar charts:        w:6 + w:6 = 12          (acceptable)
4 number charts:          w:3 + w:3 + w:3 + w:3 = 12
3 number charts:          w:4 + w:4 + w:4 = 12
1 number + 1 line:        w:3 + w:9 = 12          (number stays narrow)
2 numbers + 1 line:       w:3 + w:3 + w:6 = 12
3 numbers + 1 line:       w:2 + w:2 + w:2 + w:6 = 12  (line takes half)
1 number + 2 lines:       w:3 + w:5 + w:4 = 12    (or w:4 + w:4 + w:4)
4 mixed (overflow merge):  w:3 + w:3 + w:3 + w:3 = 12
```

## Layout Planning Process (MANDATORY)

Charts auto-position left-to-right, top-to-bottom within a section, so **creation order = display order**. Plan first, optimize, then create.

**Step 1 — Draft.** List all charts for the section with their default widths. Assign them to rows summing to 12.

**Step 2 — Optimize.** Review the draft and fix violations. Check these in order:

- Any row with a single w:12 chart? -> Merge with another row (Rule 3)
- Orphan last row with fewer charts than rows above? -> Merge into previous row (Rule 4)
- Any number chart wider than w:4? -> Shrink it, give space to adjacent line/bar charts
- Uneven widths in a row (e.g., w:4 + w:8)? -> Try w:6 + w:6 or w:4 + w:4 + w:4
- Two rows of 2 that could become one row of 3 + one row of 1? -> Redistribute

**Step 3 — Log the plan.** Output the final layout before creating charts — a compact row list like below, not prose commentary to the user:

```
Section: "CPU & memory"
  Row 1: Avg CPU utilization (number, w:3) + Avg freeable memory (number, w:3) + Avg connections (number, w:3) + Avg disk queue depth (number, w:3) = 12
  Row 2: CPU utilization over time (line, w:4) + Freeable memory over time (line, w:4) + Disk queue depth over time (line, w:4) = 12
  Row 3: CPU by instance (bar, w:4) + Freeable memory by instance (bar, w:4) + Disk queue depth by instance (bar, w:4) = 12
```

**Step 4 — Create charts in exact row order.** Row 1 left-to-right, then Row 2 left-to-right, etc. All charts `height: 6`.

### Optimization examples

**Full-width chart (Rule 3):**

```
DRAFT (bad):
  Row 1: Line(w:6) + Line(w:6) = 12
  Row 2: Line(w:6) + Line(w:6) = 12
  Row 3: Bar(w:12) = 12              <- Rule 3: full-width

OPTIMIZED:
  Row 1: Line(w:4) + Line(w:4) + Line(w:4) = 12
  Row 2: Line(w:4) + Line(w:4) + Bar(w:4) = 12
```

**Orphan last row (Rule 4):**

```
DRAFT (bad):
  Row 1: Line(w:4) + Line(w:4) + Line(w:4) = 12
  Row 2: Line(w:4) + Line(w:4) + Line(w:4) = 12
  Row 3: Bar(w:12) = 12              <- Rule 3 + Rule 4: orphan

OPTIMIZED:
  Row 1: Line(w:4) + Line(w:4) + Line(w:4) = 12
  Row 2: Line(w:3) + Line(w:3) + Line(w:3) + Bar(w:3) = 12
```

**Number chart too wide:**

```
DRAFT (bad):
  Row 1: Number(w:6) + Line(w:6) = 12   <- number chart way too wide

OPTIMIZED:
  Row 1: Number(w:3) + Line(w:9) = 12   <- number stays compact
```

---

## Coordinate Math

### Section position calculation

Each section's y position is determined by the previous section's content:

```
section_y = previous_section_y + 1 (header) + (num_chart_rows * row_height)
```

Example with h=6 charts:

- Section A at y=0: 1 row of charts -> next section at 0 + 1 + 6 = 7
- Section B at y=7: 2 rows of charts -> next section at 7 + 1 + 12 = 20
- Section C at y=20: 1 row of charts -> next section at 20 + 1 + 6 = 27

### Chart position calculation

Charts within a section start at `section_y + 1`:

```
chart_y = section_y + 1 + (row_within_section * row_height)
```

When multiple sections exist, each chart's absolute y accounts for all section headers above it:

```
chart_y = (row_index * row_height) + number_of_section_headers_above
```

### Worked example (5 sections, 8 chart rows, h=6)

| Row | Sections above | Chart y       |
| --- | -------------- | ------------- |
| 0   | 1 (Overview)   | 0\*6 + 1 = 1  |
| 1   | 1              | 1\*6 + 1 = 7  |
| 2   | 2 (+Errors)    | 2\*6 + 2 = 14 |
| 3   | 3 (+Cache)     | 3\*6 + 3 = 21 |
| 4   | 3              | 4\*6 + 3 = 27 |
| 5   | 4 (+Traffic)   | 5\*6 + 4 = 34 |
| 6   | 4              | 6\*6 + 4 = 40 |
| 7   | 5 (+Edge)      | 7\*6 + 5 = 47 |

Section headers at: y=0, y=13 (0+1+12), y=20 (13+1+6), y=33 (20+1+12), y=46 (33+1+12).

---

## Section Manipulation

### Adding sections to a new dashboard

When building a new dashboard, use the `section` parameter on `add_chart_to_dashboard`. Sections are auto-created and charts auto-positioned within them. No coordinate math needed.

### Reordering sections on an existing dashboard

There is no tool to move or reorder sections. The reliable pattern:

1. `dashboard` — capture current chart positions and section positions
2. `remove_dashboard_section` for each section — clear all section headers
3. `move_charts` (atomic) — reposition all charts to their new y-coordinates
4. `add_dashboard_section` — add new section headers top-to-bottom (lowest y first). Each section automatically shifts all content at/below its y down by 1 row.
5. `dashboard` — verify final state; repeat from step 2 if wrong

### Gotchas

**`move_charts` rejects overlapping names at same y-coordinate.** If a chart name and a section name share the same y, `move_charts` rejects the move. Remove conflicting section headers before moving charts.

**Chart removal triggers auto-reflow.** After deleting one chart, remaining charts in that row may scatter. Immediately reposition ALL remaining charts in the affected row atomically via `move_charts`.

**`add_dashboard_section` always shifts content down.** There is no opt-out. When adding sections to a dashboard that already has charts positioned, add sections top-to-bottom so each shift cascades correctly.

---

## Layout Validation Checklist

When auditing a dashboard, check:

1. **Section alignment**: First chart in each section at `section_y + 1`
2. **Row completeness**: Every row sums to exactly w=12
3. **No vertical gaps**: Rows within a section are contiguous (prev_y + h = next_y)
4. **No overlaps**: No two charts share the same grid cell
5. **Section spacing**: `next_section_y = current_section_y + 1 + (rows * h)`
6. **Chart-to-section membership**: chart_y >= section_y + 1 AND chart_y < next_section_y
7. **Height**: All charts h=6 (except static_text which can be shorter)
8. **Number charts**: No number chart wider than w:4

## Common Layout Mistakes

| Mistake                                       | Fix                                                   |
| --------------------------------------------- | ----------------------------------------------------- |
| Charts at same y as section header            | Charts must be at `section_y + 1`                     |
| Row doesn't sum to 12                         | Adjust widths to fill the row                         |
| Single w:12 chart                             | Merge with adjacent row or split                      |
| Orphan last row                               | Merge into previous row                               |
| Number chart at w:6 or wider                  | Shrink to w:3 or w:4                                  |
| Ignoring section header height during reorder | Add +1 offset per section header above each chart row |
| Deleting chart without repositioning row      | Use `move_charts` immediately after removal           |
