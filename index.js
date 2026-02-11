const express = require('express');
const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// ========== EXPRESS HEALTH SERVER ==========
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    bot: client.user?.tag || 'Starting...',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    ready: client.isReady(),
    timestamp: new Date().toISOString()
  });
});

app.get('/', (req, res) => {
  res.send('Discord Link Cleaner Bot - Health: /health');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Health server on port ${PORT}`);
});

// ========== DISCORD BOT ==========
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ========== CONFIG ==========
const TARGET_BOT_IDS = [
  '1470088304736338075',
  '1470135134362665072', 
  '1470133059046215796',
  '1470057771020849266'
];

const ALLOWED_EXTENSIONS = [
  '.mp4', '.gif', '.gifv', '.webm', '.jpg', '.jpeg', '.png', '.webp'
];

const LOG_CHANNEL_ID = '1470005338483982400';
const REPOST_DELAY_MS = 2000; // 2 seconds between reposts
// ========== END CONFIG ==========

// ========== UTILITY FUNCTIONS ==========
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 📣 Centralised log sender – sends messages to the configured log channel
const sendLog = async (content) => {
  try {
    const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
    if (logChannel) await logChannel.send(content);
  } catch (error) {
    console.error('❌ Failed to send log:', error);
  }
};

// ========== SIMPLE URL FUNCTIONS ==========
const cleanUrl = (url) => {
  if (!url) return url;
  
  let cleaned = url;
  
  if (cleaned.includes('preview.redd.it')) {
    const match = cleaned.match(/preview\.redd\.it\/([^?]+)/);
    if (match) {
      const filename = match[1].split('?')[0];
      cleaned = `https://i.redd.it/${filename}`;
    }
  }
  
  if (cleaned.includes('x.com/') || cleaned.includes('twitter.com/')) {
    cleaned = cleaned.replace(/https?:\/\/(www\.)?(x\.com|twitter\.com)/i, 'https://vxtwitter.com');
  }
  
  cleaned = cleaned.split('?')[0].trim();
  cleaned = cleaned.replace(/\/+$/, '');
  
  return cleaned;
};

// ========== MESSAGE FORMATTING ==========
const formatMessage = async (channel, title, subreddit, author, urls, hasGallery = false, hasVideo = false) => {
  let message = `# ${title}\n\n`;
  message += `*Posted in* **r/${subreddit}** *by* **${author}**\n\n`;
  
  if (hasGallery && urls.length > 1) {
    message += `*Gallery:* ${urls.length} images\n\n`;
    const galleryLinks = urls.map((url, index) => `[Pic${index + 1}](${url})`).join(' ');
    message += `${galleryLinks}\n\n`;
  } else if (hasVideo) {
    message += `*Video/Gif*\n\n`;
    for (const url of urls) message += `${url}\n\n`;
  } else if (urls.length > 1) {
    message += `*Images:* ${urls.length}\n\n`;
    const imageLinks = urls.map((url, index) => `[Pic${index + 1}](${url})`).join(' ');
    message += `${imageLinks}\n\n`;
  } else {
    for (const url of urls) message += `${url}\n\n`;
  }
  
  await channel.send(message);
  await channel.send(`▪️▫️▪️▫️▪️▫️`);
};

