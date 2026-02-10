const express = require('express');
const { Client, GatewayIntentBits, ActivityType, EmbedBuilder } = require('discord.js');
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

const ALLOWED_WEBSITES = [
  'redgifs.com'
  // Add more allowed websites here in the future
  // Example: 'example.com', 'another-site.com'
];

const LOG_CHANNEL_ID = '1470005338483982400';
// ========== END CONFIG ==========

// ========== URL CONVERSION FUNCTIONS ==========
const convertPreviewToIreddit = (url) => {
  // Convert preview.redd.it URLs to i.redd.it URLs
  if (url && url.includes('preview.redd.it')) {
    // Extract the filename from the preview URL
    // Example: https://preview.redd.it/bqndmrj4boig1.png?width=320&format=png -> https://i.redd.it/bqndmrj4boig1.png
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const filename = pathname.split('/').pop();
    
    // Determine the actual file extension (remove any format parameters)
    let extension = '.png'; // Default
    if (filename.includes('.jpg') || filename.includes('.jpeg')) {
      extension = '.jpg';
    } else if (filename.includes('.gif')) {
      extension = '.gif';
    } else if (filename.includes('.png')) {
      extension = '.png';
    } else if (filename.includes('.webp')) {
      extension = '.webp';
    }
    
    // Get the base filename without any .gif?format= etc.
    const baseFilename = filename.split('.')[0];
    return `https://i.redd.it/${baseFilename}${extension}`;
  }
  return url;
};

const convertTwitterToVxtwitter = (url) => {
  // Convert Twitter/X links to vxtwitter.com
  if (url && (url.includes('x.com/') || url.includes('twitter.com/'))) {
    return url.replace(/https?:\/\/(www\.)?(x\.com|twitter\.com)/i, 'https://vxtwitter.com');
  }
  return url;
};

const cleanUrl = (url) => {
  if (!url) return url;
  
  // First convert preview.redd.it to i.redd.it
  let cleanUrl = convertPreviewToIreddit(url);
  
  // Then convert Twitter/X to vxtwitter
  cleanUrl = convertTwitterToVxtwitter(cleanUrl);
  
  // Remove query parameters and trailing slashes
  cleanUrl = cleanUrl.split('?')[0].trim();
  cleanUrl = cleanUrl.replace(/\/+$/, '');
  
  return cleanUrl;
};

// ========== REDDIT URL RESOLVER ==========
const resolveRedditUrl = async (shortenedUrl) => {
  try {
    // Add headers to mimic a browser
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Cache-Control': 'max-age=0'
    };
    
    // Make a request to the shortened URL
    const response = await axios.get(shortenedUrl, { 
      maxRedirects: 5,
      headers: headers,
      timeout: 10000
    });
    
    // Extract the full post URL from the response
    let fullUrl = response.request.res.responseUrl || shortenedUrl;
    console.log(`🔄 Resolved URL: ${shortenedUrl} -> ${fullUrl}`);
    
    // If it's a redd.it link that resolves to a gallery, get the proper JSON URL
    if (fullUrl.includes('/gallery/')) {
      // Extract the post ID from gallery URL
      const galleryMatch = fullUrl.match(/\/gallery\/([a-zA-Z0-9]+)/);
      if (galleryMatch) {
        const postId = galleryMatch[1];
        // Try to get the comments JSON URL instead
        fullUrl = `https://www.reddit.com/comments/${postId}/`;
      }
    }
    
    // Get the proper JSON URL
    const jsonUrl = `${fullUrl}.json`;
    return { fullUrl, jsonUrl };
  } catch (error) {
    console.error('❌ Error resolving Reddit URL:', error.message);
    return null;
  }
};

