const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ROLE = process.env.ADMIN_ROLE;
const LUARMOR_KEY = process.env.LUARMOR_KEY;
const GUILD_ID = '1154193983766011934';

const PREMIUM_PROJECT = '8b3909f9359e16e6c5429c23f47a27ef';
const STANDARD_PROJECT = '01a8d5a1daeaae85268208d81d403e2d';

const PREMIUM_SLOTS = 8;
const STANDARD_SLOTS = 15;

// Key pools - stored directly in bot
const PREMIUM_KEYS = [
  'jHhdvcKdxsSOhDTmRGEfRTPPhtXiKlbi',
  'FEKnGciFiYakLhnVnoqKjujdTYmbJFjg',
  'lSskpNtrbSwVUvIaCTdrKUgImZTaHtjA',
  'DQGTYtkTFTbCniykDRRLeMkjtSDwwKHJ',
  'aGQvYLlrICCEHHrOaWJbHXlatQbsagRd',
  'QLPGEbzyNyDFnUxzVUfpKSAnwoHpKrxH',
  'yQuYWSQVDRCVNeycwfWeqsGrDCOsKyBy',
  'UeYWyKkXCwLSzXtzAaEXsiODdNBmmuhZ',
];

const STANDARD_KEYS = [
  'jYGrHTLEMAXOJqTSsTXdPbGtKrZQGLOj',
  'SLRiabuFsCInJOPXZUzPQjMaHfJILsJK',
  'DrOhVJBkxKTIRcINgYeQypjeqBiFdkNA',
  'lrrsBWwcDQLZdJuECKvzdqSRXVfbmRGw',
  'ezvRGoBqNBURfyrTvCTKUKyEAiNBCfSw',
  'OHVRneKInOdvjhKGjzfWBEjSNxqQUzCY',
  'RAZTIBugmPUXLDulgAYpGttFfgBWwNbj',
  'QLKsxRPuOQReAnjiFYugiSVfxAGvthrx',
  'oywncKGTqzjiWAZVSslNzuZKhqFzsrnA',
  'DozbYXFdWhaArBhutbxAryCJlWNobDJT',
  'hemftcHVVffHRRJErgmyJCbMxGLYydLT',
  'hQzxYpyeGnobdNcTMNTknZiaqeKueEZj',
  'YJHIxTReBPZNJioEHaIZPSgCMmPopRSU',
  'gWdOqNHTxdUPzfOUqdyfewhwkxyOswgq',
  'mCjRziClctcIyTqtZUZvcardQlsGAeIw',
];
const PREMIUM_PRICE = 8;
const STANDARD_PRICE = 4;
const MIN_HOURS = 2;

const BALANCE_FILE = 'balances.json';
const KEYS_FILE = 'user_keys.json';

function loadJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}
function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function getBalance(userId) {
  const b = loadJSON(BALANCE_FILE);
  return b[userId] || 0;
}
function setBalance(userId, amount) {
  const b = loadJSON(BALANCE_FILE);
  b[userId] = amount;
  saveJSON(BALANCE_FILE, b);
}

function getUserKey(userId) {
  const k = loadJSON(KEYS_FILE);
  return k[userId] || null;
}
function setUserKey(userId, data) {
  const k = loadJSON(KEYS_FILE);
  k[userId] = data;
  saveJSON(KEYS_FILE, k);
}
function removeUserKey(userId) {
  const k = loadJSON(KEYS_FILE);
  delete k[userId];
  saveJSON(KEYS_FILE, k);
}

// CORRECT Luarmor API call - authorization header is just the API key, no Bearer
async function luarmorRequest(method, path, body = null) {
  const url = `https://api.luarmor.net/v3${path}`;
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'authorization': LUARMOR_KEY
    }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
  console.log(`Luarmor ${method} ${path} → ${res.status}: ${text.substring(0, 200)}`);
  try { return { status: res.status, data: JSON.parse(text) }; }
  catch { return { status: res.status, data: text }; }
}