// ========== REDDIT CONTENT EXTRACTOR – NO REDGIFS! ==========
const extractRedditContent = async (redditUrl) => {
  try {
    console.log(`🎬 Extracting Reddit content from: ${redditUrl}`);
    
    const jsonUrl = `${redditUrl}.json`;
    const response = await axios.get(jsonUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 5000
    });
    
    const data = response.data;
    
    const findPostData = (obj) => {
      if (!obj || typeof obj !== 'object') return null;
      if (obj.title && obj.subreddit) return obj;
      if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
          const result = findPostData(obj[i]);
          if (result) return result;
        }
      } else {
        for (const key in obj) {
          const result = findPostData(obj[key]);
          if (result) return result;
        }
      }
      return null;
    };
    
    const findFallbackUrl = (obj) => {
      if (!obj || typeof obj !== 'object') return null;
      if (obj.fallback_url && typeof obj.fallback_url === 'string' && obj.fallback_url.includes('v.redd.it')) {
        return obj.fallback_url;
      }
      if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
          const result = findFallbackUrl(obj[i]);
          if (result) return result;
        }
      } else {
        for (const key in obj) {
          const result = findFallbackUrl(obj[key]);
          if (result) return result;
        }
      }
      return null;
    };
    
    const postData = findPostData(data);
    if (!postData) {
      await sendLog(`❌ **Reddit extraction failed** – Could not find post data in JSON\n🔗 ${redditUrl}`);
      return null;
    }
    
    console.log(`✅ Found Reddit post: "${postData.title}" in r/${postData.subreddit}`);
    
    const extractedUrls = [];
    let hasVideo = false;
    
    const videoUrl = findFallbackUrl(postData);
    if (videoUrl) {
      const cleanedUrl = cleanUrl(videoUrl);
      extractedUrls.push(cleanedUrl);
      hasVideo = true;
      console.log(`🎥 Extracted video: ${cleanedUrl}`);
    }
    
    if (postData.media_metadata) {
      console.log(`🎨 Found gallery with ${Object.keys(postData.media_metadata).length} items`);
      for (const [id, mediaData] of Object.entries(postData.media_metadata)) {
        if (mediaData.status === 'valid') {
          let imageUrl = '';
          if (mediaData.s?.gif) imageUrl = mediaData.s.gif;
          else if (mediaData.s?.mp4) imageUrl = mediaData.s.mp4;
          else if (mediaData.s?.u) imageUrl = mediaData.s.u;
          else if (mediaData.p?.length > 0) imageUrl = mediaData.p[mediaData.p.length - 1].u;
          
          if (imageUrl) {
            const cleanedUrl = cleanUrl(imageUrl);
            extractedUrls.push(cleanedUrl);
            console.log(`📸 Extracted gallery image: ${cleanedUrl}`);
          }
        }
      }
    }
    
    if (extractedUrls.length === 0) {
      await sendLog(`⚠️ **Reddit extraction returned no Discord‑friendly media**\n🔗 ${redditUrl}\n📌 Title: ${postData.title}\n🗂️ Subreddit: r/${postData.subreddit}`);
      return null;
    }
    
    return {
      urls: extractedUrls,
      title: postData.title,
      subreddit: postData.subreddit,
      author: postData.author,
      source: 'reddit',
      hasGallery: !!postData.media_metadata,
      hasVideo
    };
    
  } catch (error) {
    console.error(`❌ Error extracting Reddit content:`, error.message);
    await sendLog(`❌ **Reddit extraction threw an error**\n🔗 ${redditUrl}\n⚠️ ${error.message}`);
    return null;
  }
};

// ========== URL RESOLVER ==========
const resolveUrl = async (shortUrl) => {
  try {
    console.log(`🔄 Resolving URL: ${shortUrl}`);
    const response = await axios.get(shortUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      maxRedirects: 5,
      timeout: 5000
    });
    const finalUrl = response.request.res.responseUrl;
    console.log(`✅ Resolved: ${shortUrl} -> ${finalUrl}`);
    return finalUrl;
  } catch (error) {
    console.error(`❌ Failed to resolve ${shortUrl}:`, error.message);
    await sendLog(`❌ **URL resolution failed**\n🔗 ${shortUrl}\n⚠️ ${error.message}`);
    return null;
  }
};

// ========== EXTRACT POST INFO FROM MESSAGE ==========
const extractPostInfo = (messageContent) => {
  const titleMatch = messageContent.match(/\*\*(.*?)\*\*/);
  const subredditMatch = messageContent.match(/r\/([\w]+)/i);
  const authorMatch = messageContent.match(/\*by\s+([\w-]+)\*/i);
  return {
    title: titleMatch ? titleMatch[1].trim() : 'Reddit Post',
    subreddit: subredditMatch ? subredditMatch[1] : 'unknown',
    author: authorMatch ? authorMatch[1] : 'unknown'
  };
};

// ========== BOT SETUP ==========
const setupBot = () => {
  console.log(`✅ Bot online as ${client.user.tag}`);
  console.log(`🔍 Monitoring ${TARGET_BOT_IDS.length} bots`);
  client.user.setPresence({
    activities: [{ name: 'Cleaning links...', type: ActivityType.Watching }],
    status: 'online'
  });
};

client.once('clientReady', setupBot);

