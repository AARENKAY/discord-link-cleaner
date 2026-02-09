const { Client, GatewayIntentBits, ActivityType } = require('discord.js');

console.log('🚀 Starting Discord Link Cleaner Bot...');

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

// File extensions to ALLOW (case-insensitive)
const ALLOWED_EXTENSIONS = [
  '.mp4', '.gif', '.gifv', '.webm', '.jpg', '.jpeg', '.png', '.webp'
];

// ========== END CONFIG ==========

client.once('ready', () => {
  console.log(`✅ Bot online as ${client.user.tag}`);
  console.log(`👀 User ID: ${client.user.id}`);
  console.log(`🔍 Monitoring ${TARGET_BOT_IDS.length} target bot(s)`);
  
  client.user.setPresence({
    activities: [{
      name: 'Cleaning links...',
      type: ActivityType.Watching
    }],
    status: 'online'
  });
  
  console.log('🤖 Bot is ready and listening...\n');
});

client.on('messageCreate', async (message) => {
  // Ignore own messages
  if (message.author.id === client.user.id) return;
  
  // Check if from target bot
  const isTargetBot = TARGET_BOT_IDS.includes(message.author.id);
  if (!isTargetBot) return;
  
  console.log(`📨 [${new Date().toLocaleTimeString()}] From: ${message.author.tag}`);
  console.log(`   Channel: #${message.channel.name}`);
  
  // Find ALL URLs in message
  const urlPattern = /https?:\/\/[^\s<>\"]+/gi;
  const allUrls = message.content.match(urlPattern);
  
  if (!allUrls || allUrls.length === 0) {
    console.log('   ⚠️ No URLs found in message');
    return;
  }
  
  console.log(`   Found ${allUrls.length} total URL(s):`);
  allUrls.forEach((url, i) => {
    console.log(`      ${i+1}. ${url.substring(0, 60)}...`);
  });
  
  // Filter URLs based on rules
  const allowedUrls = [];
  const blockedUrls = [];
  
  for (const url of allUrls) {
    const urlLower = url.toLowerCase();
    
    // RULE 1: Always allow RedGIFs (any RedGIFs URL)
    if (urlLower.includes('redgifs.com')) {
      console.log(`      ✅ ALLOWED (RedGIFs): ${url.substring(0, 50)}...`);
      allowedUrls.push(url);
      continue;
    }
    
    // RULE 2: Check for allowed file extensions
    let hasAllowedExtension = false;
    
    for (const ext of ALLOWED_EXTENSIONS) {
      if (urlLower.includes(ext) || 
          urlLower.includes(ext + '?') || 
          urlLower.endsWith(ext)) {
        hasAllowedExtension = true;
        break;
      }
    }
    
    if (hasAllowedExtension) {
      console.log(`      ✅ ALLOWED (Has allowed extension): ${url.substring(0, 50)}...`);
      allowedUrls.push(url);
    } else {
      console.log(`      ❌ BLOCKED (No allowed extension): ${url.substring(0, 50)}...`);
      blockedUrls.push(url);
    }
  }
  
  console.log(`   Summary: ${allowedUrls.length} allowed, ${blockedUrls.length} blocked`);
  
  // If ALL URLs are blocked, delete entire message
  if (allowedUrls.length === 0 && blockedUrls.length > 0) {
    console.log('   🚫 All URLs blocked - deleting entire message');
    try {
      await message.delete();
      console.log('   🗑️ Message deleted');
    } catch (error) {
      console.error(`   ❌ Failed to delete: ${error.message}`);
    }
    return;
  }
  
  // If some URLs allowed, some blocked
  if (blockedUrls.length > 0) {
    console.log('   ⚠️ Some URLs blocked - deleting original, reposting only allowed URLs');
  }
  
  // If we have allowed URLs to post
  if (allowedUrls.length > 0) {
    try {
      // Delete original message
      await message.delete();
      console.log('   🗑️ Original message deleted');
      
      // Post each allowed URL (cleaned)
      for (const url of allowedUrls) {
        // Clean URL: remove tracking parameters
        let cleanUrl = url.split('?')[0].trim();
        // Remove trailing slashes
        cleanUrl = cleanUrl.replace(/\/+$/, '');
        
        await message.channel.send(cleanUrl);
        console.log(`   🔗 Posted: ${cleanUrl.substring(0, 60)}...`);
      }
      
      console.log(`   ✨ Successfully processed ${allowedUrls.length} link(s)`);
      
    } catch (error) {
      console.error(`   ❌ Error: ${error.message}`);
    }
  }
});

// ========== UTILITY FUNCTIONS ==========
function hasExtension(url, extensions) {
  const urlLower = url.toLowerCase();
  return extensions.some(ext => 
    urlLower.includes(ext) || 
    urlLower.includes(ext + '?') ||
    urlLower.endsWith(ext)
  );
}

// Error handling
client.on('error', (error) => {
  console.error('🚨 Discord.js Error:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('🚨 Unhandled Promise Rejection:', error);
});

// Start bot
const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error('❌ ERROR: BOT_TOKEN environment variable is not set!');
  process.exit(1);
}

console.log('🔑 Authenticating with Discord...');
client.login(BOT_TOKEN)
  .then(() => {
    console.log('🔐 Authentication successful\n');
  })
  .catch((error) => {
    console.error('❌ Authentication failed:', error.message);
    process.exit(1);
  });