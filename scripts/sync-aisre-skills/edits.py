import sys, pathlib
root = pathlib.Path(sys.argv[1])
def sub(path, old, new, count=1):
    p = root / path / "SKILL.md"
    t = p.read_text()
    n = t.count(old)
    if n != count:
        sys.exit(f"{path}: expected {count} of {old[:60]!r}, found {n}")
    p.write_text(t.replace(old, new))

WHERE = """## Where the query runs

Better Stack runs SQL in two places, and the query text differs:

- **Dashboard charts and chart alerts** (`add_chart_to_dashboard`, `edit_chart`, `create_chart_alert`): write the query as this skill shows it, with the template variables `{{source}}`, `{{time}}`, `{{start_time}}` and `{{end_time}}`. The dashboard resolves them. Chart queries always read the source's metrics collection.
- **Ad-hoc queries** (`query`, `render_chart`): there are no template variables. First call the help tool for the data type with the source ID (`query_help` for logs and spans, `metrics_query_help` for metrics, `errors_query_help` for errors): it names the source's collections and the table to pass. Put the collection where `{{source}}` stands (e.g. `remote(t123_my_app_logs)` for the last ~30 minutes, `s3Cluster(primary, t123_my_app_s3)` with its row-type filter for older rows), a bucket such as `toStartOfInterval(dt, INTERVAL 5 MINUTE)` where `{{time}}` stands, and concrete bounds such as `dt > now() - INTERVAL 3 HOUR` for `{{start_time}}` and `{{end_time}}`. Add a `LIMIT`, and call `query_windows` before an `s3Cluster(...)` query over more than a few hours.
"""

WHERE_RAW = """## Where the query runs

These queries read raw events, so they run ad hoc through `query` and `render_chart`; dashboard charts only read the metrics collection (see `dashboard-builder` for log and span volumes there). `query` and `render_chart` take no template variables. First call `query_help` with the source ID: it names the source's collections and the table to pass. Put the collection where `{{source}}` stands (e.g. `remote(t123_my_app_logs)` for the last ~30 minutes, `s3Cluster(primary, t123_my_app_s3)` with its row-type filter for older rows), a bucket such as `toStartOfInterval(dt, INTERVAL 5 MINUTE)` where `{{time}}` stands, and concrete bounds such as `dt > now() - INTERVAL 3 HOUR` for `{{start_time}}` and `{{end_time}}`. Add a `LIMIT`, and call `query_windows` before an `s3Cluster(...)` query over more than a few hours.
"""

# ---- logs-query
sub("logs-query", "# Logs Query Building Guide\n", "# Logs Query Building Guide\n\n" + WHERE_RAW)
sub("logs-query", "- Use `source_type: web_events` in `query` (and `source_fields` to discover fields — don't guess field paths).",
    "- `query_help` names the application's web-events collection; `source_fields` lists their fields. Don't guess field paths.")

# ---- spans-query
sub("spans-query", "# Spans Query Building Guide\n", "# Spans Query Building Guide\n\n" + WHERE_RAW)

# ---- metrics-query
sub("metrics-query", "Below are the facts ClickHouse knowledge does not give you; everything else is standard SQL.\n",
    "Below are the facts ClickHouse knowledge does not give you; everything else is standard SQL.\n\n" + WHERE.replace("## Where", "## Where", 1))
sub("metrics-query", "## Two storage layouts (`source_fields` says which; copy its expressions)", "## Two storage layouts (`metrics_query_help` says which; copy its expressions)")
sub("metrics-query", "1. `source_fields(source_type: \"metrics\")`: a large catalog answers with `name_filter` groups; pass one to list its metrics and their labels.",
    "1. `metrics_schema` with the source ID: a large catalog answers with name-prefix groups; pass a `name_filter` (`redis*`, `*_total`) to list those metrics and their labels.")
sub("metrics-query", "3. `query` in summary mode; read the echoed window, row count and per-column stats before trusting or charting a number. 0 rows means the window, the metric name or a label filter is wrong, in that order.",
    "3. Run it with `query` and read the window, the row count and the values before trusting or charting a number. 0 rows means the window, the metric name or a label filter is wrong, in that order.")
sub("metrics-query", "- `JSONExtract(raw, ...)` with `source_type: \"metrics\"`: the metrics table has no `raw`; query the extracted label, or switch to `source_type: \"logs\"`.",
    "- `JSONExtract(raw, ...)` against the metrics collection: it has no `raw`; query the extracted label, or query the logs collection instead.")