// ========== MESSAGE PROCESSING ==========
client.on('messageCreate', async (message) => {
  if (message.author.id === client.user.id) return;
  if (!TARGET_BOT_IDS.includes(message.author.id)) return;
  
  console.log(`📨 From: ${message.author.tag} in #${message.channel.name}`);
  
  // Log initial processing
  await sendLog(
    `🔍 **Processing message** from **${message.author.tag}** in <#${message.channel.id}>\n` +
    `📝 **Content preview:**\n${message.content.slice(0, 500)}${message.content.length > 500 ? '…' : ''}`
  );
  
  const urlPattern = /https?:\/\/[^\s<>\"]+/gi;
  const allUrls = message.content.match(urlPattern);
  if (!allUrls) {
    await sendLog(`ℹ️ No URLs found in message from ${message.author.tag}`);
    return;
  }
  
  const postInfo = extractPostInfo(message.content);
  
  const allowedUrls = [];
  const blockedUrls = [];
  const seenUrls = new Set();
  let extractedResult = null;
  
  // --- Reddit extraction ---
  for (const url of allUrls) {
    if (url.includes('redd.it/')) {
      const resolvedUrl = await resolveUrl(url);
      if (resolvedUrl) {
        extractedResult = await extractRedditContent(resolvedUrl);
        if (extractedResult) {
          await sendLog(`✅ **Reddit content extracted** from ${url}\n📌 ${extractedResult.title} (r/${extractedResult.subreddit}) – ${extractedResult.urls.length} media item(s)`);
          break;
        }
      }
    }
  }
  
  // --- Process each URL ---
  for (const url of allUrls) {
    if (extractedResult && url.includes('redd.it/')) {
      console.log(`⏭️ Skipping ${url} (already extracted Reddit content)`);
      await sendLog(`⏭️ **Skipped redd.it URL** – already processed\n🔗 ${url}`);
      continue;
    }
    
    const cleanedUrl = cleanUrl(url);
    const urlLower = cleanedUrl.toLowerCase();
    
    // 🚫 BLOCK REDGIFS
    if (urlLower.includes('redgifs.com')) {
      console.log(`🚫 Blocked RedGIFs: ${cleanedUrl}`);
      blockedUrls.push(cleanedUrl);
      seenUrls.add(cleanedUrl);
      await sendLog(`🚫 **Blocked RedGIFs link** – does not embed in Discord\n🔗 ${cleanedUrl}`);
      continue;
    }
    
    if (seenUrls.has(cleanedUrl)) {
      console.log(`🚫 Duplicate skipped: ${cleanedUrl}`);
      await sendLog(`🚫 **Duplicate URL skipped**\n🔗 ${cleanedUrl}`);
      continue;
    }
    seenUrls.add(cleanedUrl);
    
    if (urlLower.includes('x.com/') || urlLower.includes('twitter.com/')) {
      allowedUrls.push(cleanedUrl);
      continue;
    }
    
    let hasAllowedExtension = false;
    for (const ext of ALLOWED_EXTENSIONS) {
      if (urlLower.includes(ext) || urlLower.endsWith(ext)) {
        hasAllowedExtension = true;
        allowedUrls.push(cleanedUrl);
        break;
      }
    }
    
    if (!hasAllowedExtension) {
      blockedUrls.push(cleanedUrl);
      console.log(`🚫 Blocked (no allowed extension): ${cleanedUrl}`);
      await sendLog(`🚫 **Blocked non‑media link** – no allowed file extension\n🔗 ${cleanedUrl}`);
    }
  }
  
  // --- Combine URLs ---
  const allAllowedUrls = [...allowedUrls];
  if (extractedResult) {
    for (const extractedUrl of extractedResult.urls) {
      if (!seenUrls.has(extractedUrl)) {
        allAllowedUrls.push(extractedUrl);
        seenUrls.add(extractedUrl);
      }
    }
  }
  
  // --- Log analysis ---
  await sendLog(
    `🔗 **Analysis completed**\n` +
    `• From: **${message.author.tag}**\n` +
    `• Title: ${extractedResult ? extractedResult.title : postInfo.title}\n` +
    `• Subreddit: r/${extractedResult ? extractedResult.subreddit : postInfo.subreddit}\n` +
    `• Total URLs found: ${allUrls.length}\n` +
    `• Allowed: ${allAllowedUrls.length}\n` +
    `• Blocked: ${blockedUrls.length}`
  );
  
  // --- Delete if nothing allowed ---
  if (allAllowedUrls.length === 0 && blockedUrls.length > 0) {
    await message.delete();
    await sendLog(`🗑️ **Message deleted** – no allowed URLs\nFrom ${message.author.tag} in <#${message.channel.id}>`);
    return;
  }
  
  // --- Post cleaned message ---
  if (allAllowedUrls.length > 0) {
    try {
      await message.delete();
      
      const finalTitle = extractedResult ? extractedResult.title : postInfo.title;
      const finalSubreddit = extractedResult ? extractedResult.subreddit : postInfo.subreddit;
      const finalAuthor = extractedResult ? extractedResult.author : postInfo.author;
      const hasGallery = extractedResult ? extractedResult.hasGallery : false;
      const hasVideo = extractedResult ? extractedResult.hasVideo : false;
      
      // ⏱️ Delay to avoid rate limits
      await delay(REPOST_DELAY_MS);
      
      await formatMessage(
        message.channel,
        finalTitle,
        finalSubreddit,
        finalAuthor,
        allAllowedUrls,
        hasGallery,
        hasVideo
      );
      
      await sendLog(
        `✅ **Clean repost successful**\n` +
        `• From: **${message.author.tag}**\n` +
        `• Posted: ${allAllowedUrls.length} URLs\n` +
        `• Blocked: ${blockedUrls.length} URLs`
      );
      
    } catch (error) {
      console.error(`❌ Error during repost:`, error.message);
      await sendLog(
        `❌ **Failed to repost cleaned message**\n` +
        `• From: **${message.author.tag}**\n` +
        `• Error: ${error.message}`
      );
    }
  }
});

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN not set!');
  process.exit(1);
}

client.login(BOT_TOKEN);
