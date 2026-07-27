const express = require('express');
const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => res.json({ status: 'ok', bot: client.user?.tag || 'Starting...', uptime: process.uptime(), memory: process.memoryUsage(), ready: client.isReady(), timestamp: new Date().toISOString() }));
app.get('/', (req, res) => res.send('Discord Link Cleaner Bot - Health: /health'));
app.listen(PORT, '0.0.0.0', () => console.log(`🌐 Health server on port ${PORT}`));

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

// Config
const TARGET_BOT_IDS = [
  '1531274702067073157', '1470088304736338075', '1470135134362665072', '1470133059046215796',
  '1470057771020849266', '1471149320257536232', '1471842365198303283',
  '1517523318557904986', '1472941497123995690', '1518233162378117160'
];
const ALLOWED_EXTS = ['.mp4','.gif','.gifv','.webm','.jpg','.jpeg','.png','.webp'];
const LOG_CHANNEL_ID = '1530804280720887918';
const REDDIT_NATIVE_DOMAINS = ['i.redd.it', 'v.redd.it'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36';
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

// ---------- LOGGER ----------
const originalLog = console.log;
const originalError = console.error;

const logAndSend = async (message, level = 'log') => {
  const ts = new Date().toISOString();
  originalLog(`[${ts}] ${message}`);
  try {
    const channel = await client.channels.fetch(LOG_CHANNEL_ID);
    if (!channel) return;
    let msg = `\`[${ts}]\` ${message}`;
    if (msg.length > 1900) msg = msg.slice(0, 1900) + '... (truncated)';
    await channel.send(msg);
  } catch (e) {
    originalError('Failed to send log to Discord:', e.message);
  }
};

console.log = (...args) => {
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  logAndSend(msg);
};
console.error = (...args) => {
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  logAndSend(`❌ ${msg}`, 'error');
};

// Cache
const redditCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

// --- URL cleaning ---
const cleanUrl = url => {
  if (!url) return url;
  let c = url.replace('www.redgifs.com', 'redgifs.com');
  if (c.includes('preview.redd.it')) {
    const m = c.match(/preview\.redd\.it\/([^?]+)/);
    if (m) c = `https://i.redd.it/${m[1].split('?')[0]}`;
  }
  if (c.match(/x\.com|twitter\.com/i)) c = c.replace(/https?:\/\/(www\.)?(x\.com|twitter\.com)/i, 'https://vxtwitter.com');
  return c.split('?')[0].replace(/\/+$/, '');
};

// --- Recursive search ---
const deepFind = (obj, test) => {
  if (!obj || typeof obj !== 'object') return null;
  if (test(obj)) return obj;
  if (Array.isArray(obj)) {
    for (const v of obj) {
      const r = deepFind(v, test);
      if (r) return r;
    }
  } else {
    for (const k in obj) {
      const r = deepFind(obj[k], test);
      if (r) return r;
    }
  }
  return null;
};

// --- Format cleaned message ---
const formatMessage = async (ch, title, sub, author, urls, isGallery, isVideo) => {
  let msg = `## ${title}\n\n*Posted in* **r/${sub}** *by* **${author}**\n\n`;
  if (isGallery && urls.length > 1) {
    msg += `**Gallery:** ${urls.length} images\n\n`;
    for (let i = 0; i < urls.length; i += 5) {
      const group = urls.slice(i, i + 5).map((u, idx) => `[Pic${idx + 1 + i}](${u})`).join(' ');
      await ch.send(msg + group + '\n\n');
      msg = '';
    }
  } else if (isVideo) {
    urls.forEach(u => msg += `[Video/Gif](${u})\n\n`);
    await ch.send(msg);
  } else {
    if (urls.length > 1) msg += `**Images:** ${urls.length}\n\n`;
    for (let i = 0; i < urls.length; i += 5) {
      const group = urls.slice(i, i + 5);
      let groupMsg = '';
      group.forEach(u => {
        const low = u.toLowerCase();
        const type = low.endsWith('.gif') ? 'Gif' : (low.match(/\.(jpg|jpeg|png|webp)$/) ? 'Pic' : 'Media');
        groupMsg += `[${type}](${u})\n\n`;
      });
      if (group.length) {
        await ch.send(msg + groupMsg);
        msg = '';
      }
    }
    if (msg.trim()) await ch.send(msg);
  }
  await ch.send('═════════════════════════════════');
};

// --- fetch with always a User-Agent ---
async function fetchWithFallback(url, options = {}, retryCount = 0) {
  const defaultHeaders = { 'User-Agent': DESKTOP_UA };
  const headers = { ...defaultHeaders, ...(options.headers || {}) };

  try {
    console.log(`   ↳ Fetching ${url} (attempt ${retryCount + 1})`);
    const res = await fetch(url, { ...options, headers, redirect: 'follow' });
    const status = res.status;

    if (status === 429) {
      const retryAfter = (res.headers.get('Retry-After') || 5) * 1000;
      const waitTime = retryAfter * Math.pow(2, retryCount) + Math.random() * 2000;
      console.log(`⏳ Rate limited (429), waiting ${Math.round(waitTime)}ms before retry ${retryCount + 1}`);
      if (retryCount < 3) {
        await sleep(waitTime);
        return fetchWithFallback(url, options, retryCount + 1);
      } else throw new Error('Max retries for 429');
    }

    if (status >= 500) {
      console.log(`   ↳ Server error ${status}, retrying...`);
      if (retryCount < 3) {
        const waitTime = 2000 * Math.pow(2, retryCount) + Math.random() * 1000;
        await sleep(waitTime);
        return fetchWithFallback(url, options, retryCount + 1);
      } else throw new Error(`Server error ${status} after retries`);
    }

    if (!res.ok) throw new Error(`HTTP ${status}`);
    return res;
  } catch (e) {
    if (retryCount === 0 && !e.message.startsWith('HTTP')) {
      console.log(`   ↳ Network error: ${e.message}, retrying with mobile UA...`);
      const altHeaders = { ...headers, 'User-Agent': ANDROID_UA };
      const res2 = await fetch(url, { ...options, headers: altHeaders, redirect: 'follow' });
      if (!res2.ok) throw new Error(`HTTP ${res2.status} after fallback`);
      return res2;
    }
    throw e;
  }
}

// --- Slugify (Reddit style) ---
function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

// --- Reddit extractor (uses full slugged URL) ---
const extractReddit = async (subreddit, postId, title, retryCount = 0) => {
  if (!subreddit || subreddit === 'unknown') {
    console.log(`⚠️ No subreddit available, skipping extraction`);
    return null;
  }
  const slug = slugify(title || 'post');
  const jsonUrl = `https://www.reddit.com/r/${subreddit}/comments/${postId}/${slug}.json`;
  console.log(`🎬 Extracting Reddit: ${jsonUrl} (attempt ${retryCount + 1})`);

  const cacheKey = `${subreddit}_${postId}`;
  if (redditCache.has(cacheKey) && Date.now() - redditCache.get(cacheKey).ts < CACHE_TTL) {
    console.log(`📦 Using cached Reddit data for ${cacheKey}`);
    return redditCache.get(cacheKey).data;
  }

  try {
    await sleep(1500 + Math.random() * 1000);
    console.log(`   ↳ JSON URL to fetch: ${jsonUrl}`);
    const response = await fetchWithFallback(jsonUrl, {}, retryCount);
    const data = await response.json();

    const post = deepFind(data, p => p.title && p.subreddit);
    if (!post) {
      console.log(`❌ No post data found in Reddit response`);
      return null;
    }

    console.log(`   ✅ Found post: "${post.title}" in r/${post.subreddit} by ${post.author}`);

    let urls = [], hasVideo = false;
    const vid = post.preview?.reddit_video_preview?.fallback_url || deepFind(post, o => o.fallback_url);
    if (vid) {
      urls.push(cleanUrl(vid));
      hasVideo = true;
      console.log(`   🎥 Found video: ${vid}`);
    } else {
      const rg = post.url?.toLowerCase().includes('redgifs.com') ? post.url : (post.url_overridden_by_dest?.toLowerCase().includes('redgifs.com') ? post.url_overridden_by_dest : null);
      if (rg) {
        urls = [cleanUrl(rg)];
        hasVideo = true;
        console.log(`   🎬 Found Redgifs: ${rg}`);
      }
    }
    if (!hasVideo && post.media_metadata) {
      console.log(`   🖼️ Gallery detected, extracting images...`);
      for (const [id, m] of Object.entries(post.media_metadata)) {
        if (m.status !== 'valid') continue;
        const img = m.s?.gif || m.s?.mp4 || m.s?.u || (m.p?.length && m.p.at(-1).u);
        if (img) {
          const cleaned = cleanUrl(img);
          urls.push(cleaned);
          console.log(`     - Added gallery image: ${cleaned}`);
        }
      }
    }
    const direct = post.url || post.url_overridden_by_dest;
    if (!urls.length && direct) {
      const d = direct.toLowerCase();
      if (d.match(/\.(jpg|jpeg|png|gif|mp4|webm)|i\.redd\.it|v\.redd\.it|redgifs\.com/)) {
        urls.push(cleanUrl(direct));
        console.log(`   📎 Found direct media: ${direct}`);
      }
    }

    if (!urls.length) {
      console.log(`❌ No media URLs found in post`);
      return null;
    }

    const result = {
      urls,
      title: post.title,
      subreddit: post.subreddit,
      author: post.author,
      hasGallery: !!post.media_metadata,
      hasVideo
    };
    redditCache.set(cacheKey, { ts: Date.now(), data: result });
    console.log(`   ✅ Extracted ${urls.length} media URLs`);
    return result;
  } catch (e) {
    console.error(`❌ Reddit error: ${e.message}`);
    return null;
  }
};

// --- Helper: extract post ID from any Reddit link ---
function getRedditPostId(url) {
  let match = url.match(/redd\.it\/(\w+)/);
  if (match) return match[1];
  match = url.match(/reddit\.com\/r\/\w+\/comments\/(\w+)/);
  if (match) return match[1];
  match = url.match(/reddit\.com\/gallery\/(\w+)/);
  if (match) return match[1];
  return null;
}

function isRedditPostUrl(url) {
  return /redd\.it\/\w+/.test(url) || /reddit\.com\/r\/\w+\/comments\/\w+/.test(url) || /reddit\.com\/gallery\/\w+/.test(url);
}

// --- Fallback info from message content ---
const fallbackInfo = content => {
  const t = content.match(/\*\*(.*?)\*\*/)?.[1]?.trim() || 'Reddit Post';
  const s = content.match(/r\/([\w]+)/i)?.[1] || 'unknown';
  const a = content.match(/\*by\s+([\w-]+)\*/i)?.[1] || 'unknown';
  return { title: t, subreddit: s, author: a };
};

const sendLog = async (channelId, msg) => {
  try {
    const channel = await client.channels.fetch(channelId);
    if (channel) await channel.send(msg);
  } catch (e) {
    console.error('Log channel error:', e.message);
  }
};

client.once('clientReady', () => {
  console.log(`✅ Bot online as ${client.user.tag}`);
  client.user.setPresence({ activities: [{ name: 'Cleaning links...', type: ActivityType.Watching }], status: 'online' });
});

client.on('messageCreate', async msg => {
  if (msg.author.id === client.user.id || !TARGET_BOT_IDS.includes(msg.author.id)) return;

  console.log(`\n📩 New message from ${msg.author.tag} in #${msg.channel.name}`);
  console.log(`📝 Full content:\n${msg.content}`);

  await sendLog(LOG_CHANNEL_ID, `🔍 Processing message from **${msg.author.tag}** in <#${msg.channel.id}>\n📝 **Content:**\n${msg.content.slice(0,500)}${msg.content.length>500?'...':''}`);

  const urls = msg.content.match(/https?:\/\/[^\s<>"]+/gi);
  if (!urls) {
    console.log(`ℹ️ No URLs found in message`);
    return;
  }
  console.log(`🔗 Found ${urls.length} raw URLs:`, urls);

  const fallback = fallbackInfo(msg.content);
  console.log(`ℹ️ Fallback info - Title: "${fallback.title}", Sub: ${fallback.subreddit}, Author: ${fallback.author}`);

  let allowed = [], blocked = [], seen = new Set(), extracted = null;

  // --- First pass: detect Reddit post links and extract (no shortlink fetch) ---
  for (const u of urls) {
    if (isRedditPostUrl(u)) {
      const postId = getRedditPostId(u);
      if (!postId) continue;
      console.log(`🔁 Processing Reddit link: ${u} (ID: ${postId})`);
      const sub = fallback.subreddit !== 'unknown' ? fallback.subreddit : null;
      console.log(`   ↳ Using subreddit: ${sub || 'none'}, ID: ${postId}, Title: "${fallback.title}"`);
      extracted = await extractReddit(sub, postId, fallback.title);
      if (extracted) {
        console.log(`✅ Extraction successful, using extracted data`);
        break;
      } else {
        console.log(`⚠️ Extraction failed for ${u}, trying next Reddit link if any`);
      }
    }
  }

  // --- Second pass: classify remaining URLs ---
  console.log(`🔍 Classifying URLs...`);
  for (const u of urls) {
    if (extracted && isRedditPostUrl(u)) {
      console.log(`   ⏭️ Skipping Reddit post URL (already extracted): ${u}`);
      continue;
    }
    const clean = cleanUrl(u);
    if (seen.has(clean)) {
      console.log(`   🔁 Duplicate (skipped): ${clean}`);
      continue;
    }
    seen.add(clean);
    const low = clean.toLowerCase();
    if (low.includes('x.com/') || low.includes('twitter.com/') || low.includes('redgifs.com') ||
        low.includes('i.redd.it') || low.includes('v.redd.it') ||
        ALLOWED_EXTS.some(ext => low.includes(ext) || low.endsWith(ext))) {
      allowed.push(clean);
      console.log(`   ✅ Allowed: ${clean}`);
      if (low.includes('redgifs.com')) console.log(`     ↳ (Redgifs)`);
    } else {
      blocked.push(clean);
      console.log(`   ❌ Blocked: ${clean}`);
    }
  }

  let allAllowed = [...allowed];
  if (extracted) {
    console.log(`📦 Adding extracted URLs from Reddit...`);
    extracted.urls.forEach(e => {
      if (!seen.has(e)) {
        allAllowed.push(e);
        seen.add(e);
        console.log(`   ✅ Added extracted: ${e}`);
      } else {
        console.log(`   🔁 Extracted URL already present: ${e}`);
      }
    });
  }

  // --- Prioritize Reddit native media ---
  const hasRedditNative = allAllowed.some(url => REDDIT_NATIVE_DOMAINS.some(domain => url.includes(domain)));
  if (hasRedditNative) {
    console.log(`🎯 Reddit native media detected, filtering out external...`);
    allAllowed = allAllowed.filter(url => REDDIT_NATIVE_DOMAINS.some(domain => url.includes(domain)));
    console.log(`   ↳ Remaining native URLs:`, allAllowed);
  }

  console.log(`📊 Final allowed URLs (${allAllowed.length}):`, allAllowed);
  console.log(`🚫 Blocked URLs (${blocked.length}):`, blocked);

  await sendLog(LOG_CHANNEL_ID,
    `🔎 **Analysis:**\n• From: **${msg.author.tag}**\n• Title: ${extracted?.title || fallback.title}\n• Subreddit: r/${extracted?.subreddit || fallback.subreddit}\n• URLs: ${urls.length} total, ${allAllowed.length} allowed, ${blocked.length} blocked` +
    (extracted ? `\n• Reddit content: ${extracted.urls.length} items${extracted.hasGallery?' (gallery)':''}${extracted.hasVideo?' (video)':''}` : '')
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

      console.log(`📤 Sending cleaned message...`);
      await formatMessage(msg.channel,
        extracted?.title || fallback.title,
        extracted?.subreddit || fallback.subreddit,
        extracted?.author || fallback.author,
        allAllowed,
        extracted?.hasGallery || false,
        extracted?.hasVideo || false
      );
      console.log(`✅ Cleaned message sent`);

      await sleep(2000);
      await sendLog(LOG_CHANNEL_ID,
        `✅ **Cleaned:**\n• From: **${msg.author.tag}**\n• Posted: ${allAllowed.length} URLs\n• Blocked: ${blocked.length} URLs` +
        (extracted ? `\n• Reddit content extracted: ${extracted.urls.length} items` : '')
      );
    } catch (e) {
      console.error(`❌ Error: ${e.message}`);
      await sendLog(LOG_CHANNEL_ID, `❌ **Error:** ${e.message}\n• From: **${msg.author.tag}**`);
    }
  }
});

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) { console.error('❌ BOT_TOKEN not set!'); process.exit(1); }
client.login(BOT_TOKEN).catch(error => {
  console.error('❌ Login failed:', error);
  process.exit(1);
});
