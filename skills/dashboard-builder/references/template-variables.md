# Dashboard template variables

Charts filter through **template variables**, referenced in chart SQL two ways:

- `{{var}}` — **required**: interpolated inline; the variable MUST resolve to a value or the chart errors with `MissingVariableError`.
- `[[ AND col = {{var}} ]]` — **optional**: the whole `[[ ... ]]` block is dropped when `var` is empty.

Always-present special variables — never define or remove them: `{{source}}`, `{{start_time}}`, `{{end_time}}`, `{{time}}`, `{{sampling}}`.

## Defining variables

A bare `{{var}}` only becomes a real (text) variable once a human opens the dashboard in the editor — when **you** build a chart, nothing auto-creates it, so a required `{{var}}` errors until it exists. **Define it with `set_dashboard_variable` before any chart references it.** Text inputs are the least useful — reach for the SQL selects so users pick from real data.

| Type                            | When to use                                          | Fields to send                                                                                                              |
| ------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `select_value`                  | Fixed option list                                    | `default_values`: the options (first = default selection)                                                                   |
| `select_with_sql`               | One value from the data (`allow_multiple_values: true` for several) | `sql_definition`: an expression yielding the option column, e.g. `label('_host')`; may reference other `{{vars}}` / `[[ ]]` |
| `multi_select_with_sql`         | Several values from the data (filter with `match`)   | `sql_definition`: same as above                                                                                             |
| `select_predefined_sql`         | Named presets, each backed by its own SQL filter     | `filters`: `[{label, sql}]`; `selected_label`: the default                                                                  |
| `string` / `number` / `boolean` | A typed literal the user edits                       | `default_values`: `[value]`                                                                                                 |
| `sql_expression`                | Raw SQL spliced in unescaped                         | `default_values`: `[sql]`                                                                                                   |
| `source`                        | Charts querying a different source than `{{source}}` | `source_ids`: `[id, ...]`; custom name required (`source` is reserved) — see below                                          |
| `date` / `datetime`             | A fixed point in time (as-of marker, baseline)       | `default_values`: `['2026-07-23T14:30:00Z']` (ISO 8601)                                                                     |

Prefer the SQL selects inside `[[ ... ]]` clauses or as menu selectors, not as bare required refs — their value resolves at runtime and may be empty. Use `dashboard` to see existing variables and any referenced-but-undefined ones, then remove with `remove_dashboard_variable`.

`select_with_sql` / `multi_select_with_sql` take an **expression**, not a full query — the platform wraps it as `SELECT DISTINCT <expr> AS option FROM {{source}} WHERE dt BETWEEN {{start_time}} AND {{end_time}} LIMIT 50` to populate the dropdown. **Validate it the way the dashboard will:** run that exact wrapped query via `query` (with the source's collection and concrete bounds in place of the template variables) and confirm it returns real values before calling `set_dashboard_variable` — if it errors or returns nothing, the dropdown will be empty.

`select_predefined_sql` filter SQL is a full query — filter time with `dt BETWEEN {{start_time}} AND {{end_time}}`, never `{{time}}` (that only buckets inside a chart and breaks here). E.g. `SELECT label('cmd') FROM {{source}} WHERE dt BETWEEN {{start_time}} AND {{end_time}} AND name = 'redis_commands_total' GROUP BY label('cmd') ORDER BY avgMerge(rate_avg) DESC LIMIT 5`.

## Referencing a variable in SQL — match the operator to the type

Each type interpolates to a different shape, so each pairs with a specific operator. Using the wrong operator silently returns no rows.

| Type                                        | Interpolates to                                   | Use in SQL                                |
| ------------------------------------------- | ------------------------------------------------- | ----------------------------------------- |
| `select_with_sql`, `select_value`, `string` | `'value'`                                         | `col = {{var}}`                           |
| `multi_select_with_sql`                     | a quoted regex: `'(a\|b)'` (single value → `'a'`) | `match(col, {{var}})` — **never** `IN`    |
| `select_predefined_sql`                     | a parenthesised list: `('a','b')`                 | `col IN {{var}}` — **no** wrapping parens |
| `number`                                    | `42`                                              | `col = {{var}}` / `col > {{var}}`         |
| `boolean`                                   | `true` / `false`                                  | `col = {{var}}`                           |
| `sql_expression`                            | raw text, spliced in unescaped                    | inline as written                         |
| `date` / `datetime`                         | `toDateTime64('…', 6)` (date → midnight)          | comparisons: `dt >= {{var}}`              |
| `source`                                    | the variable's source table                       | FROM only: `FROM {{var}}`                 |

To query another source on the same dashboard, define a `source`-type variable and reference it in the chart's FROM: `set_dashboard_variable(dashboard_id, name: "prometheus_source", variable_type: "source", source_ids: [<id>])`, then `... FROM {{prometheus_source}}`. A chart takes its source from whichever source variable its FROM names, so define the variable **before** adding the chart — a chart whose FROM references an undefined source variable is rejected with guidance to create it first. `{{source}}` is the default source; use a named source variable only to target a different one.

**The most common mistake:** `multi_select_with_sql` produces a regex, not a list. `WHERE label('cmd') IN ({{cmd}})` becomes `IN ('(get|hgetall)')` and matches nothing — write `WHERE match(label('cmd'), {{cmd}})`. And `select_predefined_sql` is already parenthesised, so write `col IN {{var}}`, not `IN ({{var}})` (which double-wraps to `IN (('a','b'))`). `match` is also an **unanchored** regex search — selecting `frontend` silently pulls in `frontend-proxy` — so anchor it: `match(label('_container'), concat('^(', {{var}}, ')$'))`.

## Example — add a host filter to a CPU chart

1. Validate the options query with `query`: `SELECT DISTINCT label('_host') AS option FROM <metrics collection> WHERE dt > now() - INTERVAL 3 HOUR LIMIT 50` → returns host names.
2. `set_dashboard_variable(dashboard_id, name: "host", variable_type: "multi_select_with_sql", sql_definition: "label('_host')")`
3. In the chart query: `... WHERE dt BETWEEN {{start_time}} AND {{end_time}} [[ AND match(label('_host'), {{host}}) ]]`

---