sub("metrics-query", "(`severity_text` on OTel sources, `level` on others, per `source_fields`)", "(`severity_text` on OTel sources, `level` on others, per `metrics_schema`)")
sub("metrics-query", "- `{{level}}`, `{{service}}` or any other variable in `query`: only `{{source}}`, `{{time}}`, `{{start_time}}`, `{{end_time}}` exist there; custom `{{var}}` and `[[ ... ]]` blocks are dashboard-only.",
    "- `{{level}}`, `{{service}}` or any other custom variable outside a dashboard: custom `{{var}}` and `[[ ... ]]` blocks exist only in dashboard charts, and `query` takes no template variables at all.")
sub("metrics-query", "see `dashboard-builder`. `query` knows no custom variables.", "see `dashboard-builder`.")
sub("metrics-query", "- `toStartOfHour(dt)` with `dt >= now() - INTERVAL 24 HOUR`: runs, but ignores the tool window, so the echoed window and the chart disagree; use `{{time}}` and the tool's bounds.",
    "- `toStartOfHour(dt)` with `dt >= now() - INTERVAL 24 HOUR` in a dashboard chart: runs, but ignores the dashboard's time range; use `{{time}}` and `{{start_time}}`/`{{end_time}}` there.")
sub("metrics-query", "never `dt` as the series column, never a function around it (`toStartOfHour({{time}})` fails).",
    "never `dt` as the series column, never a function around it (`toStartOfHour({{time}})` fails). In ad-hoc queries, see above.")

# ---- collector-queries
sub("collector-queries", "Queries use `{{source}}`, `{{time}}`, `{{start_time}}`, `{{end_time}}` exactly as `metrics-query` describes.",
    "Queries use `{{source}}`, `{{time}}`, `{{start_time}}`, `{{end_time}}` exactly as `metrics-query` describes: as written in dashboard charts, substituted in ad-hoc `query` calls.")
sub("collector-queries", "`get_service_map` is built from these; use it for dependency and RED questions rather than rebuilding it.",
    "Join them to name the peers in dependency and RED questions (see Requests and errors by destination).")

# ---- errors-query
sub("errors-query", "# Querying exceptions (Errors sources)\n", "# Querying exceptions (Errors sources)\n\n" + WHERE)
sub("errors-query", "- **State**: triage status (resolved/unresolved, who changed it, when) lives in Better Stack's database and is returned ONLY by `errors` / `error`. Never infer state from SQL.",
    "- **State**: triage status (resolved/unresolved, who changed it, when) is returned ONLY by `errors` / `error` and changed with `update_error_state`. Never infer state from SQL.")
sub("errors-query", "- **Issues**: Linear/Jira issues linked to an error are listed by `error`; attach or file one with `link_error_issue` / `create_error_issue` (through the team's Better Stack integration, so state changes post comments on the issue), detach with `unlink_error_issue`.",
    "- **Issues**: Linear/Jira issues linked to an error are listed by `error`; attach or file one with `link_error_issue` / `create_error_issue` (through the team's Better Stack integration, so state changes post comments on the issue), detach with `unlink_error_issue`.")
sub("errors-query", "Query the source's metrics table (`source_type: 'metrics'`). The schema is **fixed for all Errors sources** - query it directly, no `source_fields` discovery needed:",
    "Query the application's metrics collection (`errors_query_help` names it). The schema is **fixed for all Errors sources** - query it directly, no field discovery needed:")
sub("errors-query", "- `pattern` - plain column holding the error-group hash: the same hash `errors` returns and `{{error_pattern::source=...&hash=...}}` references carry. Filter on it to scope any query to one error group",
    "- `pattern` - plain column holding the error-group hash: the same hash `errors` returns and `error` takes. Filter on it to scope any query to one error group")
sub("errors-query", "`query` with `source_type: 'exceptions'`. Raw-JSON dialect like logs:",
    "`query` over the application's raw exception rows (`errors_query_help` names the collection and its row-type filter). Raw-JSON dialect like logs:")
sub("errors-query", "`render_chart` does not accept `source_type: 'exceptions'` - build exception trend charts from the metrics table (queries above). Raw exceptions are for `query` drill-downs: stack traces, payload inspection, sample events.",
    "Build exception trend charts from the metrics collection (queries above). Raw exceptions are for `query` drill-downs: stack traces, payload inspection, sample events.")
print("ok")