async function getProjectUsers(projectId) {
  const r = await luarmorRequest('GET', `/projects/${projectId}/users`);
  if (r.status !== 200) return [];
  if (Array.isArray(r.data)) return r.data;
  if (r.data && Array.isArray(r.data.users)) return r.data.users;
  return [];
}

function getKeyPool(projectId) {
  return projectId === PREMIUM_PROJECT ? PREMIUM_KEYS : STANDARD_KEYS;
}

async function getAvailableKey(projectId) {
  const pool = getKeyPool(projectId);
  const keys = loadJSON(KEYS_FILE);
  const usedKeys = Object.values(keys)
    .filter(k => k.project === projectId)
    .map(k => k.key);
  const available = pool.find(k => !usedKeys.includes(k));
  console.log(`getAvailableKey: pool=${pool.length}, used=${usedKeys.length}, found=${available || 'none'}`);
  return available ? { user_key: available } : null;
}

async function assignKey(projectId, userKey, discordId, expiryTimestamp) {
  return await luarmorRequest('PATCH', `/projects/${projectId}/users`, {
    user_key: userKey,
    discord_id: discordId,
    auth_expire: expiryTimestamp
  });
}

async function resetHWID(projectId, userKey, force = false) {
  return await luarmorRequest('POST', `/projects/${projectId}/users/resethwid`, {
    user_key: userKey,
    force
  });
}

async function deleteKey(projectId, userKey) {
  return await luarmorRequest('DELETE', `/projects/${projectId}/users?user_key=${userKey}`);
}

async function getUserByDiscord(projectId, discordId) {
  const r = await luarmorRequest('GET', `/projects/${projectId}/users?discord_id=${discordId}`);
  if (r.status !== 200) return null;
  const users = Array.isArray(r.data) ? r.data : (r.data?.users || []);
  return users[0] || null;
}

async function getSlotCount(projectId) {
  const keys = loadJSON(KEYS_FILE);
  const taken = Object.values(keys).filter(k => k.project === projectId).length;
  return taken;
}

function isAdmin(member) {
  return member.roles.cache.has(ADMIN_ROLE);
}

