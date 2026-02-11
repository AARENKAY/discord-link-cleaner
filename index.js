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
  console.log(`рџЊђ Health server on port ${PORT}`);
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

// 🕐 DELAY CONFIG – 2 seconds between reposts
const REPOST_DELAY_MS = 2000;
// ========== END CONFIG ==========

// ========== UTILITY ==========
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ========== SIMPLE URL FUNCTIONS ==========
const cleanUrl = (url) => {
  if (!url) return url;
  
  let cleaned = url;
  
  // Convert preview.redd.it to i.redd.it
  if (cleaned.includes('preview.redd.it')) {
    const match = cleaned.match(/preview\.redd\.it\/([^?]+)/);
    if (match) {
      const filename = match[1].split('?')[0];
      cleaned = `https://i.redd.it/${filename}`;
    }
  }
  
  // Convert Twitter/X to vxtwitter
  if (cleaned.includes('x.com/') || cleaned.includes('twitter.com/')) {
    cleaned = cleaned.replace(/https?:\/\/(www\.)?(x\.com|twitter\.com)/i, 'https://vxtwitter.com');
  }
  
  // Remove query parameters and trailing slashes
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
    
    // Format gallery images as clickable links [Pic1](url) [Pic2](url) etc.
    const galleryLinks = urls.map((url, index) => {
      const picNumber = index + 1;
      return `[Pic${picNumber}](${url})`;
    }).join(' ');
    
    message += `${galleryLinks}\n\n`;
  } else if (hasVideo) {
    message += `*Video/Gif*\n\n`;
    // Single video URL on its own line
    for (const url of urls) {
      message += `${url}\n\n`;
    }
  } else if (urls.length > 1) {
    message += `*Images:* ${urls.length}\n\n`;
    // Format multiple images as clickable links
    const imageLinks = urls.map((url, index) => {
      const picNumber = index + 1;
      return `[Pic${picNumber}](${url})`;
    }).join(' ');
    
    message += `${imageLinks}\n\n`;
  } else {
    // Single image/video URL
    for (const url of urls) {
      message += `${url}\n\n`;
    }
  }
  
  // Send the main message
  await channel.send(message);
  
  // Send divider as a second immediate message
  await channel.send(`в–ЄпёЏв–«пёЏв–ЄпёЏв–«пёЏв–ЄпёЏв–«пёЏ`);
};

