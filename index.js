#!/usr/bin/env node
/**
 * Discord Bridge MCP Server
 *
 * Gives Claude Code native Discord tools for bidirectional communication
 * with remote AI agents (or humans). Uses Discord REST API directly
 * (no WebSocket/gateway connection needed).
 *
 * Setup:
 *   DISCORD_BOT_TOKEN  - Your Discord bot token
 *   DISCORD_GUILD_ID   - Your Discord server ID
 *   DISCORD_DEFAULT_CHANNEL - Default channel name (optional, defaults to "general")
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { loadAliases, namesFromMessages, resolveMentions, hasPlainMention } from './mentions.js';

const DISCORD_API = 'https://discord.com/api/v10';
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const DEFAULT_CHANNEL = process.env.DISCORD_DEFAULT_CHANNEL || 'general';

if (!BOT_TOKEN) {
  console.error('DISCORD_BOT_TOKEN environment variable is required');
  process.exit(1);
}

if (!GUILD_ID) {
  console.error('DISCORD_GUILD_ID environment variable is required');
  process.exit(1);
}

const MENTION_ALIASES = loadAliases();

// Channel name -> ID cache
let channelCache = null;
let botUserId = null;

async function discordFetch(endpoint, options = {}) {
  const url = `${DISCORD_API}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bot ${BOT_TOKEN}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Discord API error ${res.status}: ${body}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

async function getChannels() {
  if (channelCache) return channelCache;
  const channels = await discordFetch(`/guilds/${GUILD_ID}/channels`);
  channelCache = channels.filter(c => c.type === 0); // text channels only
  return channelCache;
}

async function resolveChannel(nameOrId) {
  if (/^\d{17,20}$/.test(nameOrId)) return nameOrId;
  const name = nameOrId.replace(/^#/, '');
  const channels = await getChannels();
  const match = channels.find(c => c.name === name);
  if (!match) {
    throw new Error(`Channel not found: "${name}". Available: ${channels.map(c => c.name).join(', ')}`);
  }
  return match.id;
}

async function getBotUserId() {
  if (botUserId) return botUserId;
  const me = await discordFetch('/users/@me');
  botUserId = me.id;
  return botUserId;
}

// Plain "@name" -> real "<@id>" mention (see mentions.js). Never blocks a send: on any lookup
// failure the built-in aliases alone apply.
async function withMentions(message, channelId) {
  if (!hasPlainMention(message)) return message;
  let names = { ...MENTION_ALIASES };
  try {
    const recent = await discordFetch(`/channels/${channelId}/messages?limit=50`);
    names = { ...namesFromMessages(recent), ...MENTION_ALIASES };
  } catch {
    // keep the aliases
  }
  let selfId = null;
  try { selfId = await getBotUserId(); } catch { /* no self filter */ }
  return resolveMentions(message, names, selfId);
}

function formatMessage(msg) {
  const timestamp = new Date(msg.timestamp).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const author = msg.author.bot ? `[BOT] ${msg.author.username}` : msg.author.username;
  const replyInfo = msg.referenced_message
    ? ` (replying to ${msg.referenced_message.author.username})`
    : '';
  return `[${timestamp}] ${author}${replyInfo}: ${msg.content}`;
}

