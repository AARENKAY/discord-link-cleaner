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
// ========== END CONFIG ==========

client.once('ready', () => {
  console.log(`✅ Bot online as ${client.user.tag}`);
  console.log(`🔍 Monitoring ${TARGET_BOT_IDS.length} bots`);
  
  client.user.setPresence({
    activities: [{ name: 'Cleaning links...', type: ActivityType.Watching }],
    status: 'online'
  });
});

client.on('messageCreate', async (message) => {
  if (message.author.id === client.user.id) return;
  if (!TARGET_BOT_IDS.includes(message.author.id)) return;
  
  console.log(`📨 From: ${message.author.tag} in #${message.channel.name}`);
  
  const urlPattern = /https?:\/\/[^\s<>\"]+/gi;
  const allUrls = message.content.match(urlPattern);
  
  if (!allUrls) return;
  
  const allowedUrls = [];
  const blockedUrls = [];
  
  for (const url of allUrls) {
    const urlLower = url.toLowerCase();
    
    if (urlLower.includes('redgifs.com')) {
      allowedUrls.push(url);
      continue;
    }
    
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
  
  if (allowedUrls.length === 0 && blockedUrls.length > 0) {
    await message.delete();
    return;
  }
  
  if (allowedUrls.length > 0) {
    try {
      await message.delete();
      for (const url of allowedUrls) {
        let cleanUrl = url.split('?')[0].trim();
        cleanUrl = cleanUrl.replace(/\/+$/, '');
        await message.channel.send(cleanUrl);
      }
    } catch (error) {
      console.error(`Error: ${error.message}`);
    }
  }
});

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN not set!');
  process.exit(1);
}

client.login(BOT_TOKEN);