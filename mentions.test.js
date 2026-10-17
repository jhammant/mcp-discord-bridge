// Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadAliases, namesFromMessages, resolveMentions, hasPlainMention } from './mentions.js';

const HUNTER = '1488504592562917466';
const ECHO = '1469290000000000001';
const SELF = '1469290972545548403';

test('plain @hunter99 becomes a real mention (the 24 Sep miss)', () => {
  // Arrange
  const names = loadAliases({});
  // Act
  const out = resolveMentions('@hunter99 BT-73 is done: https://x/y', names, SELF);
  // Assert
  assert.equal(out, `<@${HUNTER}> BT-73 is done: https://x/y`);
});

test('names learned from recent authors resolve, case-insensitively', () => {
  const names = { ...namesFromMessages([{ author: { id: ECHO, username: 'Echo' } }]), ...loadAliases({}) };
  assert.equal(resolveMentions('ping @echo and @Hunter.', names), `ping <@${ECHO}> and <@${HUNTER}>.`);
});

test('leaves @everyone, e-mail, unknown names, code and existing mentions alone', () => {
  const names = loadAliases({});
  const text = `@everyone mail jon@orbitalhq.com, @nobody, \`@hunter99\` and <@${HUNTER}>`;
  assert.equal(resolveMentions(text, names), text);
});

test('never mentions the sending bot itself', () => {
  const names = { claudecode: SELF };
  assert.equal(resolveMentions('from @ClaudeCode', names, SELF), 'from @ClaudeCode');
});

test('env aliases add names; a malformed override keeps the built-ins', () => {
  assert.equal(loadAliases({ DISCORD_MENTION_ALIASES: `{"boba":"${ECHO}"}` }).boba, ECHO);
  assert.equal(loadAliases({ DISCORD_MENTION_ALIASES: 'not json' }).hunter99, HUNTER);
});

test('hasPlainMention skips the fetch for text without one', () => {
  assert.equal(hasPlainMention('no mention here, jon@x.com'), false);
  assert.equal(hasPlainMention('hi @hunter99'), true);
  assert.equal(hasPlainMention('hi @hunter99'), true); // stable across calls (global regex state)
});
