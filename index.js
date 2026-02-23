const express = require('express');
const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const app = express();
const PORT = process.env.PORT || 3000;

// Health server
app.get('/health', (req, res) => res.json({ status: 'ok', bot: client.user?.tag || 'Starting...', uptime: process.uptime(), memory: process.memoryUsage(), ready: client.isReady(), timestamp: new Date().toISOString() }));
app.get('/', (req, res) => res.send('Discord Link Cleaner Bot - Health: /health'));
app.listen(PORT, '0.0.0.0', () => console.log(`🌐 Health server on port ${PORT}`));

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

// Config
const TARGET_BOT_IDS = ['1470088304736338075', '1470135134362665072', '1470133059046215796', '1470057771020849266', '1471149320257536232', '1471842365198303283', '1472941497123995690'];
const ALLOWED_EXTS = ['.mp4','.gif','.gifv','.webm','.jpg','.jpeg','.png','.webp'];
const LOG_CHANNEL_ID = '1474800528281042985';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Cache
const redditCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// --- User Agent Rotation ---
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Windows NT 10.0; rv:109.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/121.0'
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// --- URL cleaning ---
const cleanUrl = url => {
  if (!url) return url;
  let c = url.replace('www.redgifs.com', 'redgifs.com');
  if (c.includes('preview.redd.it')) { 
    let m = c.match(/preview\.redd\.it\/([^?]+)/); 
    if (m) c = `https://i.redd.it/${m[1].split('?')[0]}`; 
  }
  if (c.match(/x\.com|twitter\.com/i)) c = c.replace(/https?:\/\/(www\.)?(x\.com|twitter\.com)/i, 'https://vxtwitter.com');
  return c.split('?')[0].replace(/\/+$/, '');
};

// Recursive search helpers
const deepFind = (obj, test) => {
  if (!obj || typeof obj !== 'object') return null;
  if (test(obj)) return obj;
  if (Array.isArray(obj)) {
    for (let v of obj) { 
      let r = deepFind(v, test); 
      if (r) return r; 
    }
  } else {
    for (let k in obj) { 
      let r = deepFind(obj[k], test); 
      if (r) return r; 
    }
  }
  return null;
};