# ---- health-check
sub("health-check", "Applies to full servers or specific services (e.g., database, Redis, webserver). Always prefer to use charts (`render_chart`) when presenting results - show chart and small comments - e.g how CPU, or memory is doing.",
    "Applies to full servers or specific services (e.g., database, Redis, webserver). Prefer charts (`render_chart`) when presenting results - show a chart and a short comment, e.g. how CPU or memory is doing.")
sub("health-check", """## Step 1: Start Research Block

**FIRST action:** Call `start_research` before any other tool call.

- Title: "[Service/Server] Health Check"
- Description: Brief scope of investigation (e.g., "Checking CPU, memory, disk, network, and logs")

- All subsequent tool calls go inside this block. Brief text output appears as progress notes. Always call `end_research` when done.
- Prefer silent tool execution during investigation

""", """## Step 1: Find the source

Call `sources` to find the server's or service's sources, then `source` for each: its platform, its services and which data (logs, spans, metrics) it has. Keep progress notes short while you collect data.

""")
sub("health-check", "Use `analyze_log_patterns` to identify clusters.",
    "Group by `_pattern` (the message with IDs and numbers stripped) to see which kinds of lines are new or spiking; `query_help` has the syntax.")
sub("health-check", """### 3. Service Map (if collector source)

Check `get_service_map` for:

- RED metrics on connections
- Dependencies showing elevated error rates
- Latency spikes between services
""", """### 3. Dependencies

From spans (`spans-query`) or, on a Collector source, the requests-by-destination queries in `collector-queries`, check:

- Request rate, error rate and latency between services
- Dependencies showing elevated error rates
- Latency spikes between services
""")
sub("health-check", """Charts render inline at the exact point in your reply where you CALL the `render_chart` tool. Writing the tool's name into your text renders nothing: if the literal string `render_chart` appears anywhere in your final message, you wrote text where a tool call belongs and the user sees no chart.

For each key metric (load, memory, disk, network, ...), repeat this exact rhythm:

1. Write the `### <Metric name>` heading
2. CALL the `render_chart` tool with that metric's query (a real tool call, never text)
3. Write 1-2 sentences interpreting what the chart shows

Rules:

- Charts belong in this output section ONLY. Never render charts during the research phase — each metric is charted exactly once, in the summary
- One chart at a time: chart, then its comment, then the next heading. Never call `render_chart` twice back-to-back or in parallel

So a two-metric summary is: heading, tool call, comment, heading, tool call, comment. Never a wall of text describing charts that were never rendered.""",
"""For each key metric (load, memory, disk, network, ...), repeat this rhythm:

1. Write the `### <Metric name>` heading
2. Call `render_chart` with that metric's query (a real tool call; writing the tool's name in text renders nothing)
3. Write 1-2 sentences interpreting what the chart shows

Chart each metric once, in the summary, not while collecting data. One chart at a time: chart, then its comment, then the next heading. Never a wall of text describing charts that were never rendered.""")
sub("health-check", "When `source` reports platform Collector, load `collector-queries`", "When `source` reports platform Collector, load `collector-queries`")
sub("health-check", "3. If yes → load `investigation-methodology` skill and continue", "3. If yes → load the `investigate-incident` skill and continue")

# ---- chart-alerts
sub("chart-alerts", """Don't guess a significance. `preview_chart_alert` replays one against real history, so you can answer
"how many alerts would this cause?" with a number instead of advice.""",
"""Don't guess a significance or a threshold: query the chart's data over the past days first (`chart`, then `query`) and say how often the condition would have been met.""")
sub("chart-alerts", "| `gid://uptime/Policy/<id>` | A specific escalation policy (from `escalation_policies`) |",
    "| `gid://uptime/Policy/<id>` | A specific escalation policy (from `escalation_policies`) |")
sub("chart-alerts", "| `gid://...` (schedule)     | A specific schedule (from `on_calls`)         |",
    "| `gid://uptime/Team/<id>`   | A specific team's default on-call                   |")
sub("chart-alerts", "check its value range (`chart`) → choose the alert type → replay the settings (`preview_chart_alert`) → `create_chart_alert`.",
    "check its value range (`chart`, then `query` over a few days) → choose the alert type → `create_chart_alert`.")
start = (root / "chart-alerts" / "SKILL.md").read_text()
a = start.index("## Previewing\n"); b = start.index("## Examples\n")
(root / "chart-alerts" / "SKILL.md").write_text(start[:a] + start[b:])
sub("chart-alerts", "| Guessing at a significance or threshold      | `preview_chart_alert` first, then quote counts |",
    "| Guessing at a significance or threshold      | Query the chart's history first, then quote how often it would fire |")
