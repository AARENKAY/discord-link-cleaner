const express = require('express');
const { Client, GatewayIntentBits, ActivityType } = require('discord.js');

// ---------- CLIENT FIRST ----------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- HEALTH ENDPOINT ----------
app.get('/health', (req, res) =>
  res.json({
    status: 'ok',
    bot: client.user?.tag || 'Starting...',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    ready: client.isReady(),
    timestamp: new Date().toISOString()
  })
);
app.get('/', (req, res) => res.send('Discord Link Cleaner Bot - Health: /health'));
app.listen(PORT, '0.0.0.0', () => console.log(`🌐 Health server on port ${PORT}`));

// ---------- CONFIG ----------
// Map channels to their associated subreddits (inverted from previous SUBREDDIT_CHANNEL_MAP)
const CHANNEL_SUBREDDIT_MAP = {
  '1466301671301714012': [
    'realscatgirls',
    'poopingvixens',
    'dirtygirls2',
    'scatgifs',
    'scatporn2'
  ],
  '1471015400790822922': [
    'scat34'
  ],
  '1535261507410206832': [
    'girlsmasturbating',
    'fingerherass'
  ]
};

// Build reverse lookup for O(1) redirection (normalize subreddit names, using null-prototype object)
const SUBREDDIT_CHANNEL_LOOKUP = Object.create(null);
for (const [channelId, subs] of Object.entries(CHANNEL_SUBREDDIT_MAP)) {
  for (const sub of subs) {
    SUBREDDIT_CHANNEL_LOOKUP[sub.toLowerCase()] = channelId;
  }
}

const TARGET_BOT_IDS = ['1531274702067073157'];
const ALLOWED_EXTS = ['.mp4', '.gif', '.gifv', '.webm', '.jpg', '.jpeg', '.png', '.webp'];
const LOG_CHANNEL_ID = '1530804280720887918';
const MAX_URLS_PER_MESSAGE = 100;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_CACHE_SIZE = 5000;
const MAX_TITLE_LENGTH = 200;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- LOGGER WITH RECURSION GUARD AND CIRCULAR SAFETY ----------
let isLogging = false;
let logChannelCache = null;

const getLogChannel = async () => {
  try {
    if (!logChannelCache || !logChannelCache.isTextBased()) {
      logChannelCache = await client.channels.fetch(LOG_CHANNEL_ID);
    }
    return logChannelCache;
  } catch (e) {
    logChannelCache = null;
    throw e;
  }
};

const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

