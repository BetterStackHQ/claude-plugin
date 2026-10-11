---
name: uptime-monitors
description: Reference for Better Stack Uptime monitors and escalation policies — monitor types, valid configuration values, how escalation policies work, and the limits of what the monitor tools can do. Load before using create_monitor, create_heartbeat, monitors, monitor, escalation_policies or escalation_policy.
---

# Uptime monitors & escalation policies

What the Uptime tools can do, the non-obvious rules, and where the limits are. A **monitor** is one Uptime check against a URL or host; when a check fails it opens an **incident** and alerts whoever the monitor's **escalation policy** routes it to.

## Tools at a glance

- `monitors`, `monitor` — read monitors.
- `monitor_availability`, `monitor_response_times` — a monitor's availability and response times, per region.
- `create_monitor` — create a monitor. `create_heartbeat` — create a heartbeat (below).
- `escalation_policies`, `escalation_policy` — read escalation policies (who gets paged).

Show the user what you are about to create and get a yes before calling a create tool: a new monitor starts checking, and alerting, right away.

There is **no update, pause/resume or delete tool**. You can create and read monitors, but not edit one in place (change its URL, frequency, alerting, etc.), pause, resume or remove it. You can read escalation policies but not create/edit them. To change a monitor, give the user its link from the tool result so they can adjust it in the Better Stack UI.

## Monitor types

`monitor_type` defaults to `status`. What the `url` field means depends on the type:

| Type                                    | Checks                                 | `url` is               | Extra field                      |
| --------------------------------------- | -------------------------------------- | ---------------------- | -------------------------------- |
| `status`                                | HTTP returns 2xx                       | full URL (`https://…`) | —                                |
| `expected_status_code`                  | HTTP returns one of the listed codes   | full URL               | `expected_status_codes`          |
| `keyword`                               | response body **contains** a word      | full URL               | `required_keyword`               |
| `keyword_absence`                       | response body is **missing** a word    | full URL               | `required_keyword`               |
| `ping`                                  | host answers ICMP ping                 | host (`example.com`)   | —                                |
| `tcp` / `udp` / `smtp` / `pop` / `imap` | a port answers                         | host                   | `port`                           |
| `dns`                                   | a DNS server answers                   | host (DNS server)      | `request_body` (domain to query) |
| `playwright`                            | a scripted browser/API scenario passes | scenario name          | the script (UI only)             |

**You can create every type except `playwright`**: `create_monitor` takes no script, so a Playwright monitor is set up in the Better Stack UI (see below). The port-based types (`tcp`, `udp`, `smtp`, `pop`, `imap`) need `port`.

**Heartbeats** (passive "ping us every N minutes" checks for cron jobs and workers) are created with `create_heartbeat`; the job then calls the heartbeat URL from the result on every successful run. **SSL-certificate** / **domain-expiration** monitors (they alert N days before expiry; valid windows are 1, 2, 3, 7, 14, 30, 60 days) **can't be created via these tools**: direct the user to the UI.

## Configuration you can set (and valid values)

`create_monitor` exposes a curated subset of monitor settings. Passing an invalid value is rejected, so stick to these:

- `check_frequency` (seconds): HTTP monitors **30, 45, 60, 120, 180, 300, 600, 900, 1800**; Playwright **60, 180, 300, 600, 900, 1800, 3600, …**. Sub-3-minute frequencies need a paid plan (otherwise floored to the plan minimum).
- `request_timeout` (seconds): HTTP **2–180**, Playwright **15–900**; must not exceed `check_frequency`.
- `regions`: any subset of **`us`, `eu`, `as`, `au`** (defaults to all four if omitted).
- `http_method`: `get` (default), `head`, `post`, `put`, `patch`. Send a payload with `request_body` (for `post`/`put`/`patch`, or as the query for a `dns` monitor).
- `verify_ssl` (default true) and `follow_redirects` (default true).
- `recovery_period` (seconds the check must pass before an incident auto-resolves: 0, 60, 180, 300, 900, 1800, 3600, 7200) and `confirmation_period` (seconds to re-check before opening an incident: 0–86400).
- `request_headers`: list of `{name, value}`.
- `required_keyword`, `expected_status_codes` — see the type table.
- Alert flags: `email`, `sms`, `call`, `push`, `critical_alert` (but see the policy gotcha below).
- `paused`: create the monitor without checking until it's resumed (in the UI).
- `policy_id` — see escalation policies.