sub("chart-alerts", "| Replay settings    | `preview_chart_alert`      |\n", "")
sub("chart-alerts", "| Edit configuration | `create_chart_alert`         |", "| Create             | `create_chart_alert`       |\n| Edit configuration | `edit_chart_alert`         |")
sub("chart-alerts", "| Get alert details  | `chart_alert`  |", "| Get alert details  | `chart_alert`              |")
sub("chart-alerts", "| List all alerts    | `chart_alerts`        |", "| List all alerts    | `chart_alerts`             |")
sub("chart-alerts", "Chart alerts monitor metrics and logs queries and trigger incidents when conditions are met. They are attached to charts on dashboards or explorations.",
    "Chart alerts monitor metrics and logs queries and trigger incidents when conditions are met. They are attached to charts on dashboards or explorations. `chart_alert_help` has the server's current reference.")

# ---- chart-generation
sub("chart-generation", "Funnels (`funnel_chart`, `funnel_trend_chart`) are not dashboard charts: they live in Explore, built from steps with `create_exploration`. Load the `funnel-charts` skill.",
    "Funnels (`funnel_chart`, `funnel_trend_chart`) are not dashboard charts: they live in Explore, built from steps in the Better Stack UI.")
sub("chart-generation", "This guide covers everything needed to create properly configured charts using the `add_chart_to_dashboard` tool.",
    "This guide covers everything needed to create properly configured charts using the `add_chart_to_dashboard` and `edit_chart` tools. `chart_building_help` has the server's current reference.")

# ---- dashboard-layout
sub("dashboard-layout", "a compact row list like below (inside the research block if one is open), not prose commentary to the user:",
    "a compact row list like below, not prose commentary to the user:")
sub("dashboard-layout", "There is no `move_section` or `reorder_sections` MCP tool.", "There is no tool to move or reorder sections.")

# ---- dashboard-builder
sub("dashboard-builder", "suggest [Explore](https://telemetry.betterstack.com/team/t0/explore-logs/new) for one-off visualizations",
    "suggest [Explore](https://telemetry.betterstack.com/team/t0/explore-logs/new) for one-off visualizations")
sub("dashboard-builder", "   - **Building from a pre-existing plan** (e.g. a `*-plan.md` markdown file from a planning step): treat the plan's layout as **untrusted input**.",
    "   - **Building from a pre-existing plan** (e.g. a plan file the user gives you): treat the plan's layout as **untrusted input**.")
sub("dashboard-builder", " (Simon, 2026-09-11: the old \"anomaly counter where 0 is healthy → `dont_stack`\" exception was wrong; a blank chart at 0 is fine, and the filled spike on a non-zero value is the whole point.)",
    " A blank chart at 0 is fine; the filled spike on a non-zero value is the whole point.")
sub("dashboard-builder", " (Simon, 2026-09-11.)", "")
sub("dashboard-builder", "4. **Validate queries** - Execute each query with `query` to verify data exists and values make sense",
    "4. **Validate queries** - Run each query with `query` to verify data exists and values make sense (substitute the template variables as `metrics-query` describes)")
sub("dashboard-builder", "**Validate it the way the dashboard will:** run that exact wrapped query via `query`",
    "**Validate it the way the dashboard will:** run that exact wrapped query via `query` (with the source's collection and concrete bounds in place of the template variables)")
sub("dashboard-builder", "| `select_with_sql`               | One value from the data                              |",
    "| `select_with_sql`               | One value from the data (`allow_multiple_values: true` for several) |")
sub("dashboard-builder", "1. Validate the options query: `query(\"SELECT DISTINCT label('_host') AS option FROM {{source}} WHERE dt BETWEEN {{start_time}} AND {{end_time}} LIMIT 50\")` → returns host names.",
    "1. Validate the options query with `query`: `SELECT DISTINCT label('_host') AS option FROM <metrics collection> WHERE dt > now() - INTERVAL 3 HOUR LIMIT 50` → returns host names.")
sub("dashboard-builder", "After successful generation of the dashboard, provide concise overview and link to dashboard using resource reference.",
    "After successful generation of the dashboard, provide a concise overview and the dashboard's link from the tool result.")

# ---- uptime-monitors
sub("uptime-monitors", "Load before using create_monitor, monitors, monitor, escalation_policies, or escalation_policy.",
    "Load before using create_monitor, create_heartbeat, monitors, monitor, escalation_policies or escalation_policy.")