// ========== MESSAGE FORMATTING FUNCTIONS ==========
const formatConsolidatedMessage = (title, subreddit, author, urls, isGallery = false, galleryInfo = null) => {
  let message = `**${title}**\n\n`;
  message += `*Posted in r/${subreddit} by ${author}*\n\n`;
  
  if (isGallery && galleryInfo) {
    const { totalItems, animatedCount, staticCount } = galleryInfo;
    
    if (animatedCount > 0 && staticCount > 0) {
      message += `*Gallery:* ${totalItems} images (${animatedCount} GIFs, ${staticCount} static)\n\n`;
    } else if (animatedCount > 0) {
      message += `*Gallery:* ${totalItems} GIF${totalItems > 1 ? 's' : ''}\n\n`;
    } else {
      message += `*Gallery:* ${totalItems} image${totalItems > 1 ? 's' : ''}\n\n`;
    }
  } else if (urls.length > 1) {
    message += `*Images:* ${urls.length}\n\n`;
  }
  
  // Add all URLs
  for (const url of urls) {
    message += `${url}\n`;
  }
  
  return message;
};

const formatSingleLinkMessage = (title, subreddit, author, url) => {
  let message = `**${title}**\n\n`;
  message += `*Posted in r/${subreddit} by ${author}*\n\n`;
  message += `${url}`;
  
  return message;
};

const extractPostInfoFromMessage = (messageContent) => {
  // Try to extract title from common Reddit bot formats
  const titlePattern = /\*\*(.*?)\*\*/; // Look for bold text (common in Reddit bot titles)
  const subredditPattern = /r\/([\w]+)/i;
  const authorPattern = /\*by\s+([\w-]+)\*/i; // Matches "*by username*"
  
  const titleMatch = messageContent.match(titlePattern);
  const subredditMatch = messageContent.match(subredditPattern);
  const authorMatch = messageContent.match(authorPattern);
  
  return {
    title: titleMatch ? titleMatch[1].trim() : 'Reddit Post',
    subreddit: subredditMatch ? subredditMatch[1] : 'unknown',
    author: authorMatch ? authorMatch[1] : 'unknown'
  };
};

