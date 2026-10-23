---
name: connect-betterstack
description: Connect the Better Stack MCP server and check that it works. Use when the user installs the Better Stack plugin or asks to set it up, when a Better Stack request comes in but no Better Stack tools (such as `incidents`, `monitors`, `query`, `documentation`) are available, or when a Better Stack tool fails with "unauthorized", 401 or "needs authentication". Tells the user exactly how to connect in the app they are using (ChatGPT, Codex, Cursor, Claude Code, Claude chat and Cowork, Claude Tag in Slack).
---

# Connect Better Stack

The Better Stack plugin brings skills, and its tools come from the Better Stack MCP server at `https://mcp.betterstack.com`. The server lists no tools until the user signs in with their Better Stack account (OAuth in the browser, no token needed). Until then the skills can't read any data.

## 1. Check whether Better Stack is connected

Look at the tools you have right now.

- **Connected:** you have Better Stack tools, such as `incidents`, `monitors`, `on_calls`, `sources`, `query` or `documentation`. Their names may carry a prefix (`mcp__plugin_betterstack_betterstack__incidents`, `betterstack.incidents`). Confirm with one cheap read-only call: `incidents` with `status: ["ongoing"]`, or `monitors`. If it returns data (even an empty list), say Better Stack is connected and carry on with what the user asked.
- **Not connected:** no Better Stack tools at all, only an `authenticate` tool for Better Stack, or a call that fails with `unauthorized`, 401, 403 or "needs authentication".

If you have a Better Stack `authenticate` tool (Claude Code exposes one for claude.ai connectors that aren't signed in), call it and give the user the sign-in link it returns. After they sign in, call `complete_authentication` if that tool exists, then check again.

Never make up incidents, monitors, logs or metrics while Better Stack isn't connected. Say it isn't connected and give the steps below.

## 2. Work out where you are running

Use what you know about your environment: your system prompt, your tool names, whether you have a shell, and where the conversation is happening.

| Signs | You are in |
| --- | --- |
| You are ChatGPT, in chatgpt.com or the ChatGPT app, no shell | ChatGPT |
| You are Codex, or you have a shell and `codex` is installed | Codex |
| You are in Cursor, or tool names look like Cursor's | Cursor |
| You are Claude Code, you have a shell, tool names start with `mcp__` | Claude Code |
| You are in a Slack channel or thread (Claude Tag) | Claude Tag |
| You are Claude in claude.ai chat, Cowork, the desktop app or the mobile app, no shell | Claude chat and Cowork |

If you can't tell, ask the user which app they are using, then give that app's steps.

## 3. Tell the user how to connect

Give only the steps for their app, as a short numbered list. Then tell them to start a new chat or session, because most apps load a plugin's tools only when a conversation starts.

### ChatGPT

1. Open **Plugins** in the sidebar and open **Better Stack**.
2. If it isn't installed yet, select the plus button to install it.
3. Connect Better Stack when ChatGPT asks, and sign in with your Better Stack account in the window that opens.
4. Start a new chat and ask again, for example "Who's on call right now?"

In a ChatGPT workspace (Business, Enterprise, Edu), an admin may have to allow the Better Stack plugin first.

### Codex

The CLI and the ChatGPT desktop app share the same setup. If you have a shell, you can run the checks yourself.

1. Check the server is configured: `codex mcp list` should list `betterstack` with the URL `https://mcp.betterstack.com`. If it's missing, install the plugin (`codex plugin marketplace add BetterStackHQ/codex-plugin`, then `codex plugin add betterstack@betterstack`) or add the server: `codex mcp add betterstack --url https://mcp.betterstack.com`.
2. Sign in: the user runs `codex mcp login betterstack` in a terminal and completes the sign-in in the browser. Don't run it yourself unless the user can see the browser it opens.
3. Start a new Codex session so the tools load.

### Cursor

1. Install the plugin from the Cursor Marketplace, or use the link in the [Cursor plugin README](https://github.com/BetterStackHQ/cursor-plugin#install).
2. Open **Customize** in the sidebar, find **betterstack** under MCP and make sure it's turned on.
3. Sign in when Cursor asks (it opens the browser for Better Stack's sign-in). If it doesn't ask, turn the server off and on again.
4. Start a new chat.

### Claude Code

1. Run `/mcp`, select the Better Stack server (from the plugin it shows as `plugin:betterstack:betterstack`) and follow the steps to sign in in the browser. From a terminal: `claude mcp login plugin:betterstack:betterstack`, or `claude mcp login betterstack` if the server was added by hand. `claude mcp list` shows the exact name.
2. If the server isn't listed, install the plugin from Anthropic's plugin directory, which Claude Code has built in: `/plugin install better-stack`. Or add the server: `claude mcp add --transport http betterstack https://mcp.betterstack.com`.
3. Start a new session, or run `/mcp` again to check it shows as connected.

In a Claude Code cloud session, connect Better Stack at [claude.ai/customize/connectors](https://claude.ai/customize/connectors) instead.

### Claude chat and Cowork (claude.ai, the desktop app, mobile)

The plugin's skills load in chat right away, but its MCP server works only after it's connected on the plugin's **Connectors** tab:

1. Open [**Better Stack** in Customize > Plugins](https://claude.ai/customize/plugins/id/a028f8c7-0c25-4976-b0e1-dc8f728ff108%40anthropic-plugin-directory) and add it, or open it if it's already added.
2. On its **Connectors** tab, add or connect the Better Stack server (`https://mcp.betterstack.com`) and sign in with your Better Stack account.
3. Start a new chat.

On Team and Enterprise plans, an Owner adds the connector for the organization first, then each member connects with their own account. If Better Stack was added as a connector without the plugin, connect it at [claude.ai/customize/connectors](https://claude.ai/customize/connectors) instead.

### Claude Tag (Claude in Slack)

People in the channel can't connect it from the thread. A Claude Tag admin sets it up once in an Access bundle at [claude.ai/admin-settings/claude-tag](https://claude.ai/admin-settings/claude-tag), with a dedicated Better Stack user rather than a personal login, because everyone in the covered channels acts through it:

1. On the bundle's **Plugins** tab, add the Better Stack plugin.
2. On the **Credentials** tab, click **Connect** next to **Custom tool**. Choose **MCP Connector**, pick Better Stack and sign in as the dedicated user.
3. Start a new thread in a covered channel and ask "@Claude list open Better Stack incidents".

Tell the person who asked to forward these steps to their Claude Tag admin.

## 4. After connecting

Once the tools show up, confirm with one read-only call, tell the user it works, and go back to what they originally asked. Setup and full docs: [Better Stack MCP](https://betterstack.com/docs/getting-started/integrations/mcp/).