// ========== REDDIT CONTENT EXTRACTOR WITH SMART FALLBACK_URL SEARCH ==========
const extractRedditContent = async (redditUrl) => {
  try {
    console.log(`рџЋ¬ Extracting Reddit content from: ${redditUrl}`);
    
    // Add .json to get the JSON data
    const jsonUrl = `${redditUrl}.json`;
    
    const response = await axios.get(jsonUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 5000
    });
    
    const data = response.data;
    
    // Function to search for post data recursively
    const findPostData = (obj) => {
      if (!obj || typeof obj !== 'object') return null;
      
      // Check if this looks like post data
      if (obj.title && obj.subreddit) {
        return obj;
      }
      
      // Search in arrays and objects
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
    
    // Function to find ANY fallback_url in the entire post data
    const findFallbackUrl = (obj) => {
      if (!obj || typeof obj !== 'object') return null;
      
      // Direct match - found a fallback_url!
      if (obj.fallback_url && typeof obj.fallback_url === 'string') {
        return obj.fallback_url;
      }
      
      // Search recursively through all properties
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
      console.log('вќЊ Could not find post data in Reddit JSON');
      return null;
    }
    
    console.log(`вњ… Found Reddit post: "${postData.title}" in r/${postData.subreddit}`);
    
    const extractedUrls = [];
    let hasVideo = false;
    
    // 1. LOOK FOR ANY FALLBACK_URL ANYWHERE - this handles all video locations!
    const videoUrl = findFallbackUrl(postData);
    if (videoUrl) {
      const cleanedUrl = cleanUrl(videoUrl);
      extractedUrls.push(cleanedUrl);
      hasVideo = true;
      console.log(`рџЋҐ Extracted video from fallback_url: ${cleanedUrl}`);
    }
    
    // 2. Check for gallery images (media_metadata)
    if (postData.media_metadata) {
      console.log(`рџЋЁ Found gallery with ${Object.keys(postData.media_metadata).length} items`);
      
      for (const [id, mediaData] of Object.entries(postData.media_metadata)) {
        if (mediaData.status === 'valid') {
          let imageUrl = '';
          
          // Try to get the best quality URL
          if (mediaData.s?.gif) {
            imageUrl = mediaData.s.gif;
          } else if (mediaData.s?.mp4) {
            imageUrl = mediaData.s.mp4;
          } else if (mediaData.s?.u) {
            imageUrl = mediaData.s.u;
          } else if (mediaData.p?.length > 0) {
            imageUrl = mediaData.p[mediaData.p.length - 1].u;
          }
          
          if (imageUrl) {
            const cleanedUrl = cleanUrl(imageUrl);
            extractedUrls.push(cleanedUrl);
            console.log(`рџ“ё Extracted gallery image: ${cleanedUrl}`);
          }
        }
      }
    }
    
    // 3. Check for direct image URL (only if we haven't found anything yet)
    if (!extractedUrls.length && postData.url) {
      const urlLower = postData.url.toLowerCase();
      // Check if it's a direct image/video link
      if (urlLower.includes('.jpg') || urlLower.includes('.jpeg') || 
          urlLower.includes('.png') || urlLower.includes('.gif') ||
          urlLower.includes('.mp4') || urlLower.includes('.webm') ||
          urlLower.includes('i.redd.it') || urlLower.includes('v.redd.it')) {
        const cleanedUrl = cleanUrl(postData.url);
        extractedUrls.push(cleanedUrl);
        console.log(`рџ–јпёЏ Extracted direct media: ${cleanedUrl}`);
      }
      // Also check for redgifs links
      else if (urlLower.includes('redgifs.com')) {
        const cleanedUrl = cleanUrl(postData.url);
        extractedUrls.push(cleanedUrl);
        console.log(`рџЋ¬ Extracted Redgif link: ${cleanedUrl}`);
      }
    }
    
    // 4. Also check url_overridden_by_dest for redgifs
    if (postData.url_overridden_by_dest && !extractedUrls.length) {
      const urlLower = postData.url_overridden_by_dest.toLowerCase();
      if (urlLower.includes('redgifs.com')) {
        const cleanedUrl = cleanUrl(postData.url_overridden_by_dest);
        extractedUrls.push(cleanedUrl);
        console.log(`рџЋ¬ Extracted Redgif from url_overridden_by_dest: ${cleanedUrl}`);
      }
    }
    
    if (extractedUrls.length === 0) {
      console.log('вќЊ No media URLs extracted from Reddit post');
      return null;
    }
    
    return {
      urls: extractedUrls,
      title: postData.title,
      subreddit: postData.subreddit,
      author: postData.author,
      source: 'reddit',
      hasGallery: !!postData.media_metadata,
      hasVideo: hasVideo
    };
    
  } catch (error) {
    console.error(`вќЊ Error extracting Reddit content:`, error.message);
    return null;
  }
};

// ========== URL RESOLVER ==========
const resolveUrl = async (shortUrl) => {
  try {
    console.log(`рџ”„ Resolving URL: ${shortUrl}`);
    
    const response = await axios.get(shortUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      maxRedirects: 5,
      timeout: 5000
    });
    
    // Get the final URL after redirects
    const finalUrl = response.request.res.responseUrl;
    console.log(`вњ… Resolved: ${shortUrl} -> ${finalUrl}`);
    
    return finalUrl;
  } catch (error) {
    console.error(`вќЊ Failed to resolve ${shortUrl}:`, error.message);
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
  console.log(`вњ… Bot online as ${client.user.tag}`);
  console.log(`рџ”Ќ Monitoring ${TARGET_BOT_IDS.length} bots`);
  
  client.user.setPresence({
    activities: [{ name: 'Cleaning links...', type: ActivityType.Watching }],
    status: 'online'
  });
};