- `port` (port-based types), `monitor_group_id` (an existing monitor group), `team_wait` (seconds before escalating to the whole team).

**Not settable via the tool** (UI-only — don't promise them): basic auth (`auth_username`/`auth_password`), the Playwright script, `environment_variables` and `scenario_name`, `remember_cookies`, maintenance windows, SSL/domain-expiration alerts and proxy.

**3xx gotcha:** an `expected_status_codes` list containing a 3xx (e.g. `[200, 301]`) is rejected unless **both** `follow_redirects` _and_ `remember_cookies` are off — and `remember_cookies` isn't settable here. So a monitor that expects a 3xx can't be fully created via the tool; set it up in the UI, or don't list a 3xx as expected.

## Creating a Playwright monitor

A `playwright` monitor runs a JavaScript scenario — the way to assert **several things at once** (status + body + response time) or drive a browser flow, which no basic type can do.

- `create_monitor` takes no script: write the scenario for the user and have them create the Playwright monitor in the Better Stack UI and paste it there.
- For simple HTTP scenarios use Playwright's request API:
  ```js
  import { test, expect } from "@playwright/test";
  test("health", async ({ request }) => {
    const start = Date.now();
    const res = await request.get("https://example.com/health");
    expect(res.status()).toBe(200);
    expect(await res.text()).toBe("OK");
    expect(Date.now() - start).toBeLessThan(3000);
  });
  ```
- `check_frequency` for Playwright must be ≥ 60s (60, 180, 300, 600, 900, 1800, 3600, …); it defaults to 180 and is floored to the plan's minimum. Playwright monitoring also needs a plan that includes it, or the create is denied.
- Playwright monitors are **stateless** — nothing persists between runs (no shared session or cookies), so each script must set up whatever it needs.
- Secrets: credentials go in the monitor's environment variables in the UI. Never hardcode secrets in the script.

## Importing Datadog synthetic tests

When a user pastes a Datadog `datadog_synthetics_test` (Terraform or JSON), convert it to one Better Stack monitor:

- **One simple assertion → a basic type.** Status-code only → `expected_status_code` (or `status` for 2xx). Body-contains only → `keyword`.
- **Multiple assertions or a browser test → `playwright`.** Datadog API tests usually assert several things at once (statusCode + body + responseTime), which a basic monitor can't express — generate a Playwright script that makes the request and `expect`s each assertion. Build the request from `request_definition` (method + url) and one `expect` per `assertion` block (`statusCode`, `body`, `responseTime`, …).
- **Map the fields:** `name` → name / scenario name · `request_definition` → into the script · `options_list.tick_every` → `check_frequency` (round to a valid value) · `locations` → `regions` (Datadog has many; pick the closest subset of `us`/`eu`/`as`/`au`). Datadog's `message`, `monitor_options`, `retry`, and `min_location_failed` have no direct equivalent — say they aren't carried over rather than inventing fields.
- Show the user the script and settings before creating anything; a Playwright scenario goes in through the UI (above).

## Escalation policies

- To route alerts through a specific policy, pass `policy_id` — but **call `escalation_policies` first** to get a valid ID. Never guess an ID: a wrong one is rejected or belongs to another team.
- **Omit `policy_id` to use the team's default policy.**
- **Gotcha: when `policy_id` is set, the simple `email`/`sms`/`call`/`push` flags are ignored** — the policy decides who is notified. Only use those flags when you are _not_ setting a policy.
- Use `escalation_policy` to read a policy's escalation steps (who is notified, in what order, with repeats) before recommending one.
- A step notifies a Slack channel through a `slack_integration` step member, whose id is a Slack integration ID from `slack_integrations`. Policy steps are changed in the Better Stack UI; what the channel does with the alert (a thread or a channel per incident, who Slack users can page) is the Slack integration's, which `edit_slack_integration` changes.

## Linking in chat

Link a monitor or policy with the Better Stack URL from the tool result rather than a bare ID.
