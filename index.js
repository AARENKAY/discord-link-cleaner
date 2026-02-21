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
  '1470057771020849266',
  '1471149320257536232',
  '1471842365198303283',
  '1472941497123995690'
];

const ALLOWED_EXTENSIONS = [
  '.mp4', '.gif', '.gifv', '.webm', '.jpg', '.jpeg', '.png', '.webp'
];

const LOG_CHANNEL_ID = '1470005338483982400';
// ========== END CONFIG ==========

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ========== SIMPLE URL FUNCTIONS ==========
const cleanUrl = (url) => {
  if (!url) return url;
  
  let cleaned = url;
  
  // Normalize "www." in RedGIF URLs
  if (cleaned.includes('www.redgifs.com')) {
    cleaned = cleaned.replace('www.', '');
  }
  
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
  
  // Handling Gallery URLs (group of 5)
  if (hasGallery && urls.length > 1) {
    message += `**Gallery:** ${urls.length} images\n\n`;

    // Split the URLs into groups of 5
    for (let i = 0; i < urls.length; i += 5) {
      const group = urls.slice(i, i + 5);
      const galleryLinks = group.map((url, index) => {
        const picNumber = index + 1 + i; // Adjusted index to reflect the full list
        return `[Pic${picNumber}](${url})`;
      }).join(' ');
      
      message += `${galleryLinks}\n\n`;

      // Send the message part after every group of 5
      await channel.send(message);
      message = ''; // Reset the message for the next group
    }
  } 
  // Handling Video URLs
  else if (hasVideo) {
    for (const url of urls) {
      message += `[Video/Gif](${url})\n\n`; // Embed the video URL with a clickable text
    }
  } 
  // Handling Image and GIF URLs (group of 5)
  else if (urls.length > 1) {
    message += `**Images:** ${urls.length}\n\n`;

    // Split the URLs into groups of 5
    for (let i = 0; i < urls.length; i += 5) {
      const group = urls.slice(i, i + 5);
      
      for (const url of group) {
        // Check if the URL is a GIF
        if (url.toLowerCase().endsWith('.gif')) {
          message += `[Gif](${url})\n\n`;
        }
        // Check if the URL is an image (JPEG, PNG, JPG, WebP)
        else if (url.toLowerCase().endsWith('.jpg') || url.toLowerCase().endsWith('.jpeg') || 
                 url.toLowerCase().endsWith('.png') || url.toLowerCase().endsWith('.webp')) {
          message += `[Pic](${url})\n\n`;
        }
        // For other media types (optional, like video or audio)
        else {
          message += `[Media](${url})\n\n`;
        }
      }
      
      // Send the message part after every group of 5
      await channel.send(message);
      message = ''; // Reset the message for the next group
    }
  } else {
    for (const url of urls) {
      // Check if the URL is a GIF
      if (url.toLowerCase().endsWith('.gif')) {
        message += `[Gif](${url})\n\n`;
      }
      // Check if the URL is an image (JPEG, PNG, JPG, WebP)
      else if (url.toLowerCase().endsWith('.jpg') || url.toLowerCase().endsWith('.jpeg') || 
               url.toLowerCase().endsWith('.png') || url.toLowerCase().endsWith('.webp')) {
        message += `[Pic](${url})\n\n`;
      }
      // For other media types (optional, like video or audio)
      else {
        message += `[Media](${url})\n\n`;
      }
    }
  }
  
  // Send final message to the channel if it's not already sent
  if (message.trim()) {
    await channel.send(message);
  }
  await channel.send(`═════════════════════════════════`);
};

