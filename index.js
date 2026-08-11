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
// Only GIFs and videos – no images
const ALLOWED_EXTS = ['.mp4', '.gif', '.gifv', '.webm'];
const LOG_CHANNEL_ID = '1530804280720887918';
const REDDIT_NATIVE_DOMAINS = ['i.redd.it', 'v.redd.it'];
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
// Only cleans Reddit-related URLs (preview.redd.it, redgifs.com) and strips query strings
const cleanUrl = url => {
  if (!url) return url;
  let c = url.replace('www.redgifs.com', 'redgifs.com');
  if (c.includes('preview.redd.it')) {
    const m = c.match(/preview\.redd\.it\/([^?]+)/);
    if (m) c = `https://i.redd.it/${m[1].split('?')[0]}`;
  }
  // Query string and trailing slashes removed
  return c.split('?')[0].replace(/\/+$/, '');
};

const formatMessage = async (ch, postInfo, urls) => {
  const { title, subreddit, author, subredditLink, postLink } = postInfo;

  // Title as a clickable link (wrapped in < > to prevent embed)
  let msg = `## [${title}](<${postLink}>)\n`;
  // Subreddit as clickable link, author plain text
  msg += `*Posted in* **[r/${subreddit}](<${subredditLink}>)** *by* **${author}**\n`;

  // Each media URL as a bullet point (no labels)
  for (const url of urls) {
    msg += `[•](${url})\n`;
  }

  // Send in chunks if needed (Discord limit ~2000 chars per message)
  if (msg.length > 1900) {
    // Split into multiple messages if too long
    const chunks = msg.match(/[\s\S]{1,1900}/g) || [];
    for (const chunk of chunks) {
      await ch.send(chunk);
    }
  } else {
    await ch.send(msg);
  }
  await ch.send('═════════════════════════════════');
};

const getPostInfo = content => {
  // Extract subreddit name from r/[Subreddit]
  const subMatch = content.match(/r\/\[([^\]]+)\]/i);
  const sub = subMatch ? subMatch[1] : 'unknown';
  
  // Extract subreddit link from <<https://reddit.com/r/Subreddit>>
  const subLinkMatch = content.match(/r\/\[[^\]]+\]\(<<([^>]+)>>\)/i);
  const subredditLink = subLinkMatch ? subLinkMatch[1] : null;
  
  // Extract post link from the title link: [Title](<<https://redd.it/...>>)
  const postLinkMatch = content.match(/:\s*\[[^\]]*\]\(<<([^>]+)>>\)/);
  const postLink = postLinkMatch ? postLinkMatch[1] : null;
  
  // Extract title (can have nested brackets)
  const titleMatch = content.match(/:\s*\[(.*)\]\(<<[^>]+>>\)/);
  const title = titleMatch ? titleMatch[1].trim() : 'Reddit Post';
  
  // Extract author
  const authorMatch = content.match(/\*by\s+([\w-]+)\*/i);
  const author = authorMatch ? authorMatch[1] : 'unknown';
  
  return { title, subreddit: sub, author, subredditLink, postLink };
};

const sendLog = async (channelId, msg) => {
  try {
    const channel = await client.channels.fetch(channelId);
    if (channel) await channel.send(suppressEmbeds(msg));
  } catch (e) {
    originalError('Log channel error:', e.message);
  }
};

// ---------- BOT EVENTS ----------
client.once('clientReady', () => {
  console.log(`✅ Bot online as ${client.user.tag}`);
  client.user.setPresence({
    activities: [{ name: 'Cleaning links...', type: ActivityType.Watching }],
    status: 'online'
  });
});