const processRedditGallery = async (jsonUrl, message) => {
  try {
    console.log(`🎨 Processing Reddit gallery: ${jsonUrl}`);
    
    // Add proper headers for Reddit API
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
    };
    
    const response = await axios.get(jsonUrl, { 
      headers: headers,
      timeout: 10000
    });
    
    // Handle different Reddit JSON structures
    let postData;
    if (Array.isArray(response.data)) {
      // Standard Reddit JSON structure
      postData = response.data[0].data.children[0].data;
    } else if (response.data.kind === 'Listing') {
      // Alternative structure
      postData = response.data.data.children[0].data;
    } else {
      console.error('❌ Unexpected Reddit JSON structure');
      return null;
    }
    
    // Check if it's a gallery
    if (postData.media_metadata || postData.gallery_data) {
      console.log(`🎨 Found gallery with ${postData.media_metadata ? Object.keys(postData.media_metadata).length : postData.gallery_data.items.length} items`);
      
      const allItems = [];
      
      // Process media_metadata if available
      if (postData.media_metadata) {
        for (const [mediaId, mediaData] of Object.entries(postData.media_metadata)) {
          if (mediaData.status === 'valid') {
            // Get the highest quality image available
            let imageUrl = '';
            let isAnimated = false;
            
            // Priority 1: Direct GIF URL from mediaData.s.gif
            if (mediaData.s && mediaData.s.gif) {
              imageUrl = mediaData.s.gif.replace(/&amp;/g, '&');
              isAnimated = true;
            } 
            // Priority 2: MP4 URL for animated content
            else if (mediaData.s && mediaData.s.mp4) {
              imageUrl = mediaData.s.mp4.replace(/&amp;/g, '&');
              isAnimated = true;
            }
            // Priority 3: Direct image URL from mediaData.s.u
            else if (mediaData.s && mediaData.s.u) {
              imageUrl = mediaData.s.u.replace(/&amp;/g, '&');
              // Check if it's a GIF
              isAnimated = imageUrl.toLowerCase().includes('.gif') || 
                          imageUrl.toLowerCase().includes('format=gif') ||
                          imageUrl.toLowerCase().includes('gif');
            }
            
            // If we found a URL, clean it
            if (imageUrl) {
              // Convert preview.redd.it to i.redd.it
              imageUrl = convertPreviewToIreddit(imageUrl);
              
              allItems.push({
                originalUrl: imageUrl,
                cleanUrl: cleanUrl(imageUrl),
                isAnimated: isAnimated
              });
            }
          }
        }
      } else if (postData.gallery_data) {
        // Fallback: if we have gallery_data but no media_metadata
        console.log('⚠️ Using gallery_data structure (media_metadata not found)');
        
        // Try to get URLs from crosspost_media or preview images
        if (postData.preview && postData.preview.images) {
          for (const image of postData.preview.images) {
            if (image.source && image.source.url) {
              let imageUrl = image.source.url.replace(/&amp;/g, '&');
              imageUrl = convertPreviewToIreddit(imageUrl);
              
              allItems.push({
                originalUrl: imageUrl,
                cleanUrl: cleanUrl(imageUrl),
                isAnimated: imageUrl.toLowerCase().includes('.gif')
              });
            }
          }
        }
      }
      
      if (allItems.length > 0) {
        console.log(`🎨 Extracted ${allItems.length} items (${allItems.filter(item => item.isAnimated).length} animated)`);
        
        // Check for duplicates within the gallery
        const uniqueItems = [];
        const seenUrls = new Set();
        
        for (const item of allItems) {
          if (!seenUrls.has(item.cleanUrl)) {
            seenUrls.add(item.cleanUrl);
            uniqueItems.push(item);
          } else {
            console.log(`🚫 Duplicate URL skipped: ${item.cleanUrl}`);
          }
        }
        
        if (uniqueItems.length < allItems.length) {
          console.log(`🚫 Removed ${allItems.length - uniqueItems.length} duplicate(s) from gallery`);
        }
        
        const animatedCount = uniqueItems.filter(item => item.isAnimated).length;
        const staticCount = uniqueItems.length - animatedCount;
        
        // Prepare URLs for posting
        const cleanedUrls = uniqueItems.map(item => item.cleanUrl);
        
        return {
          title: postData.title || 'Reddit Gallery',
          subreddit: postData.subreddit || 'unknown',
          author: postData.author || 'unknown',
          urls: cleanedUrls,
          isGallery: true,
          galleryInfo: {
            totalItems: uniqueItems.length,
            animatedCount: animatedCount,
            staticCount: staticCount
          }
        };
      } else {
        console.log('⚠️ No media items extracted from gallery');
      }
    }
  } catch (error) {
    console.error('❌ Error processing Reddit gallery:', error.message);
    console.error('Error details:', error.response ? {
      status: error.response.status,
      statusText: error.response.statusText,
      url: error.response.config.url
    } : 'No response details');
  }
  
  return null;
};

// Define the setup function
const setupBot = () => {
  console.log(`✅ Bot online as ${client.user.tag}`);
  console.log(`🔍 Monitoring ${TARGET_BOT_IDS.length} bots`);
  console.log(`🌐 Allowed websites: ${ALLOWED_WEBSITES.join(', ') || 'None'}`);
  
  client.user.setPresence({
    activities: [{ name: 'Cleaning links...', type: ActivityType.Watching }],
    status: 'online'
  });
};

// Use clientReady (future-proof) and ready (for compatibility)
client.once('clientReady', setupBot);
client.once('ready', setupBot); // Fallback for older Discord.js versions