const suppressEmbeds = text => {
  if (!text) return text;
  return text.replace(/https?:\/\/[^\s<>"]+/gi, '<$&>');
};

const safeStringify = (a) => {
  if (typeof a !== 'object' || a === null) return String(a);
  try {
    const str = JSON.stringify(a, (_, value) =>
      typeof value === 'bigint' ? value.toString() : value,
      2
    );
    return str.length > 1000 ? str.slice(0, 1000) + '…' : str;
  } catch {
    return '[Circular Object]';
  }
};

const logAndSend = async (message, level = 'log') => {
  const ts = new Date().toISOString();
  originalLog(`[${ts}] ${message}`);

  // Avoid logging before client is ready
  if (!client.isReady()) return;
  if (isLogging) return;
  isLogging = true;

  try {
    const channel = await getLogChannel();
    if (!channel) return;
    let msg = `\`[${ts}]\` ${suppressEmbeds(message)}`;
    if (msg.length > 1900) msg = msg.slice(0, 1900) + '...';
    await channel.send(msg);
  } catch (e) {
    originalError('Failed to send log to Discord:', e.message);
  } finally {
    isLogging = false;
  }
};

console.log = (...args) => {
  const msg = args.map(safeStringify).join(' ');
  void logAndSend(msg);
};
console.error = (...args) => {
  const msg = args.map(safeStringify).join(' ');
  void logAndSend(`❌ ${msg}`, 'error');
};
console.warn = (...args) => {
  const msg = args.map(safeStringify).join(' ');
  void logAndSend(`⚠️ ${msg}`);
};

// ---------- HELPERS ----------
const cleanUrl = url => {
  if (!url) return url;
  // Case‑insensitive redgifs normalisation
  let c = url.replace(/www\.redgifs\.com/i, 'redgifs.com');
  // Convert preview.redd.it to i.redd.it (host‑based regex)
  if (/^https?:\/\/preview\.redd\.it/i.test(c)) {
    const m = c.match(/preview\.redd\.it\/([^?]+)/);
    if (m) c = `https://i.redd.it/${m[1].split('?')[0]}`;
  }
  // Remove query, trailing punctuation, and trailing slashes
  c = c.split('?')[0];
  c = c.replace(/[)>.,!?]+$/, '');
  c = c.replace(/\/+$/, '');
  return c;
};

// Host‑based regex helpers
const isRedgifs = url => /^https?:\/\/(?:www\.)?redgifs\.com\b/i.test(url);
const isRedditNative = url => /^https?:\/\/(?:i|v)\.redd\.it\b/i.test(url);
const isVideoUrl = url =>
  isRedgifs(url) ||
  /^https?:\/\/v\.redd\.it\b/i.test(url) ||
  /\.(mp4|webm|gifv|gif)$/i.test(url);

// formatMessage with newline‑aware chunking, link limit, and permission check
const formatMessage = async (ch, title, sub, author, urls) => {
  // Cap the number of links to avoid Discord rejection
  if (urls.length > MAX_URLS_PER_MESSAGE) {
    console.warn(`Truncated ${urls.length} URLs to ${MAX_URLS_PER_MESSAGE}`);
    urls = urls.slice(0, MAX_URLS_PER_MESSAGE);
  }

  // Limit title length to avoid overly large headers
  const safeTitle = title.length > MAX_TITLE_LENGTH
    ? title.slice(0, MAX_TITLE_LENGTH) + '…'
    : title;

  let header = `## ${safeTitle}\n\n*Posted in* **r/${sub}** *by* **${author}**\n\n`;
  let output = '';
  for (const u of urls) {
    const label = isVideoUrl(u) ? 'Video/Gif' : 'Pic';
    // Escape parentheses and backslashes to prevent broken Markdown links
    const markdownUrl = u.replace(/\\/g, '\\\\').replace(/\)/g, '\\)');
    output += `[${label}](${markdownUrl})\n\n`;
  }
  const fullMessage = header + output;

  // Split by newline boundaries, each chunk ≤ 1900 characters
  const lines = fullMessage.split('\n');
  const chunks = [];
  let current = '';
  for (const line of lines) {
    if ((current + line).length > 1900 && current) {
      chunks.push(current);
      current = '';
    }
    current += line + '\n';
  }
  if (current) chunks.push(current);

  // Guard against empty messages
  if (!chunks.length) return false;

  // Check send permissions: SendMessages is mandatory, EmbedLinks is optional
  const permissions = ch.permissionsFor(client.user);
  if (!permissions?.has('SendMessages')) {
    console.error(`❌ Missing SendMessages permission in ${ch.id}`);
    return false;
  }
  // EmbedLinks is not a blocker; Discord just won't show previews.

  // Send each chunk with individual error handling to avoid cascading failures
  let sentSomething = false;
  for (const chunk of chunks) {
    try {
      await ch.send(chunk);
      sentSomething = true;
    } catch (e) {
      console.error(`Failed sending message chunk: ${e.message}`);
    }
  }
  // Separator only if at least one chunk was sent
  if (sentSomething) {
    try {
      await ch.send('═════════════════════════════════');
    } catch (e) {
      console.error(`Failed sending separator: ${e.message}`);
    }
  }
  return sentSomething;
};

// ---------- PARSER ----------
const parseRedditInfo = content => {
  // Stricter subreddit extraction: requires the link format **r/sub](<<...>>)
  const subMatch = content.match(/\*\*r\/(?:\[([^\]]+)\]|([\w_]+))\]\(/i);
  let sub = subMatch ? (subMatch[1] || subMatch[2]) : 'unknown';
  sub = sub.toLowerCase(); // Normalize to lowercase for consistent display and lookup

  // Lazy capture of the title text up to the redd.it post link (handles nested brackets safely)
  const titleMatch = content.match(/:\s*\[(.*?)\]\(<<https?:\/\/redd\.it\/[^>]+>>\)/i);
  const title = titleMatch ? titleMatch[1].trim() : 'Reddit Post';

  // Allows underscores and hyphens in usernames
  const authorMatch = content.match(/\*by\s+([\w_-]+)\*/i);
  const author = authorMatch ? authorMatch[1] : 'unknown';

  return { title, subreddit: sub, author };
};

