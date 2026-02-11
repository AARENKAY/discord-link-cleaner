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
// ========== END CONFIG ==========

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

// ========== REDDIT CONTENT EXTRACTOR ==========
const extractRedditContent = async (redditUrl) => {
  try {
    console.log(`🎬 Extracting Reddit content from: ${redditUrl}`);
    
    // Add .json to get the JSON data
    const jsonUrl = `${redditUrl}.json`;
    
    const response = await axios.get(jsonUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 5000
    });
    
    const data = response.data;
    let postData = null;
    
    // Function to search for post data recursively
    const findPostData = (obj) => {
      if (!obj || typeof obj !== 'object') return null;
      
      // Check if this looks like post data (direct format)
      if (obj.title && obj.subreddit) {
        return obj;
      }
      
      // Check if this is the new array format with Listing objects
      if (Array.isArray(obj) && obj[0]?.data?.children?.[0]?.data?.title) {
        return obj[0].data.children[0].data;
      }
      
      // Check if this is a single Listing object format
      if (obj.data?.children?.[0]?.data?.title) {
        return obj.data.children[0].data;
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
    
    postData = findPostData(data);
    
    if (!postData) {
      console.log('❌ Could not find post data in Reddit JSON');
      return null;
    }
    
    console.log(`✅ Found Reddit post: "${postData.title}" in r/${postData.subreddit}`);
    
    const extractedUrls = [];
    let hasVideo = false;
    
    // ===== PRIORITY 1: REDDIT VIDEO PREVIEW =====
    // Check for video content - ONLY preview.reddit_video_preview.fallback_url
    
    // Location 1: preview.reddit_video_preview.fallback_url (HIGHEST PRIORITY)
    if (postData.preview?.reddit_video_preview?.fallback_url) {
      const videoUrl = postData.preview.reddit_video_preview.fallback_url;
      const cleanedUrl = cleanUrl(videoUrl);
      extractedUrls.push(cleanedUrl);
      hasVideo = true;
      console.log(`🎥 PRIORITY: Extracted video from preview: ${cleanedUrl}`);
    }
    // Location 2: crosspost_parent_list (for crossposts)
    else if (postData.crosspost_parent_list?.[0]?.preview?.reddit_video_preview?.fallback_url) {
      const videoUrl = postData.crosspost_parent_list[0].preview.reddit_video_preview.fallback_url;
      const cleanedUrl = cleanUrl(videoUrl);
      extractedUrls.push(cleanedUrl);
      hasVideo = true;
      console.log(`🎥 PRIORITY: Extracted video from crosspost preview: ${cleanedUrl}`);
    }
    
    // ===== ONLY ADD REDGIFS IF NO REDDIT VIDEO WAS FOUND =====
    if (!hasVideo) {
      // Check for redgifs links in url_overridden_by_dest
      if (postData.url_overridden_by_dest && postData.url_overridden_by_dest.toLowerCase().includes('redgifs.com')) {
        const cleanedUrl = cleanUrl(postData.url_overridden_by_dest);
        extractedUrls.push(cleanedUrl);
        console.log(`🎬 Extracted Redgif (no Reddit video found): ${cleanedUrl}`);
      }
      // Check for redgifs links in url
      else if (postData.url && postData.url.toLowerCase().includes('redgifs.com')) {
        const cleanedUrl = cleanUrl(postData.url);
        extractedUrls.push(cleanedUrl);
        console.log(`🎬 Extracted Redgif (no Reddit video found): ${cleanedUrl}`);
      }
      // Check for embeds like Redgifs in secure_media
      else if (postData.secure_media?.oembed?.provider_name === 'RedGIFs') {
        const redgifsUrl = postData.url || postData.url_overridden_by_dest;
        if (redgifsUrl && redgifsUrl.includes('redgifs.com')) {
          const cleanedUrl = cleanUrl(redgifsUrl);
          extractedUrls.push(cleanedUrl);
          console.log(`🎬 Extracted RedGIFs embed (no Reddit video found): ${cleanedUrl}`);
        }
      }
    } else {
      console.log(`⏭️ Skipping RedGIFs link - already have Reddit video`);
    }
    
    // Check for gallery images (only if no video was found)
    if (!hasVideo && postData.media_metadata) {
      console.log(`🎨 Found gallery with ${Object.keys(postData.media_metadata).length} items`);
      
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
            console.log(`📸 Extracted gallery image: ${cleanedUrl}`);
          }
        }
      }
    }
    
    // Check for direct image URL (only if nothing else found)
    if (extractedUrls.length === 0 && postData.url) {
      const urlLower = postData.url.toLowerCase();
      // Check if it's a direct image/video link
      if (urlLower.includes('.jpg') || urlLower.includes('.jpeg') || 
          urlLower.includes('.png') || urlLower.includes('.gif') ||
          urlLower.includes('.gifv') || urlLower.includes('.mp4') || 
          urlLower.includes('.webm') || urlLower.includes('.webp') ||
          urlLower.includes('i.redd.it') || urlLower.includes('v.redd.it')) {
        const cleanedUrl = cleanUrl(postData.url);
        extractedUrls.push(cleanedUrl);
        console.log(`🖼️ Extracted direct media: ${cleanedUrl}`);
      }
    }
    
    if (extractedUrls.length === 0) {
      console.log('❌ No media URLs extracted from Reddit post');
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
    console.error(`❌ Error extracting Reddit content:`, error.message);
    return null;
  }
};

