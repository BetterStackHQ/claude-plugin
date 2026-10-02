# Better Stack plugin for Claude Code

Connect Claude Code to your [Better Stack](https://betterstack.com) Uptime and Telemetry data through the Model Context Protocol (MCP). Your agent can query logs and metrics, build dashboards, manage uptime monitors, and respond to incidents, all in natural language.

## Install

Install plugin from Claude Code marketplace:

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

The first tool call opens a browser for OAuth sign-in. No token configuration needed.

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

- **Uptime**: monitors, incidents, on-call schedules and escalation, heartbeats, status pages.
- **Telemetry**: dashboards, charts, alerts, log/metric/error queries, sources and applications.
- **Documentation**: search Better Stack docs from within Claude Code.

The complete tool reference and example prompts live in the [Better Stack MCP integration docs](https://betterstack.com/docs/getting-started/integrations/mcp/).

## Authentication

OAuth is the recommended flow and works out of the box with Claude Code.
The first tool call opens a browser for OAuth sign-in. No token configuration needed.

### Prefer API token over OAuth? 

Get a Better Stack [API token](https://betterstack.com/docs/uptime/api/getting-started-with-uptime-api/).
Then pass it via the `Authorization` header:

```json
{
  "mcpServers": {
    "betterstack": {
      "type": "http",
      "url": "https://mcp.betterstack.com",
      "headers": {
        "Authorization": "Bearer <your-better-stack-api-token>"
      }
    }
  }
}
```

## Skills

- **investigate-incident**: investigates an incident or alert end to end. It finds the incident, checks who is on call, pulls the errors, logs, traces, metrics and releases around the start time, and posts a short situation report. It stays read-only unless asked to act.

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

## License

MIT. See [LICENSE](LICENSE).