// sendLog with caching for the log channel; uses originalError to avoid recursion
const sendLog = async (channelId, msg) => {
  try {
    const channel = channelId === LOG_CHANNEL_ID
      ? await getLogChannel()
      : await client.channels.fetch(channelId);
    if (channel) {
      let output = suppressEmbeds(msg);
      if (output.length > 1900) output = output.slice(0, 1900) + '...';
      await channel.send(output);
    }
  } catch (e) {
    originalError('Log channel error:', e.message);
  }
};

// ---------- DUPLICATE MESSAGE CACHE (timestamp-based) ----------
const processedMessages = new Map();

const cleanupCache = () => {
  const now = Date.now();
  for (const [id, timestamp] of processedMessages) {
    if (now - timestamp > CACHE_TTL_MS) {
      processedMessages.delete(id);
    }
  }
  // If still too large, remove oldest entries (preserve insertion order)
  while (processedMessages.size > MAX_CACHE_SIZE) {
    const first = processedMessages.keys().next().value;
    processedMessages.delete(first);
  }
};

const cacheCleanupTimer = setInterval(cleanupCache, CACHE_TTL_MS);
cacheCleanupTimer.unref();

// ---------- CACHE FOR REDIRECT CHANNELS ----------
const redirectChannelCache = new Map();

// ---------- BOT EVENTS ----------
client.once('clientReady', () => {
  console.log(`✅ Bot online as ${client.user.tag}`);
  client.user.setPresence({
    activities: [{ name: 'Cleaning links...', type: ActivityType.Watching }],
    status: 'online'
  });
});