client.once('clientReady', setupBot);
client.once('ready', setupBot);

// ========== MESSAGE PROCESSING ==========
client.on('messageCreate', async (message) => {
  if (message.author.id === client.user.id) return;
  if (!TARGET_BOT_IDS.includes(message.author.id)) return;
  
  console.log(`рџ“Ё From: ${message.author.tag} in #${message.channel.name}`);
  
  // Log to log channel
  try {
    const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
    if (logChannel) {
      const truncatedContent = message.content.length > 500 
        ? message.content.substring(0, 500) + '...' 
        : message.content;
      
      await logChannel.send(
        `рџ”Ќ Processing message from **${message.author.tag}** in <#${message.channel.id}>\n` +
        `рџ“ќ **Content:**\n${truncatedContent}`
      );
    }
  } catch (error) {
    console.error('Failed to send log:', error);
  }
  
  // Extract URLs
  const urlPattern = /https?:\/\/[^\s<>\"]+/gi;
  const allUrls = message.content.match(urlPattern);
  
  if (!allUrls) return;
  
  // Extract post info from message
  const postInfo = extractPostInfo(message.content);
  
  // Process URLs
  const allowedUrls = [];
  const blockedUrls = [];
  const redgifFallbackUrls = []; // 🆕 Store RedGIFs links for fallback
  const seenUrls = new Set();
  let extractedResult = null;
  
  // First, try to extract content from redd.it URLs
  for (const url of allUrls) {
    if (url.includes('redd.it/')) {
      // Resolve the short URL first
      const resolvedUrl = await resolveUrl(url);
      
      if (resolvedUrl) {
        // Try to extract Reddit content
        extractedResult = await extractRedditContent(resolvedUrl);
        if (extractedResult) {
          console.log(`вњ… Successfully extracted Reddit content from ${url}`);
          break;
        }
      }
    }
  }
  
  // Process all URLs (skip the one we extracted from if successful)
  for (const url of allUrls) {
    // Skip redd.it URLs if we successfully extracted content from them
    if (extractedResult && url.includes('redd.it/')) {
      console.log(`вЏ­пёЏ Skipping ${url} (already extracted Reddit content)`);
      continue;
    }
    
    const cleanedUrl = cleanUrl(url);
    
    // Skip duplicates
    if (seenUrls.has(cleanedUrl)) {
      console.log(`рџљ« Duplicate skipped: ${cleanedUrl}`);
      continue;
    }
    seenUrls.add(cleanedUrl);
    
    const urlLower = cleanedUrl.toLowerCase();
    
    // Twitter/X links are always allowed
    if (urlLower.includes('x.com/') || urlLower.includes('twitter.com/')) {
      allowedUrls.push(cleanedUrl);
      continue;
    }
    
    // 🔁 RedGIFs are NOT allowed yet – we store them as a last resort fallback
    if (urlLower.includes('redgifs.com')) {
      redgifFallbackUrls.push(cleanedUrl);
      console.log(`рџ“¦ Stored RedGIFs link for fallback: ${cleanedUrl}`);
      continue; // Don't add to allowed or blocked yet
    }
    
    // Check allowed extensions
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
    }
  }
  
  // Combine all allowed URLs
  const allAllowedUrls = [...allowedUrls];
  if (extractedResult) {
    // Add extracted URLs (checking for duplicates)
    for (const extractedUrl of extractedResult.urls) {
      if (!seenUrls.has(extractedUrl)) {
        allAllowedUrls.push(extractedUrl);
        seenUrls.add(extractedUrl);
      }
    }
  }
  
  // 🆕 FALLBACK: If we have NO allowed URLs but we collected RedGIFs links, use them
  if (allAllowedUrls.length === 0 && redgifFallbackUrls.length > 0) {
    console.log(`⚠️ No media found – falling back to RedGIFs links`);
    allAllowedUrls.push(...redgifFallbackUrls);
    // Also log this fallback event
    try {
      const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
      if (logChannel) {
        await logChannel.send(
          `⚠️ **Fallback activated** – No Discord‑friendly media found, using RedGIFs links.\n` +
          `• From: **${message.author.tag}**\n` +
          `• RedGIFs URLs: ${redgifFallbackUrls.length}`
        );
      }
    } catch (error) {
      console.error('Failed to send fallback log:', error);
    }
  }
  
  // Log analysis
  try {
    const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
    if (logChannel) {
      const extractionInfo = extractedResult ? 
        `\nвЂў Reddit content: ${extractedResult.urls.length} items` +
        (extractedResult.hasGallery ? ' (gallery)' : '') +
        (extractedResult.hasVideo ? ' (video)' : '') : '';
      
      await logChannel.send(
        `рџ”— **Analysis:**\n` +
        `вЂў From: **${message.author.tag}**\n` +
        `вЂў Title: ${extractedResult ? extractedResult.title : postInfo.title}\n` +
        `вЂў Subreddit: r/${extractedResult ? extractedResult.subreddit : postInfo.subreddit}\n` +
        `вЂў URLs: ${allUrls.length} total, ${allAllowedUrls.length} allowed, ${blockedUrls.length} blocked` +
        extractionInfo
      );
    }
  } catch (error) {
    console.error('Failed to send analysis log:', error);
  }
  
  // If nothing allowed, just delete and return
  if (allAllowedUrls.length === 0 && blockedUrls.length > 0) {
    await message.delete();
    return;
  }
  
  // Post cleaned message
  if (allAllowedUrls.length > 0) {
    try {
      await message.delete();
      
      // Use extracted info if available, otherwise use post info
      const finalTitle = extractedResult ? extractedResult.title : postInfo.title;
      const finalSubreddit = extractedResult ? extractedResult.subreddit : postInfo.subreddit;
      const finalAuthor = extractedResult ? extractedResult.author : postInfo.author;
      const hasGallery = extractedResult ? extractedResult.hasGallery : false;
      const hasVideo = extractedResult ? extractedResult.hasVideo : false;
      
      // 🕐 DELAY BEFORE REPOSTING – prevents rate‑limit issues
      await delay(REPOST_DELAY_MS);
      
      // Use the new formatMessage function
      await formatMessage(
        message.channel,
        finalTitle,
        finalSubreddit,
        finalAuthor,
        allAllowedUrls,
        hasGallery,
        hasVideo
      );
      
      // Log success
      try {
        const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
        if (logChannel) {
          const extractionSuccess = extractedResult ? 
            `\nвЂў Reddit content extracted: ${extractedResult.urls.length} items` : '';
          
          await logChannel.send(
            `вњ… **Cleaned:**\n` +
            `вЂў From: **${message.author.tag}**\n` +
            `вЂў Posted: ${allAllowedUrls.length} URLs\n` +
            `вЂў Blocked: ${blockedUrls.length} URLs` +
            extractionSuccess
          );
        }
      } catch (error) {
        console.error('Failed to send success log:', error);
      }
      
    } catch (error) {
      console.error(`Error: ${error.message}`);
      
      try {
        const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
        if (logChannel) {
          await logChannel.send(
            `вќЊ **Error:** ${error.message}\n` +
            `вЂў From: **${message.author.tag}**`
          );
        }
      } catch (logError) {
        console.error('Failed to send error log:', logError);
      }
    }
  }
});

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('вќЊ BOT_TOKEN not set!');
  process.exit(1);
}

client.login(BOT_TOKEN);