// ========== REDDIT CONTENT EXTRACTOR WITH SMART FALLBACK_URL SEARCH ==========
const extractRedditContent = async (redditUrl) => {
  try {
    console.log(`🎬 Extracting Reddit content from: ${redditUrl}`);
    
    const jsonUrl = `${redditUrl}.json`;

	await sleep(1200);  
	  
    const response = await axios.get(jsonUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 5000
    });
    
    const data = response.data;
    console.log('Fetched Reddit JSON:', data); // Log for debugging

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
      if (obj.fallback_url && typeof obj.fallback_url === 'string') return obj.fallback_url;
      if (obj.reddit_video_preview && obj.reddit_video_preview.fallback_url) {
        return obj.reddit_video_preview.fallback_url;
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
      console.log('❌ Could not find post data in Reddit JSON');
      return null;
    }
    
    console.log(`✅ Found Reddit post: "${postData.title}" in r/${postData.subreddit}`);
    
    const extractedUrls = [];
    let hasVideo = false;
    
    // ===== Stable fallback_url detection =====
	  let videoUrl = null;
	
	  // Prefer direct preview fallback when preview is enabled
		if (postData.preview?.reddit_video_preview?.fallback_url &&
		    postData.preview?.enabled !== false) {
		
		  videoUrl = postData.preview.reddit_video_preview.fallback_url;
		  console.log('🎯 Using direct preview.reddit_video_preview fallback_url');
		}
		
		// Otherwise use original recursive finder
		if (!videoUrl) {
		  videoUrl = findFallbackUrl(postData);
		}
    if (videoUrl) {
      const cleanedUrl = cleanUrl(videoUrl);
      extractedUrls.push(cleanedUrl);
      hasVideo = true;
      console.log(`🎥 Extracted video from fallback_url: ${cleanedUrl}`);
    }
    
    // Fallback to Redgifs if no v.redd.it video found
    if (!hasVideo) {
      let redgifUrl = null;
      if (postData.url && postData.url.toLowerCase().includes('redgifs.com')) {
        redgifUrl = cleanUrl(postData.url);
      } else if (postData.url_overridden_by_dest && postData.url_overridden_by_dest.toLowerCase().includes('redgifs.com')) {
        redgifUrl = cleanUrl(postData.url_overridden_by_dest);
      }
      
      if (redgifUrl) {
        extractedUrls.length = 0;
        extractedUrls.push(redgifUrl);
        hasVideo = true;
        console.log(`🎬 Using Redgif link as fallback video: ${redgifUrl}`);
      }
    }
    
    if (!hasVideo && postData.media_metadata) {
      console.log(`📸 Found gallery with ${Object.keys(postData.media_metadata).length} items`);
      
      for (const [id, mediaData] of Object.entries(postData.media_metadata)) {
        if (mediaData.status === 'valid') {
          let imageUrl = '';
          
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
    
    if (!extractedUrls.length && postData.url) {
      const urlLower = postData.url.toLowerCase();
      if (urlLower.includes('.jpg') || urlLower.includes('.jpeg') || 
          urlLower.includes('.png') || urlLower.includes('.gif') ||
          urlLower.includes('.mp4') || urlLower.includes('.webm') ||
          urlLower.includes('i.redd.it') || urlLower.includes('v.redd.it')) {
        const cleanedUrl = cleanUrl(postData.url);
        extractedUrls.push(cleanedUrl);
        console.log(`🖼️ Extracted direct media: ${cleanedUrl}`);
      }
      else if (urlLower.includes('redgifs.com')) {
        const cleanedUrl = cleanUrl(postData.url);
        extractedUrls.push(cleanedUrl);
        console.log(`🎬 Extracted Redgif link: ${cleanedUrl}`);
      }
    }
    
    if (!extractedUrls.length && postData.url_overridden_by_dest) {
      const urlLower = postData.url_overridden_by_dest.toLowerCase();
      if (urlLower.includes('redgifs.com')) {
        const cleanedUrl = cleanUrl(postData.url_overridden_by_dest);
        extractedUrls.push(cleanedUrl);
        console.log(`🎬 Extracted Redgif from url_overridden_by_dest: ${cleanedUrl}`);
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
    console.log(`🔍 Resolving URL: ${shortUrl}`);

	await sleep(1200);  
    
    const response = await axios.get(shortUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      maxRedirects: 5,
      timeout: 5000
    });
    
    const finalUrl = response.request.res.responseUrl;
    console.log(`✅ Resolved: ${shortUrl} -> ${finalUrl}`);
    
    return finalUrl;
  } catch (error) {
    console.error(`❌ Failed to resolve ${shortUrl}:`, error.message);
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
  
  console.log(`📩 From: ${message.author.tag} in #${message.channel.name}`);
  
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
  
  const urlPattern = /https?:\/\/[^\s<>\"]+/gi;
  const allUrls = message.content.match(urlPattern);
  
  if (!allUrls) return;
  
  const postInfo = extractPostInfo(message.content);
  
  const allowedUrls = [];
  const blockedUrls = [];
  const seenUrls = new Set();
  let extractedResult = null;
  
  for (const url of allUrls) {
    if (url.includes('redd.it/')) {
      const resolvedUrl = await resolveUrl(url);
      if (resolvedUrl) {
        extractedResult = await extractRedditContent(resolvedUrl);
        if (extractedResult) {
          console.log(`✅ Successfully extracted Reddit content from ${url}`);
          break;
        }
      }
    }
  }
  
  for (const url of allUrls) {
    if (extractedResult && url.includes('redd.it/')) {
      console.log(`⏭️ Skipping ${url} (already extracted Reddit content)`);
      continue;
    }
    
    const cleanedUrl = cleanUrl(url);
    
    if (seenUrls.has(cleanedUrl)) {
      console.log(`🚫 Duplicate skipped: ${cleanedUrl}`);
      continue;
    }
    seenUrls.add(cleanedUrl);
    
    const urlLower = cleanedUrl.toLowerCase();
    
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
    }
  }
  
  const allAllowedUrls = [...allowedUrls];
  if (extractedResult) {
    for (const extractedUrl of extractedResult.urls) {
      if (!seenUrls.has(extractedUrl)) {
        allAllowedUrls.push(extractedUrl);
        seenUrls.add(extractedUrl);
      }
    }
  }
  
  try {
    const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
    if (logChannel) {
      const extractionInfo = extractedResult ? 
        `\n• Reddit content: ${extractedResult.urls.length} items` +
        (extractedResult.hasGallery ? ' (gallery)' : '') +
        (extractedResult.hasVideo ? ' (video)' : '') : '';
      
      await logChannel.send(
        `🔎 **Analysis:**\n` +
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
  
  if (allAllowedUrls.length === 0 && blockedUrls.length > 0) {
    await message.delete();
    return;
  }
  
  if (allAllowedUrls.length > 0) {
    try {
      await message.delete();
      
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
      
      await sleep(2000);
      
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
      console.error(`Error: ${error.message}`);
      
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