// ========== URL RESOLVER ==========
const resolveUrl = async (shortUrl) => {
  try {
    console.log(`🔄 Resolving URL: ${shortUrl}`);
    
    const response = await axios.get(shortUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      maxRedirects: 5,
      timeout: 5000
    });
    
    // Get the final URL after redirects
    const finalUrl = response.request.res.responseUrl;
    console.log(`✅ Resolved: ${shortUrl} -> ${finalUrl}`);
    
    return finalUrl;
  } catch (error) {
    console.error(`❌ Failed to resolve ${shortUrl}:`, error.message);
    return null;
  }
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
  await channel.send(`▪️▫️▪️▫️▪️▫️`);
};

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
  
  // Log to log channel
  try {
    const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
    if (logChannel) {
      const truncatedContent = message.content.length > 500 
        ? message.content.substring(0, 500) + '...' 
        : message.content;
      
      await logChannel.send(
        `🔍 Processing message from **${message.author.tag}** in <#${message.channel.id}>\n` +
        `📝 **Content:**\n${truncatedContent}`
      );
    }
  } catch (error) {
    console.error('Failed to send log:', error);
  }
  
  // Extract URLs - FIXED to handle angle brackets
  const urlPattern = /https?:\/\/[^\s\"]+/gi;
  // Remove angle brackets before matching
  const cleanContent = message.content.replace(/<|>/g, '');
  const allUrls = cleanContent.match(urlPattern);
  
  if (!allUrls) return;
  
  // Extract post info from message
  const postInfo = extractPostInfo(message.content);
  
  // Process URLs
  const allowedUrls = [];
  const blockedUrls = [];
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
          console.log(`✅ Successfully extracted Reddit content from ${url}`);
          break;
        }
      }
    }
  }
  
  // Process all URLs (skip the one we extracted from if successful)
  for (const url of allUrls) {
    // Skip redd.it URLs if we successfully extracted content from them
    if (extractedResult && url.includes('redd.it/')) {
      console.log(`⏭️ Skipping ${url} (already extracted Reddit content)`);
      continue;
    }
    
    const cleanedUrl = cleanUrl(url);
    
    // Skip duplicates
    if (seenUrls.has(cleanedUrl)) {
      console.log(`🚫 Duplicate skipped: ${cleanedUrl}`);
      continue;
    }
    seenUrls.add(cleanedUrl);
    
    const urlLower = cleanedUrl.toLowerCase();
    
    // Twitter/X links are always allowed
    if (urlLower.includes('x.com/') || urlLower.includes('twitter.com/')) {
      allowedUrls.push(cleanedUrl);
      console.log(`✅ Allowed Twitter/X: ${cleanedUrl}`);
      continue;
    }
    
    // Check if this URL is one of our extracted Reddit video URLs
    const isExtractedVideo = extractedResult?.urls?.includes(cleanedUrl);
    
    // Check allowed extensions
    let hasAllowedExtension = false;
    
    if (isExtractedVideo) {
      // Extracted Reddit videos ALWAYS have .mp4 extension - ALLOW THEM
      hasAllowedExtension = true;
      allowedUrls.push(cleanedUrl);
      console.log(`✅ Allowed extracted Reddit video: ${cleanedUrl}`);
    } else {
      // Check original URLs against allowed extensions
      for (const ext of ALLOWED_EXTENSIONS) {
        if (urlLower.includes(ext) || urlLower.endsWith(ext)) {
          hasAllowedExtension = true;
          allowedUrls.push(cleanedUrl);
          console.log(`✅ Allowed URL with extension: ${cleanedUrl}`);
          break;
        }
      }
    }
    
    if (!hasAllowedExtension) {
      blockedUrls.push(cleanedUrl);
      console.log(`🚫 Blocked: ${cleanedUrl} (no allowed extension)`);
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
        console.log(`➕ Added extracted URL: ${extractedUrl}`);
      }
    }
  }
  
  // Log analysis
  try {
    const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
    if (logChannel) {
      const extractionInfo = extractedResult ? 
        `\n• Reddit content: ${extractedResult.urls.length} items` +
        (extractedResult.hasGallery ? ' (gallery)' : '') +
        (extractedResult.hasVideo ? ' (video)' : '') : '';
      
      await logChannel.send(
        `🔗 **Analysis:**\n` +
        `• From: **${message.author.tag}**\n` +
        `• Title: ${extractedResult ? extractedResult.title : postInfo.title}\n` +
        `• Subreddit: r/${extractedResult ? extractedResult.subreddit : postInfo.subreddit}\n` +
        `• URLs: ${allUrls.length} total, ${allAllowedUrls.length} allowed, ${blockedUrls.length} blocked` +
        extractionInfo
      );
    }
  } catch (error) {
    console.error('Failed to send analysis log:', error);
  }
  
  // If nothing allowed, just delete and return
  if (allAllowedUrls.length === 0 && blockedUrls.length > 0) {
    await message.delete();
    console.log(`🗑️ Deleted message - no allowed URLs`);
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
      
      await formatMessage(
        message.channel,
        finalTitle,
        finalSubreddit,
        finalAuthor,
        allAllowedUrls,
        hasGallery,
        hasVideo
      );
      
      console.log(`✅ Posted cleaned message with ${allAllowedUrls.length} URLs`);
      
      // Log success
      try {
        const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
        if (logChannel) {
          const extractionSuccess = extractedResult ? 
            `\n• Reddit content extracted: ${extractedResult.urls.length} items` : '';
          
          await logChannel.send(
            `✅ **Cleaned:**\n` +
            `• From: **${message.author.tag}**\n` +
            `• Posted: ${allAllowedUrls.length} URLs\n` +
            `• Blocked: ${blockedUrls.length} URLs` +
            extractionSuccess
          );
        }
      } catch (error) {
        console.error('Failed to send success log:', error);
      }
      
    } catch (error) {
      console.error(`❌ Error: ${error.message}`);
      
      try {
        const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
        if (logChannel) {
          await logChannel.send(
            `❌ **Error:** ${error.message}\n` +
            `• From: **${message.author.tag}**`
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
  console.error('❌ BOT_TOKEN not set!');
  process.exit(1);
}

client.login(BOT_TOKEN);
