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

// ========== REDDIT URL RESOLVER ==========
const resolveRedditUrl = async (shortenedUrl) => {
  try {
    // Make a request to the shortened URL
    const response = await axios.get(shortenedUrl, { maxRedirects: 5 });
    
    // Extract the full post URL from the redirection headers
    const fullUrl = response.request.res.responseUrl;
    console.log(`🔄 Resolved URL: ${shortenedUrl} -> ${fullUrl}`);

    // Get the full post data as JSON
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
    
    const response = await axios.get(jsonUrl);
    const postData = response.data[0].data.children[0].data;
    
    // Check if it's a gallery
    if (postData.media_metadata) {
      console.log(`🎨 Found gallery with ${Object.keys(postData.media_metadata).length} items`);
      
      const allItems = [];
      for (const [mediaId, mediaData] of Object.entries(postData.media_metadata)) {
        if (mediaData.status === 'valid') {
          // Get the highest quality image available
          let imageUrl = '';
          let isAnimated = false;
          
          // Check for GIF/MP4 first (animated content)
          if (mediaData.s && mediaData.s.gif) {
            imageUrl = mediaData.s.gif.replace(/&amp;/g, '&');
            isAnimated = true;
          } 
          else if (mediaData.s && mediaData.s.mp4) {
            imageUrl = mediaData.s.mp4.replace(/&amp;/g, '&');
            isAnimated = true;
          }
          // Fall back to regular image
          else if (mediaData.s && mediaData.s.u) {
            imageUrl = mediaData.s.u.replace(/&amp;/g, '&');
            // Check if it's a GIF
            isAnimated = imageUrl.toLowerCase().includes('.gif') || 
                        imageUrl.toLowerCase().includes('format=gif') ||
                        imageUrl.toLowerCase().includes('gif');
          }
          
          if (imageUrl) {
            allItems.push({
              url: imageUrl,
              cleanUrl: imageUrl.split('?')[0].trim().replace(/\/+$/, ''),
              isAnimated: isAnimated
            });
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
        
        // Clean and prepare URLs
        const cleanedUrls = uniqueItems.map(item => {
          let cleanUrl = item.url.split('?')[0].trim();
          cleanUrl = cleanUrl.replace(/\/+$/, '');
          
          // Convert Twitter/X links to vxtwitter.com
          if (cleanUrl.toLowerCase().includes('x.com/') || cleanUrl.toLowerCase().includes('twitter.com/')) {
            cleanUrl = cleanUrl.replace(/https?:\/\/(www\.)?(x\.com|twitter\.com)/i, 'https://vxtwitter.com');
          }
          
          return cleanUrl;
        });
        
        return {
          title: postData.title,
          subreddit: postData.subreddit,
          author: postData.author,
          urls: cleanedUrls,
          isGallery: true,
          galleryInfo: {
            totalItems: uniqueItems.length,
            animatedCount: animatedCount,
            staticCount: staticCount
          }
        };
      }
    }
  } catch (error) {
    console.error('❌ Error processing Reddit gallery:', error.message);
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
      const cleanShortUrl = url.split('?')[0].trim().replace(/\/+$/, '');
      if (!seenUrls.has(cleanShortUrl)) {
        seenUrls.add(cleanShortUrl);
        redditShortUrls.push(url);
      } else {
        console.log(`🚫 Duplicate redd.it URL skipped: ${cleanShortUrl}`);
      }
    } else {
      // Clean the URL for duplicate checking
      const cleanUrl = url.split('?')[0].trim().replace(/\/+$/, '');
      
      // Skip if already seen
      if (seenUrls.has(cleanUrl)) {
        console.log(`🚫 Duplicate URL skipped: ${cleanUrl}`);
        continue;
      }
      seenUrls.add(cleanUrl);
      
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
              const cleanFullUrl = fullUrl.split('?')[0].trim().replace(/\/+$/, '');
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
                  const cleanFullUrl = fullUrl.split('?')[0].trim().replace(/\/+$/, '');
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
              const cleanShortUrl = shortUrl.split('?')[0].trim().replace(/\/+$/, '');
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
      const cleanedUrls = allowedUrls.map(url => {
        let cleanUrl = url.split('?')[0].trim();
        cleanUrl = cleanUrl.replace(/\/+$/, '');
        
        // Convert Twitter/X links to vxtwitter.com
        if (cleanUrl.toLowerCase().includes('x.com/') || cleanUrl.toLowerCase().includes('twitter.com/')) {
          cleanUrl = cleanUrl.replace(/https?:\/\/(www\.)?(x\.com|twitter\.com)/i, 'https://vxtwitter.com');
        }
        
        return cleanUrl;
      });
      
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
          
          const twitterConversionInfo = twitterLinksConverted > 0 ? 
            `• ${twitterLinksConverted} Twitter/X link(s) converted to vxtwitter.com\n` : '';
          
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