// Format message
const formatMessage = async (ch, title, sub, author, urls, isGallery, isVideo) => {
  let msg = `# ${title}\n\n*Posted in* **r/${sub}** *by* **${author}**\n\n`;
  if (isGallery && urls.length > 1) {
    msg += `**Gallery:** ${urls.length} images\n\n`;
    for (let i = 0; i < urls.length; i += 5) {
      let group = urls.slice(i, i+5).map((u, idx) => `[Pic${idx+1+i}](${u})`).join(' ');
      await ch.send(msg + group + '\n\n');
      msg = '';
    }
  } else if (isVideo) {
    urls.forEach(u => msg += `[Video/Gif](${u})\n\n`);
    await ch.send(msg);
  } else {
    if (urls.length > 1) msg += `**Images:** ${urls.length}\n\n`;
    for (let i = 0; i < urls.length; i += 5) {
      let group = urls.slice(i, i+5);
      let groupMsg = '';
      group.forEach(u => {
        let low = u.toLowerCase();
        let type = low.endsWith('.gif') ? 'Gif' : (low.match(/\.(jpg|jpeg|png|webp)$/) ? 'Pic' : 'Media');
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

// Reddit extractor with cache, rotating UA, and exponential backoff
const extractReddit = async (url, retryCount = 0) => {
  if (redditCache.has(url) && Date.now() - redditCache.get(url).ts < CACHE_TTL) 
    return redditCache.get(url).data;

  try {
    console.log(`🎬 Extracting Reddit: ${url} (attempt ${retryCount + 1})`);
    
    // Add jitter to the base delay
    const baseDelay = 1500 + Math.random() * 1000;
    await sleep(baseDelay);

    let jsonUrl = url.replace('www.reddit.com', 'api.reddit.com').replace(/\/$/, '') + '.json';
    const userAgent = getRandomUserAgent();
    let res = await fetch(jsonUrl, { 
      headers: { 'User-Agent': userAgent } 
    });

    if (res.status === 429) {
      const retryAfter = (res.headers.get('Retry-After') || 5) * 1000;
      // Exponential backoff with jitter: wait = retryAfter * (2^retryCount) + random
      const waitTime = retryAfter * Math.pow(2, retryCount) + Math.random() * 2000;
      console.log(`⏳ Rate limited (429), waiting ${Math.round(waitTime)}ms before retry ${retryCount + 1}`);
      
      if (retryCount < 3) { // max 3 retries
        await sleep(waitTime);
        return extractReddit(url, retryCount + 1);
      } else {
        console.log(`❌ Max retries exceeded for ${url}`);
        return null;
      }
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let data = await res.json();
    let post = deepFind(data, p => p.title && p.subreddit);
    if (!post) return null;

    let urls = [], hasVideo = false;
    // video fallback
    let vid = post.preview?.reddit_video_preview?.fallback_url || deepFind(post, o => o.fallback_url);
    if (vid) { 
      urls.push(cleanUrl(vid)); 
      hasVideo = true; 
    } else {
      let rg = post.url?.toLowerCase().includes('redgifs.com') ? post.url : (post.url_overridden_by_dest?.toLowerCase().includes('redgifs.com') ? post.url_overridden_by_dest : null);
      if (rg) { 
        urls = [cleanUrl(rg)]; 
        hasVideo = true; 
      }
    }
    // gallery
    if (!hasVideo && post.media_metadata) {
      for (let [id, m] of Object.entries(post.media_metadata)) {
        if (m.status !== 'valid') continue;
        let img = m.s?.gif || m.s?.mp4 || m.s?.u || (m.p?.length && m.p.at(-1).u);
        if (img) urls.push(cleanUrl(img));
      }
    }
    // direct media links
    let direct = post.url || post.url_overridden_by_dest;
    if (!urls.length && direct) {
      let d = direct.toLowerCase();
      if (d.match(/\.(jpg|jpeg|png|gif|mp4|webm)|i\.redd\.it|v\.redd\.it|redgifs\.com/))
        urls.push(cleanUrl(direct));
    }
    if (!urls.length) return null;

    let result = { urls, title: post.title, subreddit: post.subreddit, author: post.author, hasGallery: !!post.media_metadata, hasVideo };
    redditCache.set(url, { ts: Date.now(), data: result });
    return result;
  } catch (e) { 
    console.error(`❌ Reddit error:`, e.message); 
    return null; 
  }
};

// URL resolver (for redd.it) with rotating UA and simple retry
const resolveUrl = async (short, retryCount = 0) => {
  try {
    console.log(`🔍 Resolving: ${short} (attempt ${retryCount + 1})`);
    await sleep(1200 + Math.random() * 800); // base + jitter

    const userAgent = getRandomUserAgent();
    let res = await fetch(short, { 
      headers: { 'User-Agent': userAgent },
      redirect: 'follow' 
    });

    if (res.status === 429) {
      const waitTime = (parseInt(res.headers.get('Retry-After')) || 5) * 1000 * Math.pow(2, retryCount) + Math.random() * 1000;
      console.log(`⏳ Rate limited (429) on resolve, waiting ${Math.round(waitTime)}ms`);
      if (retryCount < 2) {
        await sleep(waitTime);
        return resolveUrl(short, retryCount + 1);
      }
      return null;
    }

    console.log(`✅ Resolved: ${short} -> ${res.url}`);
    return res.url;
  } catch (e) { 
    console.error(`❌ Resolve error: ${e.message}`);
    return null; 
  }
};

// Extract basic post info from message (fallback)
const fallbackInfo = content => {
  let t = content.match(/\*\*(.*?)\*\*/)?.[1]?.trim() || 'Reddit Post';
  let s = content.match(/r\/([\w]+)/i)?.[1] || 'unknown';
  let a = content.match(/\*by\s+([\w-]+)\*/i)?.[1] || 'unknown';
  return { title: t, subreddit: s, author: a };
};

// Log helper
const sendLog = async (channelId, msg) => {
  try { 
    const channel = await client.channels.fetch(channelId);
    if (channel) await channel.send(msg); 
  } catch (e) {
    console.error('Log channel error:', e.message);
  }
};

client.once('ready', () => {
  console.log(`✅ Bot online as ${client.user.tag}`);
  client.user.setPresence({ activities: [{ name: 'Cleaning links...', type: ActivityType.Watching }], status: 'online' });
});

client.on('messageCreate', async msg => {
  if (msg.author.id === client.user.id || !TARGET_BOT_IDS.includes(msg.author.id)) return;
  console.log(`📩 From: ${msg.author.tag} in #${msg.channel.name}`);

  await sendLog(LOG_CHANNEL_ID, `🔍 Processing message from **${msg.author.tag}** in <#${msg.channel.id}>\n📝 **Content:**\n${msg.content.slice(0,500)}${msg.content.length>500?'...':''}`);

  let urls = msg.content.match(/https?:\/\/[^\s<>"]+/gi);
  if (!urls) return;

  let fallback = fallbackInfo(msg.content);
  let allowed = [], blocked = [], seen = new Set(), extracted = null;

  // First pass: resolve redd.it and extract
  for (let u of urls) {
    if (u.includes('redd.it/')) {
      let resolved = await resolveUrl(u);
      if (resolved && !resolved.includes('i.redd.it') && !resolved.includes('v.redd.it'))
        extracted = await extractReddit(resolved);
      if (extracted) break;
    }
  }

  // Second pass: classify URLs
  for (let u of urls) {
    if (extracted && (u.includes('redd.it/') || u.includes('reddit.com/'))) continue;
    let clean = cleanUrl(u);
    if (seen.has(clean)) continue;
    seen.add(clean);
    let low = clean.toLowerCase();
    if (low.includes('x.com/') || low.includes('twitter.com/') || low.includes('redgifs.com') ||
        low.includes('i.redd.it') || low.includes('v.redd.it') ||
        ALLOWED_EXTS.some(ext => low.includes(ext) || low.endsWith(ext))) {
      allowed.push(clean);
      if (low.includes('redgifs.com')) console.log(`🎬 Allowed Redgifs: ${clean}`);
    } else blocked.push(clean);
  }

  let allAllowed = [...allowed];
  if (extracted) {
    extracted.urls.forEach(e => { 
      if (!seen.has(e)) { 
        allAllowed.push(e); 
        seen.add(e); 
      } 
    });
  }

  await sendLog(LOG_CHANNEL_ID,
    `🔎 **Analysis:**\n• From: **${msg.author.tag}**\n• Title: ${extracted?.title || fallback.title}\n• Subreddit: r/${extracted?.subreddit || fallback.subreddit}\n• URLs: ${urls.length} total, ${allAllowed.length} allowed, ${blocked.length} blocked` +
    (extracted ? `\n• Reddit content: ${extracted.urls.length} items${extracted.hasGallery?' (gallery)':''}${extracted.hasVideo?' (video)':''}` : '')
  );

  if (allAllowed.length === 0 && blocked.length) return msg.delete();

  if (allAllowed.length) {
    try {
      await msg.delete();
      await formatMessage(msg.channel,
        extracted?.title || fallback.title,
        extracted?.subreddit || fallback.subreddit,
        extracted?.author || fallback.author,
        allAllowed,
        extracted?.hasGallery || false,
        extracted?.hasVideo || false
      );
      await sleep(2000);
      await sendLog(LOG_CHANNEL_ID,
        `✅ **Cleaned:**\n• From: **${msg.author.tag}**\n• Posted: ${allAllowed.length} URLs\n• Blocked: ${blocked.length} URLs` +
        (extracted ? `\n• Reddit content extracted: ${extracted.urls.length} items` : '')
      );
    } catch (e) {
      console.error(`Error: ${e.message}`);
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