sub("uptime-monitors", """- `create_monitor` — create a monitor.
- `delete_monitor` — remove a monitor by `monitor_id`. Removal **archives** the monitor — it stops all checks, drops it from the team's monitors, and resolves any open incident for it. Call `monitors`/`monitor` first to confirm the right ID.
- `escalation_policies`, `escalation_policy` — read escalation policies (who gets paged).

Both write tools (`create_monitor`, `delete_monitor`) **ask the user to confirm first and require the "Monitors" permission** (otherwise they're denied).

There is **no update or pause/resume tool**. You can create, read, and remove monitors, but not edit one in place (change its URL, frequency, alerting, etc.) or pause/resume it. You can read escalation policies but not create/edit them. To "update" a monitor, either delete & recreate it, or give the user a `{{monitor::<id>::<name>}}` link so they can adjust it in the UI settings. Prefer the link — delete & recreate resolves any open incidents and loses history.""",
"""- `monitor_availability`, `monitor_response_times` — a monitor's availability and response times, per region.
- `create_monitor` — create a monitor. `create_heartbeat` — create a heartbeat (below).
- `escalation_policies`, `escalation_policy` — read escalation policies (who gets paged).

Show the user what you are about to create and get a yes before calling a create tool: a new monitor starts checking, and alerting, right away.

There is **no update, pause/resume or delete tool**. You can create and read monitors, but not edit one in place (change its URL, frequency, alerting, etc.), pause, resume or remove it. You can read escalation policies but not create/edit them. To change a monitor, give the user its link from the tool result so they can adjust it in the Better Stack UI.""")
sub("uptime-monitors", "| `playwright`                            | a scripted browser/API scenario passes | scenario name          | `playwright_script`              |",
    "| `playwright`                            | a scripted browser/API scenario passes | scenario name          | the script (UI only)             |")
sub("uptime-monitors", "| `tcp` / `udp` / `smtp` / `pop` / `imap` | a port answers                         | host                   | a **port** — not settable        |",
    "| `tcp` / `udp` / `smtp` / `pop` / `imap` | a port answers                         | host                   | `port`                           |")
sub("uptime-monitors", "**You can create the four HTTP types, `ping`, `dns`, and `playwright`.** Only the port-based types (`tcp`, `udp`, `smtp`, `pop`, `imap`) aren't creatable here — they need a `port` that `create_monitor` doesn't expose, so they must be set up in the Better Stack UI.",
    "**You can create every type except `playwright`**: `create_monitor` takes no script, so a Playwright monitor is set up in the Better Stack UI (see below). The port-based types (`tcp`, `udp`, `smtp`, `pop`, `imap`) need `port`.")
sub("uptime-monitors", "Some monitor kinds exist in the product but **can't be created via this tool** (direct the user to the UI): **heartbeat / cron** (passive \"ping us every N minutes\" checks), and **SSL-certificate** / **domain-expiration** monitors (they alert N days before expiry; valid windows are 1, 2, 3, 7, 14, 30, 60 days).",
    "**Heartbeats** (passive \"ping us every N minutes\" checks for cron jobs and workers) are created with `create_heartbeat`; the job then calls the heartbeat URL from the result on every successful run. **SSL-certificate** / **domain-expiration** monitors (they alert N days before expiry; valid windows are 1, 2, 3, 7, 14, 30, 60 days) **can't be created via these tools**: direct the user to the UI.")
sub("uptime-monitors", "**Not settable via the tool** (UI-only — don't promise them): basic auth (`auth_username`/`auth_password`), `environment_variables` and the Playwright `scenario_name`, `remember_cookies`, maintenance windows, SSL/domain-expiration alerts, proxy, monitor groups, and `port`.",
    "- `port` (port-based types), `monitor_group_id` (an existing monitor group), `team_wait` (seconds before escalating to the whole team).\n\n**Not settable via the tool** (UI-only — don't promise them): basic auth (`auth_username`/`auth_password`), the Playwright script, `environment_variables` and `scenario_name`, `remember_cookies`, maintenance windows, SSL/domain-expiration alerts and proxy.")
sub("uptime-monitors", "- Set `monitor_type: \"playwright\"`, pass the code as `playwright_script`, and put a short **scenario name** in `url` (for Playwright, `url` is the monitor's name, not an address).",
    "- `create_monitor` takes no script: write the scenario for the user and have them create the Playwright monitor in the Better Stack UI and paste it there.")