client.on('messageCreate', async msg => {
  // Ignore own messages
  if (msg.author.id === client.user.id) return;

  // ---- 1. TARGET BOT: full Reddit link processing ----
  if (TARGET_BOT_IDS.includes(msg.author.id)) {
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

    const postInfo = getPostInfo(msg.content);
    console.log(`ℹ️ Post info - Title: "${postInfo.title}", Sub: ${postInfo.subreddit}, Author: ${postInfo.author}`);

    let allowed = [],
      blocked = [],
      seen = new Set();

    console.log(`🔍 Classifying URLs...`);
    for (const u of urls) {
      const clean = cleanUrl(u);
      if (seen.has(clean)) {
        console.log(`   🔁 Duplicate (skipped): ${clean}`);
        continue;
      }
      seen.add(clean);
      const low = clean.toLowerCase();
      if (
        low.includes('redgifs.com') ||
        low.includes('v.redd.it') ||
        ALLOWED_EXTS.some(ext => low.includes(ext) || low.endsWith(ext))
      ) {
        allowed.push(clean);
        console.log(`   ✅ Allowed: ${clean}`);
        if (low.includes('redgifs.com')) console.log(`     ↳ (Redgifs)`);
      } else {
        blocked.push(clean);
        console.log(`   ❌ Blocked: ${clean}`);
      }
    }

    let allAllowed = [...allowed];

    // Prioritize Reddit native media
    const hasRedditNative = allAllowed.some(url =>
      REDDIT_NATIVE_DOMAINS.some(domain => url.includes(domain))
    );
    if (hasRedditNative) {
      console.log(`🎯 Reddit native media detected, filtering out external...`);
      allAllowed = allAllowed.filter(url =>
        REDDIT_NATIVE_DOMAINS.some(domain => url.includes(domain))
      );
      console.log(`   ↳ Remaining native URLs:`, allAllowed);
    }

    console.log(`📊 Final allowed URLs (${allAllowed.length}):`, allAllowed);
    console.log(`🚫 Blocked URLs (${blocked.length}):`, blocked);

    await sendLog(
      LOG_CHANNEL_ID,
      `🔎 **Analysis:**\n• From: **${msg.author.tag}**\n• Title: ${postInfo.title}\n• Subreddit: r/${postInfo.subreddit}\n• URLs: ${urls.length} total, ${allAllowed.length} allowed, ${blocked.length} blocked`
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

        let targetChannel = msg.channel;
        const subForRedirect = postInfo.subreddit.toLowerCase();
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
          postInfo,
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
    return; // done with target bot
  }

  // ---- 2. EVERYONE ELSE: Twitter/X tweet conversion (keep original) ----
  // Skip if message already contains any known conversion domain
  if (
    msg.content.includes('fixupx.com') ||
    msg.content.includes('fxtwitter.com') ||
    msg.content.includes('vxtwitter.com')
  ) return;

  const urls = msg.content.match(/https?:\/\/[^\s<>"]+/gi);
  if (!urls) return;

  // Filter only Twitter/X links that are tweet URLs (contain /status/)
  const twitterUrls = urls.filter(u => /x\.com|twitter\.com/i.test(u) && /\/status\//i.test(u));
  if (twitterUrls.length === 0) return;

  console.log(`\n🐦 Tweet link from ${msg.author.tag} in #${msg.channel.name}`);
  console.log(`Original: ${msg.content}`);

  // Convert the tweet URLs: replace domain with fixupx.com and strip query/trailing slash
  const converted = twitterUrls.map(u => {
    let c = u.replace(/https?:\/\/(www\.)?(x\.com|twitter\.com)/i, 'https://fixupx.com');
    return c.split('?')[0].replace(/\/+$/, '');
  });
  // Remove duplicates
  const unique = [...new Set(converted)];

  // Build a reply message – each link as a bullet point with embed
  const lines = unique.map(u => `[•](${u})`);
  const reply = lines.join('\n');

  try {
    // Reply to the original message (keeps it intact)
    await msg.reply(reply);
    console.log(`✅ Replied with: ${unique.join(', ')}`);
    await sendLog(LOG_CHANNEL_ID, `🐦 Converted tweet for **${msg.author.tag}**: ${unique.join(', ')}`);
  } catch (e) {
    console.error(`❌ Error replying with converted tweet: ${e.message}`);
    await sendLog(LOG_CHANNEL_ID, `❌ **Tweet conversion error:** ${e.message}`);
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
