const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ROLE = process.env.ADMIN_ROLE;
const LUARMOR_KEY = process.env.LUARMOR_KEY;
const GUILD_ID = '1154193983766011934';

const PREMIUM_PROJECT = '8b3909f9359e16e6c5429c23f47a27ef';
const STANDARD_PROJECT = '01a8d5a1daeaae85268208d81d403e2d';
const PREMIUM_SLOTS = 8;
const STANDARD_SLOTS = 15;
const PREMIUM_PRICE = 6;
const STANDARD_PRICE = 4;

const PREMIUM_KEYS = [

  'ktZCuIJlZdqVGOwVEkgeYKivKzQbWjIx',
  'IvruORHLeVZWgsAtHJXwgVIWAvdZWeQw',
  'aPIuVxuzohidxeufbBarcJKrAyVzxVfI',
  'YDqHTANBHctVhofYTXcxtBdnMmqYBfXB',
  'FzQYjHWamPxQjRIdNiBSJuQLEyeYDzml',
  'ogiwIrnKYJvUyiyvPJcjlXEiVLuMyMMc',
  'XvaetdImElFIyHqlgKxSwTgfBDVoFfNp',
];

const STANDARD_KEYS = [
  'OOEUvIAxDuzlGMRaKtOkxabhnniGURER',
  'JBpnciaKQIBwuHRElkfefzWVjSseQQvV',
  'zqNiuZZVODwREUDRcZQxsMyWXlpuHQFB',
  'sxQmMIXTbkqFeexeZLnnvZIjvglAMFgd',
  'EAbQRtdTccCzQRyhcwDcnEWQzXVvzuMn',
  'hJJZQyjjgahjfZxgAyBGmMEezGVutCui',
  'WyQPHZqoxJELWKfbMabwACNfgzKJPXaa',
  'fyjzSWGFdcQDHptktSfQIZvFouoQnztC',
  'rVBPXfKjZPNDRtCtGYVVNgjqdSLTTkaA',
  'POUJWRTGyKYBeiwkHKlntdusKljDJZMk',
  'NgCNAilRVdhhWereCOplNfmTatvih ZFh',
  'CoSuEAOCuOyNKbEPjSsrpAldKHxNydFp',
  'lGKrNmjgVobvBTDZgVqlwxMQNrplHMym',
  'vJlhOcbmztMSEpkvvtQwnEsTUPpiioWs',
  'nRnLBXoKyUdZWYGLJQfshCJiMdDuuRSw',
];

// In-memory storage — persists across commands within one session
// Loaded from env vars on startup, saved back to env vars on every change
let keysData = {};
let balancesData = {};

// Railway env var update via API
async function saveToRailway(varName, value) {
  try {
    const projectId = process.env.RAILWAY_PROJECT_ID;
    const serviceId = process.env.RAILWAY_SERVICE_ID;
    const environmentId = process.env.RAILWAY_ENVIRONMENT_ID;
    const token = process.env.RAILWAY_API_TOKEN;
    if (!token || !projectId || !serviceId) return;
    await fetch('https://backboard.railway.app/graphql/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        query: `mutation { variableUpsert(input: { projectId: "${projectId}", environmentId: "${environmentId}", serviceId: "${serviceId}", name: "${varName}", value: ${JSON.stringify(JSON.stringify(value))} }) }`
      })
    });
  } catch(e) { console.log('Railway save failed:', e.message); }
}

function loadData() {
  try { keysData = JSON.parse(process.env.KEYS_DATA || '{}'); } catch { keysData = {}; }
  try { balancesData = JSON.parse(process.env.BALANCES_DATA || '{}'); } catch { balancesData = {}; }
}

async function saveKeys() {
  process.env.KEYS_DATA = JSON.stringify(keysData);
  await saveToRailway('KEYS_DATA', keysData);
}
async function saveBalances() {
  process.env.BALANCES_DATA = JSON.stringify(balancesData);
  await saveToRailway('BALANCES_DATA', balancesData);
}

