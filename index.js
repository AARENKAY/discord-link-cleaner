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
const SUBREDDIT_CHANNEL_MAP = {
  realscatgirls: '1466301671301714012',
  poopingvixens: '1466301671301714012',
  dirtygirls2: '1466301671301714012',
  scatgifs: '1466301671301714012',
  scatporn2: '1466301671301714012',
  scat34: '1471015400790822922',
  girlsmasturbating: '1535261507410206832',
  fingerherass: '1535261507410206832'
};

const TARGET_BOT_IDS = ['1531274702067073157'];
const ALLOWED_EXTS = ['.mp4', '.gif', '.gifv', '.webm', '.jpg', '.jpeg', '.png', '.webp'];
const LOG_CHANNEL_ID = '1530804280720887918';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- LOGGER ----------
const originalLog = console.log;
const originalError = console.error;

const suppressEmbeds = text => {
  if (!text) return text;
  return text.replace(/https?:\/\/[^\s<>"]+/gi, '<$&>');
};

const logAndSend = async (message, level = 'log') => {
  const ts = new Date().toISOString();
  originalLog(`[${ts}] ${message}`);
  try {
    const channel = await client.channels.fetch(LOG_CHANNEL_ID);
    if (!channel) return;
    let msg = `\`[${ts}]\` ${suppressEmbeds(message)}`;
    if (msg.length > 1900) msg = msg.slice(0, 1900) + '... (truncated)';
    await channel.send(msg);
  } catch (e) {
    originalError('Failed to send log to Discord:', e.message);
  }
};

console.log = (...args) => {
  const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  logAndSend(msg);
};
console.error = (...args) => {
  const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  logAndSend(`❌ ${msg}`, 'error');
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
  return c.split('?')[0].replace(/\/+$/, '');
};

// Host‑based regex helpers
const isRedgifs = url => /^https?:\/\/(?:www\.)?redgifs\.com\b/i.test(url);
const isRedditNative = url => /^https?:\/\/(?:i|v)\.redd\.it\b/i.test(url);
const isVideoUrl = url =>
  isRedgifs(url) ||
  /^https?:\/\/v\.redd\.it\b/i.test(url) ||
  /\.(mp4|webm|gifv|gif)$/i.test(url);

// formatMessage with newline‑aware chunking and empty‑chunk guard
const formatMessage = async (ch, title, sub, author, urls) => {
  let header = `## ${title}\n\n*Posted in* **r/${sub}** *by* **${author}**\n\n`;
  let output = '';
  for (const u of urls) {
    const label = isVideoUrl(u) ? 'Video/Gif' : 'Pic';
    output += `[${label}](${u})\n\n`;
  }
  const fullMessage = header + output;

  // Split by newline boundaries, each chunk ≤ 1900 characters
  const lines = fullMessage.split('\n');
  const chunks = [];
  let current = '';
  for (const line of lines) {
    // Only push if current is non‑empty to avoid empty chunks
    if ((current + line).length > 1900 && current) {
      chunks.push(current);
      current = '';
    }
    current += line + '\n';
  }
  if (current) chunks.push(current);

  for (const chunk of chunks) {
    await ch.send(chunk);
  }
  await ch.send('═════════════════════════════════');
};

const fallbackInfo = content => {
  const subMatch = content.match(/r\/([\w]+)/i);
  const sub = subMatch ? subMatch[1] : 'unknown';

  const titleMatch = content.match(/:\s*\[([^\]]+)\]/);
  const title = titleMatch ? titleMatch[1].trim() : 'Reddit Post';

  const authorMatch = content.match(/\*by\s+([\w-]+)\*/i);
  const author = authorMatch ? authorMatch[1] : 'unknown';

  return { title, subreddit: sub, author };
};

const sendLog = async (channelId, msg) => {
  try {
    const channel = await client.channels.fetch(channelId);
    if (channel) await channel.send(suppressEmbeds(msg));
  } catch (e) {
    console.error('Log channel error:', e.message);
  }
};

// ---------- DUPLICATE MESSAGE CACHE ----------
const processedMessages = new Set();
const CACHE_CLEANUP_INTERVAL = 10 * 60 * 1000; // 10 minutes

// Cleanup timer – .unref() so it doesn't keep the process alive
const cleanupTimer = setInterval(() => {
  processedMessages.clear();
}, CACHE_CLEANUP_INTERVAL);
cleanupTimer.unref();

// ---------- BOT EVENTS ----------
client.once('clientReady', () => {
  console.log(`✅ Bot online as ${client.user.tag}`);
  client.user.setPresence({
    activities: [{ name: 'Cleaning links...', type: ActivityType.Watching }],
    status: 'online'
  });
});

client.on('messageCreate', async msg => {
  // First, ignore messages that aren't from the target bot(s)
  if (msg.author.id === client.user.id || !TARGET_BOT_IDS.includes(msg.author.id)) return;

  // Then check duplicate cache – only for messages we actually care about
  if (processedMessages.has(msg.id)) return;
  processedMessages.add(msg.id);

  console.log(`\n📩 New message from ${msg.author.tag} in #${msg.channel.name}`);
  console.log(`📝 Full content:\n${msg.content}`);

  await sendLog(
    LOG_CHANNEL_ID,
    `🔍 Processing message from **${msg.author.tag}** in <#${msg.channel.id}>\n📝 **Content:**\n${msg.content.slice(0, 500)}${msg.content.length > 500 ? '...' : ''}`
  );

  const urls = msg.content.match(/https?:\/\/[^\s<>"]+/gi);
  if (!urls) {
    console.log(`ℹ️ No URLs found in message`);
    return;
  }
  console.log(`🔗 Found ${urls.length} raw URLs:`, urls);

  const fallback = fallbackInfo(msg.content);
  console.log(`ℹ️ Fallback info - Title: "${fallback.title}", Sub: ${fallback.subreddit}, Author: ${fallback.author}`);

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
    `🔎 **Analysis:**\n• From: **${msg.author.tag}**\n• Title: ${fallback.title}\n• Subreddit: r/${fallback.subreddit}\n• URLs: ${urls.length} total, ${allAllowed.length} allowed, ${blocked.length} blocked`
  );

  if (allAllowed.length === 0 && blocked.length) {
    console.log(`🗑️ No allowed URLs, deleting original message`);
    return msg.delete();
  }

  if (allAllowed.length) {
    try {
      console.log(`🗑️ Deleting original message...`);
      await msg.delete();
      console.log(`✅ Original message deleted`);

      // ---------- REDIRECTION LOGIC ----------
      let targetChannel = msg.channel;
      const subForRedirect = fallback.subreddit.toLowerCase();
      if (SUBREDDIT_CHANNEL_MAP[subForRedirect]) {
        try {
          const channelId = SUBREDDIT_CHANNEL_MAP[subForRedirect];
          targetChannel = await client.channels.fetch(channelId);
          if (!targetChannel) {
            console.error(`❌ Could not fetch channel ${channelId}, falling back to original`);
            targetChannel = msg.channel;
          } else {
            console.log(`🔄 Redirecting to channel #${targetChannel.name} (${channelId}) for subreddit r/${subForRedirect}`);
            await sendLog(LOG_CHANNEL_ID, `🔄 Redirected to <#${channelId}> because of subreddit r/${subForRedirect}`);
          }
        } catch (e) {
          console.error(`❌ Error fetching redirect channel: ${e.message}, falling back to original`);
          targetChannel = msg.channel;
        }
      }

      console.log(`📤 Sending cleaned message to ${targetChannel.id}...`);
      await formatMessage(
        targetChannel,
        fallback.title,
        fallback.subreddit,
        fallback.author,
        allAllowed
      );
      console.log(`✅ Cleaned message sent`);

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
