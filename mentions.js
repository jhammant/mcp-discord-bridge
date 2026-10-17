/**
 * Turn plain-text "@name" into a real Discord mention "<@id>".
 *
 * Why: Discord only notifies (and bots with require-mention only see) a message that carries a
 * real <@id> mention. Agents writing "@hunter99" as plain text were silently ignored by Hunter's
 * gateway on 24 Sep 2026 (the Big Data LDN deck URL never reached Jon). Resolving here fixes every
 * Claude Code sender at once.
 *
 * Names resolve from, in order: DISCORD_MENTION_ALIASES (JSON {"name": "id"}), the built-in
 * aliases below, then the authors of recent messages in the target channel (username and display
 * name). Unknown names, @everyone/@here, e-mail addresses and anything inside backticks are left
 * untouched.
 */

// Hunter (Jon's Hermes, Discord user hunter99). Not a secret: it is a public Discord user id.
const BUILTIN_ALIASES = {
  hunter99: '1488504592562917466',
  hunter: '1488504592562917466',
};

const NEVER = new Set(['everyone', 'here']);

export function loadAliases(env = process.env) {
  const aliases = { ...BUILTIN_ALIASES };
  if (env.DISCORD_MENTION_ALIASES) {
    try {
      for (const [name, id] of Object.entries(JSON.parse(env.DISCORD_MENTION_ALIASES))) {
        if (/^\d{17,20}$/.test(String(id))) aliases[name.toLowerCase()] = String(id);
      }
    } catch {
      // A malformed override must not break sending; the built-ins still apply.
    }
  }
  return aliases;
}

/** Map lower-cased username and display name -> user id, from Discord message objects. */
export function namesFromMessages(messages = []) {
  const names = {};
  for (const msg of messages) {
    const people = [msg.author, ...(msg.mentions || [])].filter(Boolean);
    for (const u of people) {
      if (!u.id) continue;
      for (const n of [u.username, u.global_name]) {
        if (n && /^[A-Za-z0-9_.]{2,32}$/.test(n) && !(n.toLowerCase() in names)) {
          names[n.toLowerCase()] = u.id;
        }
      }
    }
  }
  return names;
}

// "@name" at the start or after whitespace/opening punctuation; stops before trailing punctuation.
const MENTION_RE = /(^|[\s([{"'>*_~])@([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)/g;

/**
 * Replace resolvable plain "@name" tokens with "<@id>". `names` maps lower-cased name -> id.
 * `selfId` (the sending bot) is never mentioned.
 */
export function resolveMentions(content, names, selfId = null) {
  if (typeof content !== 'string' || !content.includes('@')) return content;
  // Split on code spans/blocks; odd indexes are code and stay as written.
  const parts = content.split(/(```[\s\S]*?```|`[^`\n]*`)/);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      return part.replace(MENTION_RE, (whole, lead, name) => {
        const key = name.toLowerCase();
        if (NEVER.has(key)) return whole;
        const id = names[key];
        if (!id || id === selfId) return whole;
        return `${lead}<@${id}>`;
      });
    })
    .join('');
}

/** True when the text has a plain "@name" worth resolving (so the caller can skip a fetch). */
export function hasPlainMention(content) {
  if (typeof content !== 'string') return false;
  MENTION_RE.lastIndex = 0;
  const found = MENTION_RE.test(content);
  MENTION_RE.lastIndex = 0;
  return found;
}
