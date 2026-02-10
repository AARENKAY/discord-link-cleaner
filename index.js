const express = require('express');
const { Client, GatewayIntentBits, ActivityType } = require('discord.js');

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
  
  // Filter URLs based on allowed websites and extensions
  for (const url of allUrls) {
    const urlLower = url.toLowerCase();
    
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
      
      await logChannel.send(
        `🔗 **Link Analysis:**\n` +
        `• From: **${message.author.tag}** in <#${message.channel.id}>\n` +
        `${subredditInfo}` +
        `• Total URLs: ${allUrls.length}\n` +
        `• Allowed: ${allowedUrls.length}\n` +
        `• Blocked: ${blockedUrls.length}\n` +
        `${blockedSummary}` +
        `• Action: ${allowedUrls.length === 0 ? 'Delete only' : 'Delete & repost'}`
      );
    }
  } catch (error) {
    console.error('Failed to send log to log channel:', error);
  }
  
  if (allowedUrls.length === 0 && blockedUrls.length > 0) {
    await message.delete();
    return;
  }
  
  if (allowedUrls.length > 0) {
    try {
      await message.delete();
      
      // Send all cleaned links in one message for better organization
      const cleanedLinks = [];
      
      for (const url of allowedUrls) {
        let cleanUrl = url.split('?')[0].trim();
        cleanUrl = cleanUrl.replace(/\/+$/, '');
        
        // Format ALL allowed links with subreddit or username
        // (not just links from ALLOWED_WEBSITES)
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
      
      // Log successful cleaning
      try {
        const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
        if (logChannel) {
          // Add subreddit info to success log if available
          const subredditSuccessInfo = subredditInfo ? `\n${subredditInfo}` : '';
          
          const formattingInfo = subreddit ? 
            `• All links formatted with subreddit: ${subreddit}\n` : 
            `• All links formatted with username: ${senderUsername}\n`;
          
          await logChannel.send(
            `✅ **Cleaning Complete**\n` +
            `• Processed ${allowedUrls.length} link(s) from **${message.author.tag}** in <#${message.channel.id}>${subredditSuccessInfo}` +
            `${formattingInfo}` +
            `• Blocked ${blockedUrls.length} unwanted link(s)`
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
