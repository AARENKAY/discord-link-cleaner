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

const processRedditGallery = async (jsonUrl, message, subreddit, senderUsername) => {
  try {
    console.log(`🎨 Processing Reddit gallery: ${jsonUrl}`);
    
    const response = await axios.get(jsonUrl);
    const postData = response.data[0].data.children[0].data;
    
    // Check if it's a gallery
    if (postData.media_metadata) {
      console.log(`🎨 Found gallery with ${Object.keys(postData.media_metadata).length} items`);
      
      const imageUrls = [];
      for (const [mediaId, mediaData] of Object.entries(postData.media_metadata)) {
        if (mediaData.status === 'valid') {
          // Get the highest quality image available
          let imageUrl = '';
          if (mediaData.s && mediaData.s.u) {
            imageUrl = mediaData.s.u.replace(/&amp;/g, '&');
          } else if (mediaData.p && mediaData.p.length > 0) {
            imageUrl = mediaData.p[mediaData.p.length - 1].u.replace(/&amp;/g, '&');
          }
          
          if (imageUrl) {
            imageUrls.push({
              url: imageUrl,
              caption: postData.title
            });
          }
        }
      }
      
      if (imageUrls.length > 0) {
        console.log(`🎨 Extracted ${imageUrls.length} images from gallery`);
        
        // Create embeds for each image
        const embeds = [];
        for (const [index, imageData] of imageUrls.entries()) {
          const embed = new EmbedBuilder()
            .setColor('#FF4500') // Reddit orange
            .setTitle(postData.title)
            .setURL(jsonUrl.replace('.json', ''))
            .setDescription(imageUrls.length > 1 ? `Image ${index + 1} of ${imageUrls.length}` : '')
            .setImage(imageData.url)
            .setFooter({ 
              text: `r/${postData.subreddit} • Posted by ${postData.author}` 
            });
          
          embeds.push(embed);
        }
        
        // Log gallery processing
        try {
          const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
          if (logChannel) {
            await logChannel.send(
              `🎨 **Reddit Gallery Processed**\n` +
              `• From: **${message.author.tag}** in <#${message.channel.id}>\n` +
              `• Gallery: r/${postData.subreddit} - ${postData.title}\n` +
              `• Images: ${imageUrls.length}`
            );
          }
        } catch (error) {
          console.error('Failed to send gallery log:', error);
        }
        
        return embeds;
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
  const galleryEmbeds = [];
  
  // First, separate redd.it short URLs
  for (const url of allUrls) {
    const urlLower = url.toLowerCase();
    
    // Check if it's a redd.it short URL
    if (urlLower.includes('redd.it/')) {
      redditShortUrls.push(url);
    } else {
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
          const embeds = await processRedditGallery(jsonUrl, message, null, message.author.username);
          
          if (embeds && embeds.length > 0) {
            // Add to gallery embeds
            galleryEmbeds.push(...embeds);
          } else {
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
              allowedUrls.push(fullUrl); // Use the resolved full URL
            } else {
              // Check if the domain is in allowed websites
              let isAllowedWebsite = false;
              for (const website of ALLOWED_WEBSITES) {
                if (fullUrlLower.includes(website)) {
                  isAllowedWebsite = true;
                  allowedUrls.push(fullUrl);
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
              allowedUrls.push(shortUrl);
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
  
  // Extract subreddit info if present (e.g., "r/aww" or "/r/aww")
  const subredditPattern = /(?:\/?r\/)([\w]+)/gi;
  const subredditMatches = message.content.match(subredditPattern);
  const subreddit = subredditMatches ? subredditMatches[0].replace(/^\/?/, '') : null; // Get first subreddit, clean slashes
  const subredditInfo = subredditMatches ? `• Subreddit(s): ${subredditMatches.join(', ')}\n` : '';
  
  // Get sender's username for formatting (without discriminator if present)
  const senderUsername = message.author.username;
  
  // Log link analysis results with original content details
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
      
      const galleryInfo = galleryEmbeds.length > 0 ? 
        `• Gallery images: ${galleryEmbeds.length} found\n` : '';
      
      await logChannel.send(
        `🔗 **Link Analysis:**\n` +
        `• From: **${message.author.tag}** in <#${message.channel.id}>\n` +
        `${subredditInfo}` +
        `• Total URLs: ${allUrls.length}\n` +
        `• Allowed: ${allowedUrls.length}\n` +
        `• Blocked: ${blockedUrls.length}\n` +
        `${redditProcessedInfo}` +
        `${galleryInfo}` +
        `${blockedSummary}` +
        `• Action: ${allowedUrls.length === 0 && galleryEmbeds.length === 0 ? 'Delete only' : 'Delete & repost'}`
      );
    }
  } catch (error) {
    console.error('Failed to send log to log channel:', error);
  }
  
  if (allowedUrls.length === 0 && galleryEmbeds.length === 0 && blockedUrls.length > 0) {
    await message.delete();
    return;
  }
  
  if (allowedUrls.length > 0 || galleryEmbeds.length > 0) {
    try {
      await message.delete();
      
      // Send gallery embeds first (if any)
      if (galleryEmbeds.length > 0) {
        console.log(`🎨 Sending ${galleryEmbeds.length} gallery embeds`);
        // Discord has a limit of 10 embeds per message
        const embedChunks = [];
        for (let i = 0; i < galleryEmbeds.length; i += 10) {
          embedChunks.push(galleryEmbeds.slice(i, i + 10));
        }
        
        for (const chunk of embedChunks) {
          await message.channel.send({ embeds: chunk });
        }
      }
      
      // Send all cleaned regular links in one message for better organization
      if (allowedUrls.length > 0) {
        const cleanedLinks = [];
        
        for (const url of allowedUrls) {
          let cleanUrl = url.split('?')[0].trim();
          cleanUrl = cleanUrl.replace(/\/+$/, '');
          
          // Convert Twitter/X links to vxtwitter.com
          if (cleanUrl.toLowerCase().includes('x.com/') || cleanUrl.toLowerCase().includes('twitter.com/')) {
            cleanUrl = cleanUrl.replace(/https?:\/\/(www\.)?(x\.com|twitter\.com)/i, 'https://vxtwitter.com');
          }
          
          // Format ALL allowed links with subreddit or username
          if (subreddit) {
            // Use subreddit if available
            cleanedLinks.push(`[${subreddit}](${cleanUrl})`);
          } else {
            // Fall back to username if no subreddit
            cleanedLinks.push(`[${senderUsername}](${cleanUrl})`);
          }
        }
        
        // Send all links in one message
        if (cleanedLinks.length > 0) {
          await message.channel.send(cleanedLinks.join('\n'));
        }
      }
      
      // Log successful cleaning
      try {
        const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
        if (logChannel) {
          // Add subreddit info to success log if available
          const subredditSuccessInfo = subredditInfo ? `\n${subredditInfo}` : '';
          
          // Check if any Twitter links were converted
          const twitterLinksConverted = allowedUrls.filter(url => 
            url.toLowerCase().includes('x.com/') || url.toLowerCase().includes('twitter.com/')
          ).length;
          
          const twitterConversionInfo = twitterLinksConverted > 0 ? 
            `• ${twitterLinksConverted} Twitter/X link(s) converted to vxtwitter.com\n` : '';
          
          const gallerySuccessInfo = galleryEmbeds.length > 0 ? 
            `• ${galleryEmbeds.length} gallery image(s) posted as embeds\n` : '';
          
          const formattingInfo = subreddit ? 
            `• Links formatted with subreddit: ${subreddit}\n` : 
            allowedUrls.length > 0 ? `• Links formatted with username: ${senderUsername}\n` : '';
          
          await logChannel.send(
            `✅ **Cleaning Complete**\n` +
            `• Processed ${allowedUrls.length + galleryEmbeds.length} item(s) from **${message.author.tag}** in <#${message.channel.id}>${subredditSuccessInfo}` +
            `${gallerySuccessInfo}` +
            `${twitterConversionInfo}` +
            `${formattingInfo}` +
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