client.on('messageCreate', async (message) => {
  // Skip bot's own messages
  if (message.author.id === client.user.id) return;
  
  // Only process target bots
  if (!TARGET_BOT_IDS.includes(message.author.id)) return;
  
  console.log(`📨 From: ${message.author.tag} in #${message.channel.name}`);
  console.log(`📝 Original content: ${message.content}`);
  
  // Log message processing to log channel
  try {
    const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
    if (logChannel) {
      // Truncate long messages to avoid Discord's character limit
      const truncatedContent = message.content.length > 1000 
        ? message.content.substring(0, 1000) + '...' 
        : message.content;
      
      await logChannel.send(
        `🔍 Processing message from **${message.author.tag}** in <#${message.channel.id}>\n` +
        `📝 **Original content:**\n${truncatedContent}`
      );
    }
  } catch (error) {
    console.error('Failed to send log to log channel:', error);
  }
  
  const urlPattern = /https?:\/\/[^\s<>\"]+/gi;
  const allUrls = message.content.match(urlPattern);
  
  if (!allUrls) return;
  
  const allowedUrls = [];
  const blockedUrls = [];
  const redditShortUrls = [];
  
  // Track seen URLs to avoid duplicates
  const seenUrls = new Set();
  
  // Extract post info from original message
  const postInfo = extractPostInfoFromMessage(message.content);
  let galleryResult = null;
  
  // First, separate redd.it short URLs
  for (const url of allUrls) {
    const urlLower = url.toLowerCase();
    
    // Check if it's a redd.it short URL
    if (urlLower.includes('redd.it/')) {
      // Clean the URL for duplicate checking
      const cleanShortUrl = cleanUrl(url);
      if (!seenUrls.has(cleanShortUrl)) {
        seenUrls.add(cleanShortUrl);
        redditShortUrls.push(url);
      } else {
        console.log(`🚫 Duplicate redd.it URL skipped: ${cleanShortUrl}`);
      }
    } else {
      // Clean the URL for duplicate checking
      const cleanUrlStr = cleanUrl(url);
      
      // Skip if already seen
      if (seenUrls.has(cleanUrlStr)) {
        console.log(`🚫 Duplicate URL skipped: ${cleanUrlStr}`);
        continue;
      }
      seenUrls.add(cleanUrlStr);
      
      // Check if URL is from Twitter/X
      const isTwitterLink = urlLower.includes('x.com/') || urlLower.includes('twitter.com/');
      
      // Twitter/X links are always allowed (they'll be converted to vxtwitter)
      if (isTwitterLink) {
        allowedUrls.push(url);
        continue;
      }
      
      // Check if URL is from an allowed website
      let isAllowedWebsite = false;
      for (const website of ALLOWED_WEBSITES) {
        if (urlLower.includes(website)) {
          isAllowedWebsite = true;
          allowedUrls.push(url);
          break;
        }
      }
      
      if (isAllowedWebsite) continue;
      
      // Check for allowed file extensions
      let hasAllowedExtension = false;
      for (const ext of ALLOWED_EXTENSIONS) {
        if (urlLower.includes(ext) || urlLower.includes(ext + '?') || urlLower.endsWith(ext)) {
          hasAllowedExtension = true;
          break;
        }
      }
      
      if (hasAllowedExtension) {
        allowedUrls.push(url);
      } else {
        blockedUrls.push(url);
      }
    }
  }
  
  // Process redd.it URLs
  if (redditShortUrls.length > 0) {
    console.log(`🔄 Processing ${redditShortUrls.length} redd.it short URLs`);
    
    for (const shortUrl of redditShortUrls) {
      try {
        const resolved = await resolveRedditUrl(shortUrl);
        if (resolved) {
          const { fullUrl, jsonUrl } = resolved;
          
          // Try to process as gallery first
          galleryResult = await processRedditGallery(jsonUrl, message);
          
          if (!galleryResult) {
            // Not a gallery, treat as regular URL
            // Check if the resolved URL has allowed extensions
            const fullUrlLower = fullUrl.toLowerCase();
            let hasAllowedExtension = false;
            for (const ext of ALLOWED_EXTENSIONS) {
              if (fullUrlLower.includes(ext) || fullUrlLower.includes(ext + '?') || fullUrlLower.endsWith(ext)) {
                hasAllowedExtension = true;
                break;
              }
            }
            
            if (hasAllowedExtension) {
              // Clean and check for duplicates
              const cleanFullUrl = cleanUrl(fullUrl);
              if (!seenUrls.has(cleanFullUrl)) {
                seenUrls.add(cleanFullUrl);
                allowedUrls.push(fullUrl);
              } else {
                console.log(`🚫 Duplicate resolved URL skipped: ${cleanFullUrl}`);
              }
            } else {
              // Check if the domain is in allowed websites
              let isAllowedWebsite = false;
              for (const website of ALLOWED_WEBSITES) {
                if (fullUrlLower.includes(website)) {
                  isAllowedWebsite = true;
                  const cleanFullUrl = cleanUrl(fullUrl);
                  if (!seenUrls.has(cleanFullUrl)) {
                    seenUrls.add(cleanFullUrl);
                    allowedUrls.push(fullUrl);
                  } else {
                    console.log(`🚫 Duplicate resolved URL skipped: ${cleanFullUrl}`);
                  }
                  break;
                }
              }
              
              if (!isAllowedWebsite) {
                blockedUrls.push(shortUrl);
              }
            }
          }
        } else {
          // If can't resolve, treat as regular URL for filtering
          const urlLower = shortUrl.toLowerCase();
          let hasAllowedExtension = false;
          for (const ext of ALLOWED_EXTENSIONS) {
            if (urlLower.includes(ext)) {
              hasAllowedExtension = true;
              const cleanShortUrl = cleanUrl(shortUrl);
              if (!seenUrls.has(cleanShortUrl)) {
                seenUrls.add(cleanShortUrl);
                allowedUrls.push(shortUrl);
              } else {
                console.log(`🚫 Duplicate unresolved URL skipped: ${cleanShortUrl}`);
              }
              break;
            }
          }
          
          if (!hasAllowedExtension) {
            blockedUrls.push(shortUrl);
          }
        }
        
        // Add a small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`❌ Error processing redd.it URL ${shortUrl}:`, error.message);
        blockedUrls.push(shortUrl);
      }
    }
  }
  
  // Log link analysis results
  try {
    const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
    if (logChannel) {
      // Create a summary of blocked URLs (truncated if too many)
      let blockedSummary = '';
      if (blockedUrls.length > 0) {
        const blockedToShow = blockedUrls.slice(0, 3); // Show first 3 blocked URLs
        blockedSummary = `• Blocked URLs: ${blockedToShow.join(', ')}`;
        if (blockedUrls.length > 3) {
          blockedSummary += ` (+${blockedUrls.length - 3} more)`;
        }
        blockedSummary += '\n';
      }
      
      const redditProcessedInfo = redditShortUrls.length > 0 ? 
        `• Reddit short URLs: ${redditShortUrls.length} processed\n` : '';
      
      const galleryInfo = galleryResult ? 
        `• Gallery detected: ${galleryResult.urls.length} items\n` : '';
      
      const duplicateInfo = allUrls.length > (allowedUrls.length + blockedUrls.length + (galleryResult ? galleryResult.urls.length : 0)) ?
        `• Duplicates removed: ${allUrls.length - (allowedUrls.length + blockedUrls.length + (galleryResult ? galleryResult.urls.length : 0))}\n` : '';
      
      await logChannel.send(
        `🔗 **Link Analysis:**\n` +
        `• From: **${message.author.tag}** in <#${message.channel.id}>\n` +
        `• Title: ${galleryResult ? galleryResult.title : postInfo.title}\n` +
        `• Subreddit: r/${galleryResult ? galleryResult.subreddit : postInfo.subreddit}\n` +
        `• Author: ${galleryResult ? galleryResult.author : postInfo.author}\n` +
        `• Total URLs found: ${allUrls.length}\n` +
        `• Unique URLs processed: ${allowedUrls.length + blockedUrls.length + (galleryResult ? galleryResult.urls.length : 0)}\n` +
        `${duplicateInfo}` +
        `• Allowed: ${allowedUrls.length + (galleryResult ? galleryResult.urls.length : 0)}\n` +
        `• Blocked: ${blockedUrls.length}\n` +
        `${redditProcessedInfo}` +
        `${galleryInfo}` +
        `${blockedSummary}` +
        `• Action: ${allowedUrls.length === 0 && !galleryResult ? 'Delete only' : 'Delete & repost'}`
      );
    }
  } catch (error) {
    console.error('Failed to send log to log channel:', error);
  }
  
  if (allowedUrls.length === 0 && !galleryResult && blockedUrls.length > 0) {
    await message.delete();
    return;
  }
  
  if (allowedUrls.length > 0 || galleryResult) {
    try {
      await message.delete();
      
      // Clean and prepare regular URLs
      const cleanedUrls = allowedUrls.map(url => cleanUrl(url));
      
      // Determine which info to use (gallery takes priority)
      const finalTitle = galleryResult ? galleryResult.title : postInfo.title;
      const finalSubreddit = galleryResult ? galleryResult.subreddit : postInfo.subreddit;
      const finalAuthor = galleryResult ? galleryResult.author : postInfo.author;
      
      // Combine gallery URLs and regular URLs
      const allCleanedUrls = galleryResult ? 
        [...galleryResult.urls, ...cleanedUrls] : 
        cleanedUrls;
      
      // Remove any duplicates between gallery and regular URLs
      const uniqueCleanedUrls = [];
      const finalSeenUrls = new Set();
      
      for (const url of allCleanedUrls) {
        if (!finalSeenUrls.has(url)) {
          finalSeenUrls.add(url);
          uniqueCleanedUrls.push(url);
        }
      }
      
      if (uniqueCleanedUrls.length > 0) {
        // Format and send the message
        let formattedMessage;
        
        if (galleryResult && uniqueCleanedUrls.length === galleryResult.urls.length) {
          // If only gallery URLs (or gallery + no additional regular URLs)
          formattedMessage = formatConsolidatedMessage(
            finalTitle,
            finalSubreddit,
            finalAuthor,
            uniqueCleanedUrls,
            galleryResult.isGallery,
            galleryResult.galleryInfo
          );
        } else if (uniqueCleanedUrls.length === 1) {
          // Single URL
          formattedMessage = formatSingleLinkMessage(
            finalTitle,
            finalSubreddit,
            finalAuthor,
            uniqueCleanedUrls[0]
          );
        } else {
          // Multiple URLs (mixed gallery and regular)
          formattedMessage = formatConsolidatedMessage(
            finalTitle,
            finalSubreddit,
            finalAuthor,
            uniqueCleanedUrls,
            false // Not a pure gallery
          );
        }
        
        await message.channel.send(formattedMessage);
      }
      
      // Log successful cleaning
      try {
        const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
        if (logChannel) {
          const twitterLinksConverted = cleanedUrls.filter(url => 
            url.includes('vxtwitter.com')
          ).length;
          
          const redditPreviewConverted = allCleanedUrls.filter(url => 
            url.includes('i.redd.it') && url.includes('preview.redd.it')
          ).length;
          
          const twitterConversionInfo = twitterLinksConverted > 0 ? 
            `• ${twitterLinksConverted} Twitter/X link(s) converted to vxtwitter.com\n` : '';
          
          const redditConversionInfo = redditPreviewConverted > 0 ? 
            `• ${redditPreviewConverted} Reddit preview link(s) converted to i.redd.it\n` : '';
          
          const gallerySuccessInfo = galleryResult ? 
            `• Gallery posted: ${galleryResult.urls.length} item(s)\n` : '';
          
          const duplicateSuccessInfo = allUrls.length > uniqueCleanedUrls.length ?
            `• ${allUrls.length - uniqueCleanedUrls.length} duplicate(s) removed\n` : '';
          
          await logChannel.send(
            `✅ **Cleaning Complete**\n` +
            `• Processed ${uniqueCleanedUrls.length} unique item(s) from **${message.author.tag}** in <#${message.channel.id}>\n` +
            `• Title: ${finalTitle}\n` +
            `• Subreddit: r/${finalSubreddit}\n` +
            `• Author: ${finalAuthor}\n` +
            `${duplicateSuccessInfo}` +
            `${gallerySuccessInfo}` +
            `${twitterConversionInfo}` +
            `${redditConversionInfo}` +
            (blockedUrls.length > 0 ? `• Blocked ${blockedUrls.length} unwanted link(s)` : '')
          );
        }
      } catch (error) {
        console.error('Failed to send completion log:', error);
      }
      
    } catch (error) {
      console.error(`Error: ${error.message}`);
      
      // Log errors with original content for debugging
      try {
        const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
        if (logChannel) {
          const truncatedErrorContent = message.content.length > 500 
            ? message.content.substring(0, 500) + '...' 
            : message.content;
          
          await logChannel.send(
            `❌ **Error processing message:** ${error.message}\n` +
            `• From: **${message.author.tag}**\n` +
            `• Original content: ${truncatedErrorContent}`
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