sub("uptime-monitors", "- Secrets: `environment_variables` aren't settable via this tool, so you can't inject credentials — keep created scripts to unauthenticated flows (or have the user add the variables in the UI). Never hardcode secrets in the script.",
    "- Secrets: credentials go in the monitor's environment variables in the UI. Never hardcode secrets in the script.")
sub("uptime-monitors", "- Show the user the script and settings before creating; the confirmation prompt handles the rest.",
    "- Show the user the script and settings before creating anything; a Playwright scenario goes in through the UI (above).")
t = (root / "uptime-monitors" / "SKILL.md").read_text()
a = t.index("## Secrets are hidden from you\n"); b = t.index("## Linking in chat\n")
t = t[:a] + t[b:]
t = t.replace("""Reference a monitor or policy so it renders as a clickable link instead of a bare ID:
`{{monitor::<id>::<name>}}` and `{{policy::<id>::<name>}}`.""", "Link a monitor or policy with the Better Stack URL from the tool result rather than a bare ID.")
(root / "uptime-monitors" / "SKILL.md").write_text(t)

# ---- grafana-import
TOOLSETUP_OLD = """Most Better Stack MCP tools are **deferred** — they won't appear in your tool list until loaded via ToolSearch. Before starting, load the dashboard tools, e.g.:

```
ToolSearch("select:create_dashboard,add_chart_to_dashboard,set_dashboard_variable")
```

(`query`, `metrics_schema`, `source`, and `sources` are always loaded.)"""
TOOLSETUP_NEW = """You need the Better Stack dashboard tools (`create_dashboard`, `add_chart_to_dashboard`, `set_dashboard_variable`) and the query tools (`sources`, `source`, `metrics_schema`, `query`). If your client loads tools on demand, load them before starting.

The extract script is `scripts/extract-layout.js` in this skill's directory, run with Node.js 18 or newer. If you can't run scripts, read the export yourself and pull out the same fields: sections, panels, their queries, units and template variables."""
for s in ("grafana-import",):
    sub(s, f"allowed-tools: Bash(node .claude/skills/{s}/scripts/*)\n", "")
    sub(s, TOOLSETUP_OLD, TOOLSETUP_NEW)
    p = root / s / "SKILL.md"; t = p.read_text()
    t = t.replace(f"node .claude/skills/{s}/scripts/", "node <this skill's directory>/scripts/")
    p.write_text(t)

# ---- the Datadog import skills stay AI SRE-only (Simon, 2026-10-11): drop references to them
sub("dashboard-layout", "Referenced by `dashboard-builder`, `datadog-import`, and `grafana-import` skills.",
    "Referenced by the `dashboard-builder` and `grafana-import` skills.")
sub("chart-alerts", "\n>\n> **Migrating alerts from Datadog?** Load the `datadog-alert-import` skill — it maps each Datadog monitor type to a chart alert.", "")

# ---- descriptions: scope to Better Stack, since plugin skills sit next to the user's own
DESC = {
  "chart-alerts": ("Guide for creating and managing chart alerts.", "Guide for creating and managing Better Stack chart alerts."),
  "chart-generation": ("Complete reference for chart types, units, and settings on dashboards.", "Complete reference for chart types, units, and settings on Better Stack dashboards."),
  "chart-styling": ("Chart styling and advanced settings reference -", "Better Stack chart styling and advanced settings reference -"),
  "dashboard-builder": ("Guide for building dashboards. Load when asked to create a dashboard or add multiple charts.", "Guide for building Better Stack dashboards. Load when asked to create a dashboard or add multiple charts in Better Stack."),
  "errors-query": ("Load BEFORE querying exception or error-pattern data with SQL", "Load BEFORE querying Better Stack exception or error-pattern data with SQL"),
  "health-check": ("Quick health assessment for servers or services (databases, webservers).", "Quick health assessment of servers or services (databases, webservers) from their Better Stack telemetry."),
  "logs-query": ("MUST load BEFORE writing any logs or web-events SQL query.", "MUST load BEFORE writing any Better Stack logs or web-events SQL query."),
  "map-hierarchy-charts": ("Query shapes and settings for map_chart", "Query shapes and settings for Better Stack map_chart"),
  "spans-query": ("MUST load BEFORE writing any spans/traces SQL query.", "MUST load BEFORE writing any Better Stack spans/traces SQL query."),
  "metrics-query": ("MUST load BEFORE writing any metrics SQL query.", "MUST load BEFORE writing any Better Stack metrics SQL query."),
}
for s, (o, n) in DESC.items():
    sub(s, "description: " + o, "description: " + n)
