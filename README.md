# Better Stack plugin for Claude Code

Connect Claude Code to your [Better Stack](https://betterstack.com) Uptime and Telemetry data through the Model Context Protocol (MCP). Your agent can query logs and metrics, build dashboards, manage uptime monitors, and respond to incidents, all in natural language.

## Install

This repository is also a Claude Code plugin marketplace, so you can add it and install the plugin in two commands:

```text
/plugin marketplace add BetterStackHQ/claude-plugin
/plugin install betterstack@betterstack
```

Or add the MCP server with the CLI:

```bash
claude mcp add --transport http betterstack https://mcp.betterstack.com
```

Add `--scope user` to make it available across all your projects.

Or add it manually to your project `.mcp.json`:

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

OAuth is the recommended flow and works out of the box with Claude Code. If you prefer an API token, you can pass it via the `Authorization` header instead. See [API authentication](https://betterstack.com/docs/uptime/api/getting-started-with-uptime-api/):

```json
{
  "mcpServers": {
    "betterstack": {
      "type": "http",
      "url": "https://mcp.betterstack.com",
      "headers": {
        "Authorization": "Bearer $TOKEN"
      }
    }
  }
}
```

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
        "X-MCP-Tools-Only": "uptime_list_monitors,uptime_get_monitor_tool,uptime_list_incidents"
      }
    }
  }
}
```

## License

MIT. See [LICENSE](LICENSE).
