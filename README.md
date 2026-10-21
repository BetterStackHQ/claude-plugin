# Better Stack plugin for Claude Code

Connect Claude Code to your [Better Stack](https://betterstack.com) Incidents and Telemetry data through the Model Context Protocol (MCP). Your agent can investigate incidents, check who is on call, manage uptime monitors, query logs, metrics, traces, errors and real user monitoring (RUM), and build dashboards, all in natural language.

## Install

Better Stack is in Anthropic's plugin directory, which Claude Code has built in:

```text
/plugin install better-stack
```

Or install it from this repository's marketplace:

```text
/plugin marketplace add BetterStackHQ/claude-plugin
/plugin install betterstack@betterstack
```

Or add the MCP server using the CLI:

```bash
claude mcp add --transport http betterstack https://mcp.betterstack.com
```

Add `--scope user` to make it available across all your projects.

Alternatively, add the Better Stack MCP server to your `.mcp.json` manually:

```json
{
  "mcpServers": {
    "betterstack": {
      "type": "http",
      "url": "https://mcp.betterstack.com"
    }
  }
}
```

Then run `/mcp`, select the Better Stack server and sign in through your browser (OAuth, no token configuration needed). Start a new session if the tools don't show up right away.

## What you can do

Try asking your agent things like:

- *"Show me all monitors that are currently down."*
- *"What's the availability of my website this month?"*
- *"What incidents occurred yesterday?"*
- *"Who's on-call right now?"*
- *"Acknowledge incident #1234 and add a comment about the fix."*
- *"Build an explore query to find HTTP 500 errors in the last hour."*
- *"Create a dashboard showing error rates for my API service."*

## Tools

The plugin exposes the full Better Stack MCP toolset:

- **Incidents** (formerly Uptime): incidents, on-call schedules and escalation, uptime monitors, heartbeats, status pages.
- **Telemetry**: dashboards, charts, alerts, log/metric/error queries, sources and applications.
- **Documentation**: search Better Stack docs from within Claude Code.

The complete tool reference and example prompts live in the [Better Stack MCP integration docs](https://betterstack.com/docs/getting-started/integrations/mcp/).

## Authentication

OAuth is the recommended flow. Run `/mcp`, select the Better Stack server and sign in through your browser. No token configuration needed.

If the tools aren't connected, the plugin's **connect-betterstack** skill tells you how to connect in the app you're using (Claude Code, the Claude apps or Claude Tag) instead of failing quietly. You can also ask it directly: *"Set up Better Stack."*

### Prefer an API token?

Where browser sign-in isn't possible, such as in CI or headless runs, the server also accepts a Better Stack API token. The [API token](https://betterstack.com/docs/getting-started/integrations/mcp/#api-token) section of the MCP docs shows how to set it up.

## Skills

The plugin comes with skills that teach your agent how to work with Better Stack. It loads each one when the task calls for it.

**Investigate**

- **investigate-incident**: investigates an incident or alert end to end. It finds the incident, checks who is on call, pulls the errors, logs, traces, metrics and releases around the start time, and posts a short situation report. It stays read-only unless asked to act.
- **health-check**: a quick health assessment of a server or service (CPU, memory, disk, network, log levels, dependencies) with charts.

**Query**

- **logs-query**, **spans-query**, **metrics-query**, **errors-query**: the SQL dialect for each data type, with the mistakes that make queries fail or return wrong numbers.
- **collector-queries**: proven host, container and service queries for Better Stack Collector sources.

**Dashboards and alerts**

- **dashboard-builder**, **dashboard-layout**: build dashboards that read well, with template variables and a clean grid.
- **chart-generation**, **chart-styling**, **map-hierarchy-charts**: chart types, units and settings.
- **chart-alerts**: threshold, relative and anomaly alerts on charts.
- **uptime-monitors**: monitor types, valid settings and escalation policies.

**Migrate**

- **grafana-import**: recreate Grafana dashboards in Better Stack.

## Use in Claude chat and Cowork

1. Open [**Better Stack** in Customize > Plugins](https://claude.ai/customize/plugins/id/a028f8c7-0c25-4976-b0e1-dc8f728ff108%40anthropic-plugin-directory) and add it.
2. On the plugin's **Connectors** tab, add or connect the Better Stack server (`https://mcp.betterstack.com`) and sign in with your Better Stack account.
3. Start a new chat.

The skills work as soon as the plugin is added, but the Better Stack tools only after step 2. On Team and Enterprise plans, an Owner adds the connector for the organization first, then each member connects with their own account. This follows Anthropic's [plugin feature support](https://claude.com/docs/plugins/platform-support) page.

## Use with Claude Tag (on-call in Slack)

[Claude Tag](https://claude.com/docs/claude-tag/overview) can use Better Stack as an on-call first responder in your incident channels. An admin sets it up once in an Access bundle at [claude.ai/admin-settings/claude-tag](https://claude.ai/admin-settings/claude-tag). Connect a dedicated Better Stack user rather than a personal login, because everyone in the covered channels acts through it.

**Option A, with a Better Stack custom connector your organization already added on claude.ai:**

1. Open the bundle's **Credentials** tab, click **Connect** next to **Custom tool** and choose the **MCP Connector** credential type.
2. Pick Better Stack and sign in once as the dedicated Better Stack user.

**Option B, with an API token:**

1. On the bundle's **Plugins** tab, add this plugin. It points Claude at `https://mcp.betterstack.com` and brings the investigate-incident skill.
2. On the **Credentials** tab, click **Connect** next to **Custom tool**, choose **Bearer**, paste a Better Stack [API token](https://betterstack.com/docs/uptime/api/getting-started-with-uptime-api/) and set **Allowed websites** to `mcp.betterstack.com`.

To check it, start a new thread in a channel the bundle covers and ask *"@Claude list open Better Stack incidents and the errors from the last hour."*

For investigation-only access, limit the tools with the `X-MCP-Tools-Except` header below. On the Bearer credential, set it under **Custom headers**.

## Limiting available tools

Restrict which tools the agent can use with one of these headers:

- `X-MCP-Tools-Only`: allowlist (only the listed tools are available)
- `X-MCP-Tools-Except`: blocklist (all tools except the listed ones)

```json
{
  "mcpServers": {
    "betterstack": {
      "type": "http",
      "url": "https://mcp.betterstack.com",
      "headers": {
        "X-MCP-Tools-Only": "monitors,monitor,incidents,incident"
      }
    }
  }
}
```

## Maintainers

- **One version for all three plugins.** The Claude ([claude-plugin](https://github.com/BetterStackHQ/claude-plugin)), Codex ([codex-plugin](https://github.com/BetterStackHQ/codex-plugin)) and Cursor ([cursor-plugin](https://github.com/BetterStackHQ/cursor-plugin)) plugins always release with the same version number. A change that bumps one plugin's version bumps all three to that same number, in PRs opened together, even when the other two have nothing else to change. The version is set in `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` (Claude), `.codex-plugin/plugin.json` (Codex) and `.cursor-plugin/plugin.json` (Cursor).
- **Skills from AI SRE.** All skills except `investigate-incident` and `connect-betterstack` are built from AI SRE's skills with the sync tool in aisre-proxy, [`tooling/sync-plugin-skills`](https://github.com/BetterStackHQ/aisre-proxy/tree/main/tooling/sync-plugin-skills). Change them there, then sync.
- **Only plugin files in this repository.** The repository is the plugin: everything in it ships to people who install it, and Anthropic's plugin directory scans all of it. Scripts and agent notes here hold new versions for review, so keep them elsewhere.

## License

MIT. See [LICENSE](LICENSE).