function getBalance(userId) { return balancesData[userId] || 0; }
async function setBalance(userId, amount) { balancesData[userId] = amount; await saveBalances(); }
function getUserKey(userId) { return keysData[userId] || null; }
async function setUserKey(userId, data) { keysData[userId] = data; await saveKeys(); }
async function removeUserKey(userId) { delete keysData[userId]; await saveKeys(); }

async function luarmorRequest(method, path, body = null) {
  const url = `https://api.luarmor.net/v3${path}`;
  const opts = { method, headers: { 'Content-Type': 'application/json', 'authorization': LUARMOR_KEY } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
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
function getKeyPool(projectId) { return projectId === PREMIUM_PROJECT ? PREMIUM_KEYS : STANDARD_KEYS; }
async function getAvailableKey(projectId) {
  const pool = getKeyPool(projectId);
  const usedKeys = Object.values(keysData).filter(k => k && k.project === projectId).map(k => k.key);
  const available = pool.find(k => !usedKeys.includes(k));
  return available ? { user_key: available } : null;
}
async function assignKey(projectId, userKey, discordId, expiryTimestamp) {
  return await luarmorRequest('PATCH', `/projects/${projectId}/users`, { user_key: userKey, discord_id: discordId, auth_expire: expiryTimestamp });
}
async function resetHWID(projectId, userKey, force = false) {
  return await luarmorRequest('POST', `/projects/${projectId}/users/resethwid`, { user_key: userKey, force });
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
function getSlotCount(projectId) {
  return Object.values(keysData).filter(k => k && k.project === projectId).length;
}
function isAdmin(member) { return member.roles.cache.has(ADMIN_ROLE); }

const commands = [
  new SlashCommandBuilder().setName('key').setDescription('Link your Luarmor key')
    .addStringOption(o => o.setName('key').setDescription('Your key').setRequired(true))
    .addStringOption(o => o.setName('plan').setDescription('premium or standard').setRequired(true)
      .addChoices({ name: 'Premium', value: 'premium' }, { name: 'Standard', value: 'standard' })),
  new SlashCommandBuilder().setName('info').setDescription('Check your key info'),
  new SlashCommandBuilder().setName('resethwid').setDescription('Reset your HWID'),
  new SlashCommandBuilder().setName('balance').setDescription('Check your balance'),
  new SlashCommandBuilder().setName('buy').setDescription('Buy access using your balance')
    .addStringOption(o => o.setName('plan').setDescription('Plan').setRequired(true)
      .addChoices({ name: 'Premium - $6/hr', value: 'premium' }, { name: 'Standard - $4/hr', value: 'standard' }))
    .addIntegerOption(o => o.setName('hours').setDescription('Hours (min 2)').setRequired(true).setMinValue(2)),
  new SlashCommandBuilder().setName('slots').setDescription('View available slots'),
  new SlashCommandBuilder().setName('setroblox').setDescription('Set your Roblox username')
    .addStringOption(o => o.setName('username').setDescription('Roblox username').setRequired(true)),
  new SlashCommandBuilder().setName('addbalance').setDescription('[Admin] Add balance')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addNumberOption(o => o.setName('amount').setDescription('Amount').setRequired(true)),
  new SlashCommandBuilder().setName('removebalance').setDescription('[Admin] Remove balance')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addNumberOption(o => o.setName('amount').setDescription('Amount').setRequired(true)),
  new SlashCommandBuilder().setName('addtime').setDescription('[Admin] Add time to key')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addIntegerOption(o => o.setName('hours').setDescription('Hours').setRequired(true)),
  new SlashCommandBuilder().setName('removetime').setDescription('[Admin] Remove time from key')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addIntegerOption(o => o.setName('hours').setDescription('Hours').setRequired(true)),
  new SlashCommandBuilder().setName('adminresethwid').setDescription('[Admin] Force reset HWID')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),
  new SlashCommandBuilder().setName('blacklist').setDescription('[Admin] Blacklist user')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),
  new SlashCommandBuilder().setName('unblacklist').setDescription('[Admin] Unblacklist user')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),
  new SlashCommandBuilder().setName('createkey').setDescription('[Admin] Create key')
    .addStringOption(o => o.setName('plan').setDescription('Plan').setRequired(true)
      .addChoices({ name: 'Premium', value: 'premium' }, { name: 'Standard', value: 'standard' }))
    .addIntegerOption(o => o.setName('hours').setDescription('Hours').setRequired(true)),
  new SlashCommandBuilder().setName('deletekey').setDescription('[Admin] Delete key')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),
  new SlashCommandBuilder().setName('givekey').setDescription('[Admin] Give key')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addStringOption(o => o.setName('plan').setDescription('Plan').setRequired(true)
      .addChoices({ name: 'Premium', value: 'premium' }, { name: 'Standard', value: 'standard' }))
    .addIntegerOption(o => o.setName('hours').setDescription('Hours').setRequired(true)),
  new SlashCommandBuilder().setName('userinfo').setDescription('[Admin] View all active users'),
  new SlashCommandBuilder().setName('removekey').setDescription('[Admin] Unlink key')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),
  new SlashCommandBuilder().setName('listkeys').setDescription('[Admin] List keys')
    .addStringOption(o => o.setName('plan').setDescription('Plan').setRequired(true)
      .addChoices({ name: 'Premium', value: 'premium' }, { name: 'Standard', value: 'standard' })),
  new SlashCommandBuilder().setName('compensate').setDescription('[Admin] Compensate user')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addNumberOption(o => o.setName('amount').setDescription('Amount').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),
  new SlashCommandBuilder().setName('unfreeze').setDescription('[Admin] Unfreeze key')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),
  new SlashCommandBuilder().setName('extend').setDescription('[Admin] Extend key')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addIntegerOption(o => o.setName('hours').setDescription('Hours').setRequired(true)),
  new SlashCommandBuilder().setName('resetroblox').setDescription('[Admin] Reset Roblox username')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),
].map(c => c.toJSON());

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('clientReady', async () => {
  loadData();
  console.log('Bot ready: ' + client.user.tag);
  console.log('Loaded keys:', Object.keys(keysData).length, '| balances:', Object.keys(balancesData).length);
  try {
    const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
    await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
    console.log('Commands registered OK');
  } catch(e) { console.error('Command register failed:', e.message); }

  setInterval(async () => {
    try {
      const now = Math.floor(Date.now() / 1000);
      let changed = false;
      for (const [userId, keyData] of Object.entries(keysData)) {
        if (!keyData?.expiry) continue;
        if (now >= keyData.expiry) {
          try { await luarmorRequest('PATCH', `/projects/${keyData.project}/users`, { user_key: keyData.key, discord_id: '', identifier: '', auth_expire: -1, banned: false }); } catch(e) {}
          try { const u = await client.users.fetch(userId); await u.send(`⏰ Your **${keyData.plan}** key expired! Use /buy to purchase again.`); } catch(e) {}
          const roblox = keysData[userId]?.roblox;
          delete keysData[userId];
          if (roblox) keysData[userId] = { roblox };
          changed = true;
        }
      }
      if (changed) await saveKeys();
    } catch(e) { console.error('[EXPIRY]', e); }
  }, 5 * 60 * 1000);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, member, user } = interaction;
  const adminOnly = ['addbalance','removebalance','addtime','removetime','adminresethwid','blacklist','unblacklist','createkey','deletekey','givekey','userinfo','removekey','listkeys','compensate','unfreeze','extend','resetroblox'];
  if (adminOnly.includes(commandName) && !isAdmin(member)) {
    return interaction.reply({ content: '❌ No permission.', ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });
  try {
    if (commandName === 'slots') {
      const now2 = Math.floor(Date.now() / 1000);
      const premTaken = getSlotCount(PREMIUM_PROJECT);
      const stdTaken = getSlotCount(STANDARD_PROJECT);
      const premUsers = Object.entries(keysData).filter(([,k]) => k?.key && k.project === PREMIUM_PROJECT && k.expiry && now2 < k.expiry);
      const stdUsers = Object.entries(keysData).filter(([,k]) => k?.key && k.project === STANDARD_PROJECT && k.expiry && now2 < k.expiry);
      let premLines = `${premTaken}/${PREMIUM_SLOTS} taken | ${PREMIUM_SLOTS-premTaken} available | $${PREMIUM_PRICE}/hr\n`;
      for (const [,k] of premUsers) premLines += `• ${k.roblox||'Unknown'} — <t:${k.expiry}:R>\n`;
      let stdLines = `${stdTaken}/${STANDARD_SLOTS} taken | ${STANDARD_SLOTS-stdTaken} available | $${STANDARD_PRICE}/hr\n`;
      for (const [,k] of stdUsers) stdLines += `• ${k.roblox||'Unknown'} — <t:${k.expiry}:R>\n`;
      return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🎰 Available Slots').setColor(0x2b2d31)
        .addFields({ name: '💎 Premium', value: premLines||'No active users', inline: false }, { name: '⭐ Standard', value: stdLines||'No active users', inline: false })] });
    }
    if (commandName === 'balance') {
      return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('💰 Your Balance').setDescription(`$${getBalance(user.id).toFixed(2)}`).setColor(0x2b2d31)] });
    }
    if (commandName === 'key') {
      const userKey = interaction.options.getString('key');
      const plan = interaction.options.getString('plan');
      const projectId = plan === 'premium' ? PREMIUM_PROJECT : STANDARD_PROJECT;
      const users = await getProjectUsers(projectId);
      const found = users.find(u => u.user_key === userKey);
      if (!found) return interaction.editReply({ content: '❌ Key not found.' });
      await setUserKey(user.id, { key: userKey, plan, project: projectId });
      await luarmorRequest('PATCH', `/projects/${projectId}/users`, { user_key: userKey, discord_id: user.id });
      return interaction.editReply({ content: `✅ Key linked! Plan: **${plan}**` });
    }
    if (commandName === 'info') {
      const keyData = getUserKey(user.id);
      if (!keyData) return interaction.editReply({ content: '❌ No key linked.' });
      const luUser = await getUserByDiscord(keyData.project, user.id);
      if (!luUser) return interaction.editReply({ content: '❌ Key not found on Luarmor.' });
      const expiry = luUser.auth_expire > 0 ? `<t:${luUser.auth_expire}:F>` : 'Never';
      return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🔑 Key Info').setColor(0x2b2d31)
        .addFields({ name: 'Plan', value: keyData.plan, inline: true }, { name: 'Key', value: `||${luUser.user_key}||`, inline: true },
          { name: 'Status', value: luUser.banned ? '🔴 Banned' : '🟢 Active', inline: true }, { name: 'Expires', value: expiry, inline: true })] });
    }
    if (commandName === 'resethwid') {
      const keyData = getUserKey(user.id);
      if (!keyData) return interaction.editReply({ content: '❌ No key linked.' });
      const r = await resetHWID(keyData.project, keyData.key, false);
      return interaction.editReply({ content: r.status === 200 ? '✅ HWID reset!' : `❌ Failed: ${r.data?.message}` });
    }
    if (commandName === 'buy') {
      const plan = interaction.options.getString('plan');
      const hours = interaction.options.getInteger('hours');
      const projectId = plan === 'premium' ? PREMIUM_PROJECT : STANDARD_PROJECT;
      const pricePerHour = plan === 'premium' ? PREMIUM_PRICE : STANDARD_PRICE;
      const totalCost = pricePerHour * hours;
      const bal = getBalance(user.id);
      const existingKey = keysData[user.id];
      const nowCheck = Math.floor(Date.now() / 1000);
      if (existingKey?.key && existingKey?.expiry && nowCheck < existingKey.expiry) {
        return interaction.editReply({ content: `❌ You already have an active **${existingKey.plan}** key expiring <t:${existingKey.expiry}:R>.` });
      }
      if (!keysData[user.id]?.roblox) return interaction.editReply({ content: '❌ Set your Roblox username first with /setroblox!' });
      if (bal < totalCost) return interaction.editReply({ content: `❌ Insufficient balance. Have **$${bal.toFixed(2)}**, need **$${totalCost.toFixed(2)}**.` });
      const taken = getSlotCount(projectId);
      const maxSlots = plan === 'premium' ? PREMIUM_SLOTS : STANDARD_SLOTS;
      if (taken >= maxSlots) return interaction.editReply({ content: `❌ No ${plan} slots available.` });
      const available = await getAvailableKey(projectId);
      if (!available) return interaction.editReply({ content: '❌ No keys available. Contact admin.' });
      const expiry = Math.floor(Date.now() / 1000) + (hours * 3600);
      try { await assignKey(projectId, available.user_key, user.id, expiry); } catch(e) {}
      await setBalance(user.id, bal - totalCost);
      const existing = keysData[user.id] || {};
      await setUserKey(user.id, { ...existing, key: available.user_key, plan, project: projectId, expiry });
      try {
        await interaction.user.send({ embeds: [new EmbedBuilder().setTitle('🎉 Purchase Successful!').setColor(0x2b2d31)
          .addFields({ name: 'Plan', value: plan, inline: true }, { name: 'Duration', value: `${hours}h`, inline: true },
            { name: 'Cost', value: `$${totalCost.toFixed(2)}`, inline: true }, { name: 'Key', value: `||${available.user_key}||`, inline: false },
            { name: 'Expires', value: `<t:${expiry}:F>`, inline: false })] });
      } catch {}
      return interaction.editReply({ content: `✅ Done! **$${totalCost.toFixed(2)}** deducted. Key sent to DMs!` });
    }
    if (commandName === 'setroblox') {
      const username = interaction.options.getString('username');
      if (!keysData[user.id]) keysData[user.id] = {};
      keysData[user.id].roblox = username;
      await saveKeys();
      return interaction.editReply({ content: `✅ Roblox username set to **${username}**!` });
    }
    if (commandName === 'addbalance') {
      const target = interaction.options.getUser('user');
      const amount = interaction.options.getNumber('amount');
      await setBalance(target.id, getBalance(target.id) + amount);
      return interaction.editReply({ content: `✅ Added **$${amount}** to ${target.username}. Balance: **$${getBalance(target.id).toFixed(2)}**` });
    }
    if (commandName === 'removebalance') {
      const target = interaction.options.getUser('user');
      const amount = interaction.options.getNumber('amount');
      await setBalance(target.id, Math.max(0, getBalance(target.id) - amount));
      return interaction.editReply({ content: `✅ Removed **$${amount}** from ${target.username}.` });
    }
    if (commandName === 'addtime') {
      const target = interaction.options.getUser('user');
      const hours = interaction.options.getInteger('hours');
      const keyData = getUserKey(target.id);
      if (!keyData) return interaction.editReply({ content: '❌ No key found.' });
      const current = keyData.expiry || Math.floor(Date.now() / 1000);
      const newExpiry = current + (hours * 3600);
      keysData[target.id].expiry = newExpiry;
      await saveKeys();
      try { await luarmorRequest('PATCH', `/projects/${keyData.project}/users`, { user_key: keyData.key, auth_expire: newExpiry }); } catch(e) {}
      return interaction.editReply({ content: `✅ Added **${hours}h** to ${target.username}. Expires <t:${newExpiry}:F>` });
    }
    if (commandName === 'removetime') {
      const target = interaction.options.getUser('user');
      const hours = interaction.options.getInteger('hours');
      const keyData = getUserKey(target.id);
      if (!keyData) return interaction.editReply({ content: '❌ No key found.' });
      const newExpiry = Math.max(Math.floor(Date.now() / 1000), (keyData.expiry||0) - (hours * 3600));
      keysData[target.id].expiry = newExpiry;
      await saveKeys();
      try { await luarmorRequest('PATCH', `/projects/${keyData.project}/users`, { user_key: keyData.key, auth_expire: newExpiry }); } catch(e) {}
      return interaction.editReply({ content: `✅ Removed **${hours}h** from ${target.username}.` });
    }
    if (commandName === 'adminresethwid') {
      const target = interaction.options.getUser('user');
      const keyData = getUserKey(target.id);
      if (!keyData) return interaction.editReply({ content: '❌ No key found.' });
      const r = await resetHWID(keyData.project, keyData.key, true);
      return interaction.editReply({ content: r.status === 200 ? `✅ HWID reset for ${target.username}` : `❌ Failed: ${r.data?.message}` });
    }
    if (commandName === 'blacklist') {
      const target = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason') || 'No reason';
      const keyData = getUserKey(target.id);
      if (!keyData) return interaction.editReply({ content: '❌ No key found.' });
      await luarmorRequest('PATCH', `/projects/${keyData.project}/users`, { user_key: keyData.key, banned: true, note: `banned:${reason}` });
      return interaction.editReply({ content: `✅ Blacklisted ${target.username}.` });
    }
    if (commandName === 'unblacklist') {
      const target = interaction.options.getUser('user');
      const keyData = getUserKey(target.id);
      if (!keyData) return interaction.editReply({ content: '❌ No key found.' });
      await luarmorRequest('PATCH', `/projects/${keyData.project}/users`, { user_key: keyData.key, banned: false });
      return interaction.editReply({ content: `✅ Unblacklisted ${target.username}.` });
    }
    if (commandName === 'createkey') {
      const plan = interaction.options.getString('plan');
      const hours = interaction.options.getInteger('hours');
      const projectId = plan === 'premium' ? PREMIUM_PROJECT : STANDARD_PROJECT;
      const expiry = Math.floor(Date.now() / 1000) + (hours * 3600);
      const r = await luarmorRequest('POST', `/projects/${projectId}/users`, { auth_expire: expiry });
      return interaction.editReply({ content: (r.status===200||r.status===201) ? `✅ Created: ||${r.data.user_key}||` : `❌ Failed: ${r.data?.message}` });
    }
    if (commandName === 'deletekey') {
      const target = interaction.options.getUser('user');
      const keyData = getUserKey(target.id);
      if (!keyData) return interaction.editReply({ content: '❌ No key found.' });
      await deleteKey(keyData.project, keyData.key);
      await removeUserKey(target.id);
      return interaction.editReply({ content: `✅ Deleted key for ${target.username}.` });
    }
    if (commandName === 'givekey') {
      const target = interaction.options.getUser('user');
      const plan = interaction.options.getString('plan');
      const hours = interaction.options.getInteger('hours');
      const projectId = plan === 'premium' ? PREMIUM_PROJECT : STANDARD_PROJECT;
      const expiry = Math.floor(Date.now() / 1000) + (hours * 3600);
      const available = await getAvailableKey(projectId);
      if (!available) return interaction.editReply({ content: '❌ No available keys.' });
      await assignKey(projectId, available.user_key, target.id, expiry);
      const existing = keysData[target.id] || {};
      await setUserKey(target.id, { ...existing, key: available.user_key, plan, project: projectId, expiry });
      try { await target.send(`🎁 You got a **${plan}** key!\nKey: ||${available.user_key}||\nExpires: <t:${expiry}:F>`); } catch {}
      return interaction.editReply({ content: `✅ Gave ${target.username} a ${plan} key for ${hours}h.` });
    }
    if (commandName === 'userinfo') {
      const nowTs = Math.floor(Date.now() / 1000);
      const active = Object.entries(keysData).filter(([,k]) => k?.key && k.expiry && nowTs < k.expiry);
      if (active.length === 0) return interaction.editReply({ content: 'No active users.' });
      let premLines = '**💎 Premium**\n', stdLines = '**⭐ Standard**\n';
      let hasPrem = false, hasStd = false;
      for (const [uid, k] of active) {
        let discordName = uid;
        try { const u = await client.users.fetch(uid); discordName = u.username; } catch(e) {}
        const line = `• **${discordName}** — ${k.roblox||'Not set'} — <t:${k.expiry}:R>\n`;
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
      if (!keyData) return interaction.editReply({ content: '❌ No key found.' });
      await luarmorRequest('PATCH', `/projects/${keyData.project}/users`, { user_key: keyData.key, discord_id: '' });
      await removeUserKey(target.id);
      return interaction.editReply({ content: `✅ Removed key for ${target.username}.` });
    }
    if (commandName === 'listkeys') {
      const plan = interaction.options.getString('plan');
      const projectId = plan === 'premium' ? PREMIUM_PROJECT : STANDARD_PROJECT;
      const pool = getKeyPool(projectId);
      const lines = pool.map(k => {
        const entry = Object.entries(keysData).find(([,v]) => v?.key === k);
        return `\`${k}\` — ${entry ? `<@${entry[0]}>` : 'Available'}`;
      }).join('\n');
      return interaction.editReply({ content: `**${plan} keys:**\n${lines}` });
    }
    if (commandName === 'compensate') {
      const target = interaction.options.getUser('user');
      const amount = interaction.options.getNumber('amount');
      const reason = interaction.options.getString('reason') || 'Compensation';
      await setBalance(target.id, getBalance(target.id) + amount);
      try { await target.send(`💰 You received **$${amount}**. Reason: ${reason}`); } catch {}
      return interaction.editReply({ content: `✅ Compensated ${target.username} $${amount}.` });
    }
    if (commandName === 'unfreeze') {
      const target = interaction.options.getUser('user');
      const keyData = getUserKey(target.id);
      if (!keyData) return interaction.editReply({ content: '❌ No key found.' });
      await luarmorRequest('PATCH', `/projects/${keyData.project}/users`, { user_key: keyData.key, banned: false });
      return interaction.editReply({ content: `✅ Unfroze ${target.username}.` });
    }
    if (commandName === 'extend') {
      const target = interaction.options.getUser('user');
      const hours = interaction.options.getInteger('hours');
      const keyData = getUserKey(target.id);
      if (!keyData) return interaction.editReply({ content: '❌ No key found.' });
      const newExpiry = (keyData.expiry || Math.floor(Date.now()/1000)) + (hours * 3600);
      keysData[target.id].expiry = newExpiry;
      await saveKeys();
      try { await luarmorRequest('PATCH', `/projects/${keyData.project}/users`, { user_key: keyData.key, auth_expire: newExpiry }); } catch(e) {}
      return interaction.editReply({ content: `✅ Extended ${target.username} by ${hours}h. Expires <t:${newExpiry}:F>` });
    }
    if (commandName === 'resetroblox') {
      const target = interaction.options.getUser('user');
      if (keysData[target.id]) { delete keysData[target.id].roblox; await saveKeys(); }
      return interaction.editReply({ content: `✅ Reset Roblox for ${target.username}.` });
    }
  } catch (err) {
    console.error(`Error in ${commandName}:`, err);
    return interaction.editReply({ content: `❌ Error: ${err.message}` });
  }
});

client.login(BOT_TOKEN);