class DiscordBridgeMCP {
  constructor() {
    this.server = new Server(
      { name: 'discord-bridge', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );
    this.setupHandlers();
  }

  setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'discord_send',
          description: 'Send a message to a Discord channel.',
          inputSchema: {
            type: 'object',
            properties: {
              message: { type: 'string', description: 'Message content to send' },
              channel: { type: 'string', description: 'Channel name (e.g. "general") or ID. Uses default channel if omitted.' },
            },
            required: ['message'],
          },
        },
        {
          name: 'discord_read',
          description: 'Read recent messages from a Discord channel.',
          inputSchema: {
            type: 'object',
            properties: {
              channel: { type: 'string', description: 'Channel name or ID. Uses default channel if omitted.' },
              limit: { type: 'number', description: 'Number of messages to fetch (default: 20, max: 100)' },
              before: { type: 'string', description: 'Fetch messages before this message ID (for pagination)' },
              after: { type: 'string', description: 'Fetch messages after this message ID' },
            },
          },
        },
        {
          name: 'discord_reply',
          description: 'Reply to a specific Discord message.',
          inputSchema: {
            type: 'object',
            properties: {
              message_id: { type: 'string', description: 'ID of the message to reply to' },
              channel: { type: 'string', description: 'Channel name or ID where the message is' },
              message: { type: 'string', description: 'Reply content' },
            },
            required: ['message_id', 'channel', 'message'],
          },
        },
        {
          name: 'discord_react',
          description: 'Add a reaction emoji to a Discord message.',
          inputSchema: {
            type: 'object',
            properties: {
              message_id: { type: 'string', description: 'ID of the message to react to' },
              channel: { type: 'string', description: 'Channel name or ID' },
              emoji: { type: 'string', description: 'Emoji to react with (e.g. "thumbsup", "check", or a unicode emoji)' },
            },
            required: ['message_id', 'channel', 'emoji'],
          },
        },
        {
          name: 'discord_channels',
          description: 'List all text channels in the Discord server.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'discord_check_mentions',
          description: 'Check for recent messages that mention the bot.',
          inputSchema: {
            type: 'object',
            properties: {
              channel: { type: 'string', description: 'Channel to check. If omitted, checks all channels.' },
              limit: { type: 'number', description: 'Number of recent messages to scan per channel (default: 50)' },
            },
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'discord_send':
            return await this.handleSend(args);
          case 'discord_read':
            return await this.handleRead(args);
          case 'discord_reply':
            return await this.handleReply(args);
          case 'discord_react':
            return await this.handleReact(args);
          case 'discord_channels':
            return await this.handleChannels();
          case 'discord_check_mentions':
            return await this.handleCheckMentions(args);
          default:
            return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
        }
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    });
  }

  async handleSend({ message, channel }) {
    const channelId = await resolveChannel(channel || DEFAULT_CHANNEL);
    const content = await withMentions(message, channelId);
    const result = await discordFetch(`/channels/${channelId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });

    return {
      content: [{
        type: 'text',
        text: `Message sent to #${channel || DEFAULT_CHANNEL} (ID: ${result.id})`,
      }],
    };
  }

  async handleRead({ channel, limit = 20, before, after } = {}) {
    const channelId = await resolveChannel(channel || DEFAULT_CHANNEL);
    const clampedLimit = Math.min(Math.max(limit, 1), 100);

    const params = new URLSearchParams({ limit: clampedLimit.toString() });
    if (before) params.set('before', before);
    if (after) params.set('after', after);

    const messages = await discordFetch(`/channels/${channelId}/messages?${params}`);

    if (!messages.length) {
      return { content: [{ type: 'text', text: 'No messages found.' }] };
    }

    const formatted = messages.reverse().map(formatMessage).join('\n');

    return {
      content: [{
        type: 'text',
        text: `Last ${messages.length} messages from #${channel || DEFAULT_CHANNEL}:\n\n${formatted}`,
      }],
    };
  }

  async handleReply({ message_id, channel, message }) {
    const channelId = await resolveChannel(channel);
    const content = await withMentions(message, channelId);
    const result = await discordFetch(`/channels/${channelId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        content,
        message_reference: { message_id },
      }),
    });

    return {
      content: [{
        type: 'text',
        text: `Reply sent (ID: ${result.id})`,
      }],
    };
  }

  async handleReact({ message_id, channel, emoji }) {
    const channelId = await resolveChannel(channel);

    const emojiMap = {
      thumbsup: '%F0%9F%91%8D',
      thumbsdown: '%F0%9F%91%8E',
      check: '%E2%9C%85',
      x: '%E2%9D%8C',
      eyes: '%F0%9F%91%80',
      rocket: '%F0%9F%9A%80',
      heart: '%E2%9D%A4%EF%B8%8F',
      fire: '%F0%9F%94%A5',
      wave: '%F0%9F%91%8B',
      thinking: '%F0%9F%A4%94',
    };

    const encoded = emojiMap[emoji] || encodeURIComponent(emoji);

    await discordFetch(`/channels/${channelId}/messages/${message_id}/reactions/${encoded}/@me`, {
      method: 'PUT',
    });

    return {
      content: [{ type: 'text', text: `Reacted with ${emoji}` }],
    };
  }

  async handleChannels() {
    channelCache = null;
    const channels = await getChannels();

    const formatted = channels
      .sort((a, b) => a.position - b.position)
      .map(c => `#${c.name} (ID: ${c.id})${c.topic ? ` - ${c.topic}` : ''}`)
      .join('\n');

    return {
      content: [{
        type: 'text',
        text: `Channels in server:\n\n${formatted}`,
      }],
    };
  }

  async handleCheckMentions({ channel, limit = 50 } = {}) {
    const myId = await getBotUserId();

    let channelsToCheck;
    if (channel) {
      const channelId = await resolveChannel(channel);
      channelsToCheck = [{ id: channelId, name: channel }];
    } else {
      const allChannels = await getChannels();
      channelsToCheck = allChannels.map(c => ({ id: c.id, name: c.name }));
    }

    const clampedLimit = Math.min(Math.max(limit, 1), 100);
    const mentions = [];

    for (const ch of channelsToCheck) {
      try {
        const messages = await discordFetch(
          `/channels/${ch.id}/messages?limit=${clampedLimit}`
        );

        for (const msg of messages) {
          const mentionsMe = msg.mentions?.some(u => u.id === myId)
            || msg.content?.includes(`<@${myId}>`)
            || msg.content?.includes(`<@!${myId}>`);

          if (mentionsMe) {
            mentions.push({
              channel: ch.name,
              ...msg,
            });
          }
        }
      } catch {
        // Skip channels we can't read
      }
    }

    if (!mentions.length) {
      return { content: [{ type: 'text', text: 'No recent mentions found.' }] };
    }

    const formatted = mentions
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
      .map(m => `[#${m.channel}] ${formatMessage(m)}`)
      .join('\n');

    return {
      content: [{
        type: 'text',
        text: `Found ${mentions.length} mention(s):\n\n${formatted}`,
      }],
    };
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Discord Bridge MCP server running');
  }
}

const server = new DiscordBridgeMCP();
server.run().catch(console.error);