client.on('messageCreate', async msg => {
  // Ignore bot's own messages and non-target bots
  if (!client.user || msg.author.id === client.user.id || !TARGET_BOT_IDS.includes(msg.author.id)) return;
  // Ignore DMs and non-text channels
  if (!msg.guild || !msg.channel.isTextBased()) return;

  // Duplicate cache check
  if (processedMessages.has(msg.id)) return;
  processedMessages.set(msg.id, Date.now());

  const channelName = msg.channel.name ?? msg.channel.id;
  console.log(`\n📩 New message from ${msg.author.tag} in #${channelName}`);
  console.log(`📝 Full content:\n${msg.content}`);

  await sendLog(
    LOG_CHANNEL_ID,
    `🔍 Processing message from **${msg.author.tag}** in <#${msg.channel.id}>\n📝 **Content:**\n${msg.content.slice(0, 500)}${msg.content.length > 500 ? '...' : ''}`
  );

  // More selective URL regex to avoid capturing trailing punctuation/markdown
  const urls = msg.content.match(/https?:\/\/[^\s<>")\]]+/gi);
  if (!urls) {
    console.log(`ℹ️ No URLs found in message`);
    return;
  }
  console.log(`🔗 Found ${urls.length} raw URLs:`, urls);

  const redditInfo = parseRedditInfo(msg.content);
  console.log(`ℹ️ Reddit info - Title: "${redditInfo.title}", Sub: ${redditInfo.subreddit}, Author: ${redditInfo.author}`);

  // Check permission to delete the original message
  const canDelete = msg.channel.permissionsFor(client.user)?.has('ManageMessages');
  if (!canDelete) {
    console.error(`❌ Missing ManageMessages permission in ${msg.channel.id}, cannot delete`);
    return;
  }

  let allowed = [],
    blocked = [],
    seen = new Set();

  // Classify URLs using host‑based and extension checks
  console.log(`🔍 Classifying URLs...`);
  for (const u of urls) {
    const clean = cleanUrl(u);
    if (seen.has(clean)) {
      console.log(`   🔁 Duplicate (skipped): ${clean}`);
      continue;
    }

    const low = clean.toLowerCase();
    const isRedgifsMatch = isRedgifs(clean);
    const isRedditNativeMatch = isRedditNative(clean);
    const hasAllowedExt = ALLOWED_EXTS.some(ext => low.endsWith(ext));

    if (isRedgifsMatch || isRedditNativeMatch || hasAllowedExt) {
      allowed.push(clean);
      seen.add(clean);
      console.log(`   ✅ Allowed: ${clean}`);
      if (isRedgifsMatch) console.log(`     ↳ (Redgifs)`);
    } else {
      blocked.push(clean);
      console.log(`   ❌ Blocked: ${clean}`);
    }
  }

  let allAllowed = [...allowed];

  // Prioritize Reddit native media, but keep Redgifs as well
  const hasRedditNative = allAllowed.some(url => isRedditNative(url));
  if (hasRedditNative) {
    console.log(`🎯 Reddit native media detected, filtering out other external (keeping Redgifs)...`);
    allAllowed = allAllowed.filter(url =>
      isRedditNative(url) || isRedgifs(url)
    );
    console.log(`   ↳ Remaining URLs:`, allAllowed);
  }

  console.log(`📊 Final allowed URLs (${allAllowed.length}):`, allAllowed);
  console.log(`🚫 Blocked URLs (${blocked.length}):`, blocked);

  await sendLog(
    LOG_CHANNEL_ID,
    `🔎 **Analysis:**\n• From: **${msg.author.tag}**\n• Title: ${redditInfo.title}\n• Subreddit: r/${redditInfo.subreddit}\n• URLs: ${urls.length} total, ${allAllowed.length} allowed, ${blocked.length} blocked`
  );

  if (allAllowed.length === 0 && blocked.length) {
    console.log(`🗑️ No allowed URLs, deleting original message`);
    try {
      await msg.delete();
    } catch (e) {
      console.error(`Failed to delete message: ${e.message}`);
    }
    return;
  }

  if (allAllowed.length) {
    try {
      console.log(`🗑️ Deleting original message...`);
      try {
        await msg.delete();
        console.log(`✅ Original message deleted`);
      } catch (e) {
        console.error(`Delete failed: ${e.message}`);
        // If we cannot delete, we should not repost to avoid duplication
        return;
      }

      // ---------- REDIRECTION LOGIC (O(1) reverse lookup, with channel cache) ----------
      let targetChannel = msg.channel;
      const subForRedirect = redditInfo.subreddit.toLowerCase();
      const channelId = SUBREDDIT_CHANNEL_LOOKUP[subForRedirect];

      if (channelId) {
        try {
          // Use cached channel if available
          if (!redirectChannelCache.has(channelId)) {
            const fetched = await client.channels.fetch(channelId);
            if (fetched && fetched.isTextBased()) {
              redirectChannelCache.set(channelId, fetched);
            } else {
              console.error(`❌ Invalid target channel ${channelId}, falling back to original`);
            }
          }
          const cached = redirectChannelCache.get(channelId);
          if (cached) {
            targetChannel = cached;
            console.log(`🔄 Redirecting to channel #${targetChannel.name} (${channelId}) for subreddit r/${subForRedirect}`);
            await sendLog(LOG_CHANNEL_ID, `🔄 Redirected to <#${channelId}> because of subreddit r/${subForRedirect}`);
          }
        } catch (e) {
          console.error(`❌ Error fetching redirect channel: ${e.message}, falling back to original`);
          // Remove from cache if fetch failed
          redirectChannelCache.delete(channelId);
        }
      }

      console.log(`📤 Sending cleaned message to ${targetChannel.id}...`);
      const sent = await formatMessage(
        targetChannel,
        redditInfo.title,
        redditInfo.subreddit,
        redditInfo.author,
        allAllowed
      );

      if (sent) {
        console.log(`✅ Cleaned message sent`);
      } else {
        console.error(`❌ Failed to send cleaned message`);
      }

      await sleep(2000);
      await sendLog(
        LOG_CHANNEL_ID,
        `✅ **Cleaned:**\n• From: **${msg.author.tag}**\n• Posted: ${allAllowed.length} URLs\n• Blocked: ${blocked.length} URLs` +
          (targetChannel.id !== msg.channel.id ? `\n• Redirected to <#${targetChannel.id}>` : '')
      );
    } catch (e) {
      console.error(`❌ Error: ${e.message}`);
      await sendLog(LOG_CHANNEL_ID, `❌ **Error:** ${e.message}\n• From: **${msg.author.tag}**`);
    }
  }
});

// ---------- START BOT ----------
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN not set!');
  process.exit(1);
}
client.login(BOT_TOKEN).catch(error => {
  console.error('❌ Login failed:', error);
  process.exit(1);
});
