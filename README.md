# Discord Bridge MCP Server

An MCP (Model Context Protocol) server that gives Claude Code native Discord tools. Enables bidirectional communication between your local Claude Code session and remote AI agents (or humans) through Discord.

## What it does

This server exposes 6 Discord tools to Claude Code:

| Tool | Description |
|------|-------------|
| `discord_send` | Send a message to any channel |
| `discord_read` | Read recent messages (with pagination) |
| `discord_reply` | Reply to a specific message |
| `discord_react` | React to a message with emoji |
| `discord_channels` | List all text channels |
| `discord_check_mentions` | Find messages that @mention you |

Uses the Discord REST API directly -- no WebSocket gateway connection needed. Lightweight, stateless, ~250 lines of code.

## Setup

### 1. Create a Discord bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to Bot settings, create a bot, copy the token
4. Enable "Message Content Intent" under Privileged Gateway Intents
5. Invite the bot to your server with `Send Messages` + `Read Message History` permissions

### 2. Install

```bash
npm install
```

### 3. Register with Claude Code

```bash
claude mcp add discord-bridge \
  -e DISCORD_BOT_TOKEN=your-bot-token \
  -e DISCORD_GUILD_ID=your-server-id \
  -e DISCORD_DEFAULT_CHANNEL=general \
  -- node /path/to/index.js
```

### 4. Add the /talk command (optional)

Copy `talk.md` to `~/.claude/commands/talk.md`. Then type `/talk` in Claude Code to check for new messages and respond.

## How it works

```
┌─────────────────┐     stdio      ┌─────────────────┐    REST API    ┌─────────┐
│   Claude Code   │◄──────────────►│  Discord Bridge  │◄─────────────►│ Discord │
│   (local CLI)   │     MCP        │   (MCP Server)   │   HTTPS       │   API   │
└─────────────────┘                └─────────────────┘                └─────────┘
                                                                           │
                                                                     ┌─────┴─────┐
                                                                     │  Discord   │
                                                                     │  Server    │
                                                                     │ (channels) │
                                                                     └─────┬─────┘
                                                                           │
                                                                   ┌───────┴───────┐
                                                                   │ Remote Agents  │
                                                                   │ (or humans)    │
                                                                   └───────────────┘
```

Claude Code communicates with the MCP server over stdio. The MCP server translates tool calls into Discord REST API requests. Remote agents (or humans) see messages in Discord and can respond. Claude Code picks up responses on the next `/talk` invocation.

## Use cases

- **Multi-agent coordination**: Local Claude Code delegates tasks to remote AI agents running on a server
- **Human-in-the-loop**: Team members monitor and participate in agent conversations via Discord
- **Cross-machine communication**: Bridge between your laptop and a remote server running AI agents
- **Async task management**: Post tasks, check on progress, get notified of completions

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_BOT_TOKEN` | Yes | Discord bot token |
| `DISCORD_GUILD_ID` | Yes | Discord server (guild) ID |
| `DISCORD_DEFAULT_CHANNEL` | No | Default channel name (defaults to "general") |

## License

MIT