// Commands
const commands = [
  new SlashCommandBuilder().setName('key').setDescription('Link your Luarmor key')
    .addStringOption(o => o.setName('key').setDescription('Your key').setRequired(true))
    .addStringOption(o => o.setName('plan').setDescription('premium or standard').setRequired(true)
      .addChoices({ name: 'Premium', value: 'premium' }, { name: 'Standard', value: 'standard' })),

  new SlashCommandBuilder().setName('info').setDescription('Check your key info'),

  new SlashCommandBuilder().setName('resethwid').setDescription('Reset your HWID (24h cooldown)'),

  new SlashCommandBuilder().setName('balance').setDescription('Check your balance'),

  new SlashCommandBuilder().setName('buy').setDescription('Buy access using your balance')
    .addStringOption(o => o.setName('plan').setDescription('Plan').setRequired(true)
      .addChoices({ name: 'Premium - $8/hr', value: 'premium' }, { name: 'Standard - $4/hr', value: 'standard' }))
    .addIntegerOption(o => o.setName('hours').setDescription('Hours (min 2)').setRequired(true).setMinValue(2)),

  new SlashCommandBuilder().setName('slots').setDescription('View available slots'),

  new SlashCommandBuilder().setName('setroblox').setDescription('Set your Roblox username')
    .addStringOption(o => o.setName('username').setDescription('Roblox username').setRequired(true)),

  // Admin commands
  new SlashCommandBuilder().setName('addbalance').setDescription('[Admin] Add balance to a user')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addNumberOption(o => o.setName('amount').setDescription('Amount').setRequired(true)),

  new SlashCommandBuilder().setName('removebalance').setDescription('[Admin] Remove balance from a user')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addNumberOption(o => o.setName('amount').setDescription('Amount').setRequired(true)),

  new SlashCommandBuilder().setName('addtime').setDescription('[Admin] Add time to a user\'s key')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addIntegerOption(o => o.setName('hours').setDescription('Hours to add').setRequired(true)),

  new SlashCommandBuilder().setName('removetime').setDescription('[Admin] Remove time from a user\'s key')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addIntegerOption(o => o.setName('hours').setDescription('Hours to remove').setRequired(true)),

  new SlashCommandBuilder().setName('adminresethwid').setDescription('[Admin] Force reset a user\'s HWID')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),

  new SlashCommandBuilder().setName('blacklist').setDescription('[Admin] Blacklist a user')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),

  new SlashCommandBuilder().setName('unblacklist').setDescription('[Admin] Unblacklist a user')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),

  new SlashCommandBuilder().setName('createkey').setDescription('[Admin] Create a new key manually')
    .addStringOption(o => o.setName('plan').setDescription('Plan').setRequired(true)
      .addChoices({ name: 'Premium', value: 'premium' }, { name: 'Standard', value: 'standard' }))
    .addIntegerOption(o => o.setName('hours').setDescription('Hours').setRequired(true)),

  new SlashCommandBuilder().setName('deletekey').setDescription('[Admin] Delete a user\'s key')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),

  new SlashCommandBuilder().setName('givekey').setDescription('[Admin] Give a user a key')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addStringOption(o => o.setName('plan').setDescription('Plan').setRequired(true)
      .addChoices({ name: 'Premium', value: 'premium' }, { name: 'Standard', value: 'standard' }))
    .addIntegerOption(o => o.setName('hours').setDescription('Hours').setRequired(true)),

  new SlashCommandBuilder().setName('userinfo').setDescription('[Admin] View all active users with Discord + Roblox info'),

  new SlashCommandBuilder().setName('removekey').setDescription('[Admin] Unlink a user\'s key')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),

  new SlashCommandBuilder().setName('listkeys').setDescription('[Admin] List all keys')
    .addStringOption(o => o.setName('plan').setDescription('Plan').setRequired(true)
      .addChoices({ name: 'Premium', value: 'premium' }, { name: 'Standard', value: 'standard' })),

  new SlashCommandBuilder().setName('compensate').setDescription('[Admin] Compensate a user with balance')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addNumberOption(o => o.setName('amount').setDescription('Amount').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),

  new SlashCommandBuilder().setName('unfreeze').setDescription('[Admin] Unfreeze a user\'s key')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),

  new SlashCommandBuilder().setName('extend').setDescription('[Admin] Extend a user\'s key')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addIntegerOption(o => o.setName('hours').setDescription('Hours to extend').setRequired(true)),

  new SlashCommandBuilder().setName('resetroblox').setDescription('[Admin] Reset a user\'s Roblox username')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),


].map(c => c.toJSON());

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('clientReady', async () => {
  console.log(`✅ Cursed Notifier Bot online as ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
  console.log('✅ Slash commands registered!');

  // Auto expiry checker - runs every 5 minutes
  setInterval(async () => {
    try {
      const now = Math.floor(Date.now() / 1000);
      const keys = loadJSON(KEYS_FILE);
      let changed = false;

      for (const [userId, keyData] of Object.entries(keys)) {
        if (!keyData.expiry) continue;
        if (now >= keyData.expiry) {
          console.log(`[EXPIRY] Key expired for user ${userId}: ${keyData.key}`);

          // Reset key in Luarmor so it becomes unassigned and reusable
          try {
            await luarmorRequest('PATCH', `/projects/${keyData.project}/users`, {
              user_key: keyData.key,
              discord_id: '',
              identifier: '',
              auth_expire: -1,
              banned: false,
            });
            console.log(`[EXPIRY] Reset key ${keyData.key} back to pool`);
          } catch(e) {
            console.log(`[EXPIRY] Luarmor reset failed for ${keyData.key}, removing locally anyway`);
          }

          // Notify user their key expired
          try {
            const user = await client.users.fetch(userId);
            await user.send(`⏰ Your **${keyData.plan}** key has expired! Use /buy to purchase again.`);
          } catch(e) {}

          // Remove key data but keep roblox username for next purchase
          const roblox = keys[userId]?.roblox;
          delete keys[userId];
          if (roblox) keys[userId] = { roblox };
          changed = true;
        }
      }

      if (changed) {
        saveJSON(KEYS_FILE, keys);
        console.log('[EXPIRY] Cleaned up expired keys');
      }
    } catch(e) {
      console.error('[EXPIRY] Error in expiry checker:', e);
    }
  }, 5 * 60 * 1000); // every 5 minutes
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, member, user } = interaction;

  const adminOnly = ['addbalance','removebalance','addtime','removetime','adminresethwid','blacklist','unblacklist','createkey','deletekey','givekey','userinfo','removekey','listkeys','compensate','unfreeze','extend','resetroblox'];
  if (adminOnly.includes(commandName) && !isAdmin(member)) {
    return interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    if (commandName === 'slots') {
      const premTaken = await getSlotCount(PREMIUM_PROJECT);
      const stdTaken = await getSlotCount(STANDARD_PROJECT);
      const keys = loadJSON(KEYS_FILE);
      const now2 = Math.floor(Date.now() / 1000);

      // Build premium slot list - show only roblox username
      const premUsers = Object.entries(keys).filter(([,k]) => k.key && k.project === PREMIUM_PROJECT && k.expiry && now2 < k.expiry);
      let premLines = `${premTaken}/${PREMIUM_SLOTS} taken | ${PREMIUM_SLOTS - premTaken} available | $${PREMIUM_PRICE}/hr\n`;
      for (const [uid, k] of premUsers) {
        const roblox = k.roblox || 'Unknown';
        premLines += `• ${roblox} — <t:${k.expiry}:R>\n`;
      }

      // Build standard slot list - show only roblox username
      const stdUsers = Object.entries(keys).filter(([,k]) => k.key && k.project === STANDARD_PROJECT && k.expiry && now2 < k.expiry);
      let stdLines = `${stdTaken}/${STANDARD_SLOTS} taken | ${STANDARD_SLOTS - stdTaken} available | $${STANDARD_PRICE}/hr\n`;
      for (const [uid, k] of stdUsers) {
        const roblox = k.roblox || 'Unknown';
        stdLines += `• ${roblox} — <t:${k.expiry}:R>\n`;
      }

      const embed = new EmbedBuilder()
        .setTitle('🎰 Available Slots')
        .setColor(0x2b2d31)
        .addFields(
          { name: '💎 Premium', value: premLines || 'No active users', inline: false },
          { name: '⭐ Standard', value: stdLines || 'No active users', inline: false }
        );
      return interaction.editReply({ embeds: [embed] });
    }

    if (commandName === 'balance') {
      const bal = getBalance(user.id);
      return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('💰 Your Balance').setDescription(`$${bal.toFixed(2)}`).setColor(0x2b2d31)] });
    }

    if (commandName === 'key') {
      const userKey = interaction.options.getString('key');
      const plan = interaction.options.getString('plan');
      const projectId = plan === 'premium' ? PREMIUM_PROJECT : STANDARD_PROJECT;
      const users = await getProjectUsers(projectId);
      const found = users.find(u => u.user_key === userKey);
      if (!found) return interaction.editReply({ content: '❌ Key not found in that plan.' });
      setUserKey(user.id, { key: userKey, plan, project: projectId });
      // Link discord id
      await luarmorRequest('PATCH', `/projects/${projectId}/users`, { user_key: userKey, discord_id: user.id });
      return interaction.editReply({ content: `✅ Key linked successfully! Plan: **${plan}**` });
    }

    if (commandName === 'info') {
      const keyData = getUserKey(user.id);
      if (!keyData) return interaction.editReply({ content: '❌ No key linked. Use /key first.' });
      const luUser = await getUserByDiscord(keyData.project, user.id);
      if (!luUser) return interaction.editReply({ content: '❌ Could not find your key on Luarmor.' });
      const expiry = luUser.auth_expire > 0 ? `<t:${luUser.auth_expire}:F>` : 'Never';
      const embed = new EmbedBuilder()
        .setTitle('🔑 Your Key Info')
        .setColor(0x2b2d31)
        .addFields(
          { name: 'Plan', value: keyData.plan, inline: true },
          { name: 'Key', value: `||${luUser.user_key}||`, inline: true },
          { name: 'Status', value: luUser.banned ? '🔴 Banned' : '🟢 Active', inline: true },
          { name: 'Expires', value: expiry, inline: true },
          { name: 'HWID Status', value: luUser.status || 'Unknown', inline: true }
        );
      return interaction.editReply({ embeds: [embed] });
    }

    if (commandName === 'resethwid') {
      const keyData = getUserKey(user.id);
      if (!keyData) return interaction.editReply({ content: '❌ No key linked. Use /key first.' });
      const r = await resetHWID(keyData.project, keyData.key, false);
      if (r.status === 200) return interaction.editReply({ content: '✅ HWID reset successfully!' });
      return interaction.editReply({ content: `❌ Failed: ${r.data?.message || 'Unknown error'}` });
    }

    if (commandName === 'buy') {
      const plan = interaction.options.getString('plan');
      const hours = interaction.options.getInteger('hours');
      const projectId = plan === 'premium' ? PREMIUM_PROJECT : STANDARD_PROJECT;
      const pricePerHour = plan === 'premium' ? PREMIUM_PRICE : STANDARD_PRICE;
      const totalCost = pricePerHour * hours;
      const bal = getBalance(user.id);

      // Check if user already has an active key FIRST
      const allKeys = loadJSON(KEYS_FILE);
      const existingKey = allKeys[user.id];
      const nowCheck = Math.floor(Date.now() / 1000);
      if (existingKey?.key && existingKey?.expiry && nowCheck < existingKey.expiry) {
        return interaction.editReply({ content: `❌ You already have an active **${existingKey.plan}** key that expires <t:${existingKey.expiry}:R>. Wait for it to expire before buying again.` });
      }

      // Require roblox username before buying
      if (!allKeys[user.id]?.roblox) return interaction.editReply({ content: '❌ You must set your Roblox username first! Use /setroblox once before buying.' });

      if (bal < totalCost) return interaction.editReply({ content: `❌ Insufficient balance. You have **$${bal.toFixed(2)}** but need **$${totalCost.toFixed(2)}**.` });

      const taken = await getSlotCount(projectId);
      const maxSlots = plan === 'premium' ? PREMIUM_SLOTS : STANDARD_SLOTS;
      if (taken >= maxSlots) return interaction.editReply({ content: `❌ No ${plan} slots available right now.` });

      const available = await getAvailableKey(projectId);
      if (!available) return interaction.editReply({ content: '❌ No unassigned keys available. Please contact an admin.' });

      const expiry = Math.floor(Date.now() / 1000) + (hours * 3600);
      // Assign locally - skip Luarmor API since it blocks our calls
      // Try Luarmor assign but don't fail if it errors
      try {
        await assignKey(projectId, available.user_key, user.id, expiry);
      } catch(e) {
        console.log('Luarmor assign failed, continuing with local assignment');
      }

      setBalance(user.id, bal - totalCost);
      const existingData = loadJSON(KEYS_FILE)[user.id] || {};
      const k2 = loadJSON(KEYS_FILE);
      k2[user.id] = { ...existingData, key: available.user_key, plan, project: projectId, expiry };
      saveJSON(KEYS_FILE, k2);

      try {
        await interaction.user.send({
          embeds: [new EmbedBuilder()
            .setTitle('🎉 Purchase Successful!')
            .setColor(0x2b2d31)
            .addFields(
              { name: 'Plan', value: plan, inline: true },
              { name: 'Duration', value: `${hours} hours`, inline: true },
              { name: 'Cost', value: `$${totalCost.toFixed(2)}`, inline: true },
              { name: 'Key', value: `||${available.user_key}||`, inline: false },
              { name: 'Expires', value: `<t:${expiry}:F>`, inline: false }
            )]
        });
      } catch {}

      return interaction.editReply({ content: `✅ Purchase successful! **$${totalCost.toFixed(2)}** deducted. Key sent to your DMs!` });
    }

    if (commandName === 'setroblox') {
      const username = interaction.options.getString('username');
      // Save roblox username permanently - persists across key purchases
      const k = loadJSON(KEYS_FILE);
      if (!k[user.id]) k[user.id] = {};
      k[user.id].roblox = username;
      saveJSON(KEYS_FILE, k);
      // Also update on Luarmor if they have an active key
      const keyData = getUserKey(user.id);
      if (keyData) {
        try { await luarmorRequest('PATCH', `/projects/${keyData.project}/users`, { user_key: keyData.key, note: `roblox:${username}` }); } catch(e) {}
      }
      return interaction.editReply({ content: `✅ Roblox username set to **${username}**! You only need to do this once.` });
    }

    // ADMIN COMMANDS
    if (commandName === 'addbalance') {
      const target = interaction.options.getUser('user');
      const amount = interaction.options.getNumber('amount');
      setBalance(target.id, getBalance(target.id) + amount);
      return interaction.editReply({ content: `✅ Added **$${amount}** to ${target.username}. New balance: **$${getBalance(target.id).toFixed(2)}**` });
    }

    if (commandName === 'removebalance') {
      const target = interaction.options.getUser('user');
      const amount = interaction.options.getNumber('amount');
      setBalance(target.id, Math.max(0, getBalance(target.id) - amount));
      return interaction.editReply({ content: `✅ Removed **$${amount}** from ${target.username}. New balance: **$${getBalance(target.id).toFixed(2)}**` });
    }

    if (commandName === 'addtime') {
      const target = interaction.options.getUser('user');
      const hours = interaction.options.getInteger('hours');
      const keyData = getUserKey(target.id);
      if (!keyData) return interaction.editReply({ content: '❌ User has no linked key.' });
      const luUser = await getUserByDiscord(keyData.project, target.id);
      if (!luUser) return interaction.editReply({ content: '❌ Key not found on Luarmor.' });
      const currentExpiry = luUser.auth_expire > 0 ? luUser.auth_expire : Math.floor(Date.now() / 1000);
      const newExpiry = currentExpiry + (hours * 3600);
      await luarmorRequest('PATCH', `/projects/${keyData.project}/users`, { user_key: keyData.key, auth_expire: newExpiry });
      return interaction.editReply({ content: `✅ Added **${hours}h** to ${target.username}. New expiry: <t:${newExpiry}:F>` });
    }

    if (commandName === 'removetime') {
      const target = interaction.options.getUser('user');
      const hours = interaction.options.getInteger('hours');
      const keyData = getUserKey(target.id);
      if (!keyData) return interaction.editReply({ content: '❌ User has no linked key.' });
      const luUser = await getUserByDiscord(keyData.project, target.id);
      if (!luUser) return interaction.editReply({ content: '❌ Key not found on Luarmor.' });
      const newExpiry = Math.max(Math.floor(Date.now() / 1000), (luUser.auth_expire || 0) - (hours * 3600));
      await luarmorRequest('PATCH', `/projects/${keyData.project}/users`, { user_key: keyData.key, auth_expire: newExpiry });
      return interaction.editReply({ content: `✅ Removed **${hours}h** from ${target.username}.` });
    }

    if (commandName === 'adminresethwid') {
      const target = interaction.options.getUser('user');
      const keyData = getUserKey(target.id);
      if (!keyData) return interaction.editReply({ content: '❌ User has no linked key.' });
      const r = await resetHWID(keyData.project, keyData.key, true);
      return interaction.editReply({ content: r.status === 200 ? `✅ HWID reset for ${target.username}` : `❌ Failed: ${r.data?.message}` });
    }

    if (commandName === 'blacklist') {
      const target = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      const keyData = getUserKey(target.id);
      if (!keyData) return interaction.editReply({ content: '❌ User has no linked key.' });
      await luarmorRequest('PATCH', `/projects/${keyData.project}/users`, { user_key: keyData.key, banned: true, note: `banned:${reason}` });
      return interaction.editReply({ content: `✅ Blacklisted ${target.username}. Reason: ${reason}` });
    }

    if (commandName === 'unblacklist') {
      const target = interaction.options.getUser('user');
      const keyData = getUserKey(target.id);
      if (!keyData) return interaction.editReply({ content: '❌ User has no linked key.' });
      await luarmorRequest('PATCH', `/projects/${keyData.project}/users`, { user_key: keyData.key, banned: false });
      return interaction.editReply({ content: `✅ Unblacklisted ${target.username}.` });
    }

    if (commandName === 'createkey') {
      const plan = interaction.options.getString('plan');
      const hours = interaction.options.getInteger('hours');
      const projectId = plan === 'premium' ? PREMIUM_PROJECT : STANDARD_PROJECT;
      const expiry = Math.floor(Date.now() / 1000) + (hours * 3600);
      const r = await luarmorRequest('POST', `/projects/${projectId}/users`, { auth_expire: expiry });
      if (r.status === 200 || r.status === 201) {
        return interaction.editReply({ content: `✅ Created new ${plan} key: ||${r.data.user_key || 'check dashboard'}||` });
      }
      return interaction.editReply({ content: `❌ Failed: ${r.data?.message || JSON.stringify(r.data)}` });
    }

    if (commandName === 'deletekey') {
      const target = interaction.options.getUser('user');
      const keyData = getUserKey(target.id);
      if (!keyData) return interaction.editReply({ content: '❌ User has no linked key.' });
      await deleteKey(keyData.project, keyData.key);
      removeUserKey(target.id);
      return interaction.editReply({ content: `✅ Deleted key for ${target.username}.` });
    }

    if (commandName === 'givekey') {
      const target = interaction.options.getUser('user');
      const plan = interaction.options.getString('plan');
      const hours = interaction.options.getInteger('hours');
      const projectId = plan === 'premium' ? PREMIUM_PROJECT : STANDARD_PROJECT;
      const expiry = Math.floor(Date.now() / 1000) + (hours * 3600);
      const available = await getAvailableKey(projectId);
      if (!available) return interaction.editReply({ content: '❌ No available keys. Generate more in Luarmor dashboard.' });
      await assignKey(projectId, available.user_key, target.id, expiry);
      setUserKey(target.id, { key: available.user_key, plan, project: projectId });
      try { await target.send(`🎁 You've been given a **${plan}** key by an admin!\nKey: ||${available.user_key}||\nExpires: <t:${expiry}:F>`); } catch {}
      return interaction.editReply({ content: `✅ Gave ${target.username} a ${plan} key for ${hours}h.` });
    }

    if (commandName === 'userinfo') {
      const nowTs = Math.floor(Date.now() / 1000);
      const keys = loadJSON(KEYS_FILE);
      const active = Object.entries(keys).filter(([,k]) => k.key && k.expiry && nowTs < k.expiry);
      if (active.length === 0) return interaction.editReply({ content: 'No active users right now.' });

      let premLines = '**💎 Premium**\n';
      let stdLines = '**⭐ Standard**\n';
      let hasPrem = false, hasStd = false;

      for (const [uid, k] of active) {
        const roblox = k.roblox || 'Not set';
        let discordName = uid;
        try { const u = await client.users.fetch(uid); discordName = u.username; } catch(e) {}
        const line = `• **${discordName}** — ${roblox} — expires <t:${k.expiry}:R>\n`;
        if (k.project === PREMIUM_PROJECT) { premLines += line; hasPrem = true; }
        else { stdLines += line; hasStd = true; }
      }

      let msg = '';
      if (hasPrem) msg += premLines + '\n';
      if (hasStd) msg += stdLines;
      return interaction.editReply({ content: msg });
    }

    if (commandName === 'removekey') {
      const target = interaction.options.getUser('user');
      const keyData = getUserKey(target.id);
      if (!keyData) return interaction.editReply({ content: '❌ User has no linked key.' });
      // Unlink discord from key
      await luarmorRequest('PATCH', `/projects/${keyData.project}/users`, { user_key: keyData.key, discord_id: '' });
      removeUserKey(target.id);
      return interaction.editReply({ content: `✅ Removed key link for ${target.username}.` });
    }

    if (commandName === 'listkeys') {
      const plan = interaction.options.getString('plan');
      const projectId = plan === 'premium' ? PREMIUM_PROJECT : STANDARD_PROJECT;
      const users = await getProjectUsers(projectId);
      const lines = users.slice(0, 20).map(u => `\`${u.user_key}\` — ${u.discord_id ? `<@${u.discord_id}>` : 'Unassigned'} — ${u.banned ? '🔴' : '🟢'}`).join('\n');
      return interaction.editReply({ content: `**${plan} keys (${users.length} total):**\n${lines || 'None found'}` });
    }

    if (commandName === 'compensate') {
      const target = interaction.options.getUser('user');
      const amount = interaction.options.getNumber('amount');
      const reason = interaction.options.getString('reason') || 'Compensation';
      setBalance(target.id, getBalance(target.id) + amount);
      try { await target.send(`💰 You received **$${amount}** compensation. Reason: ${reason}`); } catch {}
      return interaction.editReply({ content: `✅ Compensated ${target.username} with $${amount}.` });
    }

    if (commandName === 'unfreeze') {
      const target = interaction.options.getUser('user');
      const keyData = getUserKey(target.id);
      if (!keyData) return interaction.editReply({ content: '❌ User has no linked key.' });
      await luarmorRequest('PATCH', `/projects/${keyData.project}/users`, { user_key: keyData.key, banned: false });
      return interaction.editReply({ content: `✅ Unfroze key for ${target.username}.` });
    }

    if (commandName === 'extend') {
      const target = interaction.options.getUser('user');
      const hours = interaction.options.getInteger('hours');
      const keyData = getUserKey(target.id);
      if (!keyData) return interaction.editReply({ content: '❌ User has no linked key.' });
      const luUser = await getUserByDiscord(keyData.project, target.id);
      if (!luUser) return interaction.editReply({ content: '❌ Key not found on Luarmor.' });
      const currentExpiry = luUser.auth_expire > 0 ? luUser.auth_expire : Math.floor(Date.now() / 1000);
      const newExpiry = currentExpiry + (hours * 3600);
      await luarmorRequest('PATCH', `/projects/${keyData.project}/users`, { user_key: keyData.key, auth_expire: newExpiry });
      return interaction.editReply({ content: `✅ Extended ${target.username} by ${hours}h. New expiry: <t:${newExpiry}:F>` });
    }

    if (commandName === 'resetroblox') {
      const target = interaction.options.getUser('user');
      const k = loadJSON(KEYS_FILE);
      if (k[target.id]) { delete k[target.id].roblox; saveJSON(KEYS_FILE, k); }
      return interaction.editReply({ content: `✅ Reset Roblox username for ${target.username}.` });
    }

  } catch (err) {
    console.error(`Error in ${commandName}:`, err);
    return interaction.editReply({ content: `❌ An error occurred: ${err.message}` });
  }
});

client.login(BOT_TOKEN);
