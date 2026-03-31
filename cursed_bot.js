const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const axios = require('axios');
const fs = require('fs');

// ─── CONFIG ───────────────────────────────────────────────
const BOT_TOKEN   = process.env.BOT_TOKEN;
const ADMIN_ROLE  = process.env.ADMIN_ROLE;
const LUARMOR_KEY = process.env.LUARMOR_KEY;
const PROJECTS = {
    premium:  { id: "8b3909f9359e16e6c5429c23f47a27ef",  slots: 8,  price: "$8.00 / hour (2hr min)" },
    standard: { id: "01a8d5a1daeaae85268208d81d403e2d", slots: 15, price: "$4.00 / hour (2hr min)" },
};
const LUARMOR = "https://api.luarmor.net/v3";
const headers = { "x-api-key": LUARMOR_KEY };
const DATA_FILE = "./bot_data.json";

// ─── PERSISTENT DATA ──────────────────────────────────────
function loadData() {
    try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
    catch { return { balances: {}, userKeys: {}, hwidCooldown: {}, robloxNames: {}, frozenKeys: [] }; }
}
function saveData() { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }
let data = loadData();

// ─── LUARMOR API ──────────────────────────────────────────
async function getAllUsers(projectId) {
    try {
        const r = await axios.get(`${LUARMOR}/projects/${projectId}/users`, { headers });
        return r.data?.users || [];
    } catch { return []; }
}
async function getUser(projectId, key) {
    const users = await getAllUsers(projectId);
    return users.find(u => u.key === key) || null;
}
async function apiPost(path, body) {
    try {
        const r = await axios.post(`${LUARMOR}${path}`, body, { headers });
        return r.data;
    } catch(e) {
        const errMsg = e?.response?.data?.message || e?.response?.data || e.message || "Failed";
        const status = e?.response?.status || "no status";
        console.error(`API Error [${status}] on ${path}:`, JSON.stringify(e?.response?.data), "Body sent:", JSON.stringify(body));
        return { success: false, message: `${status}: ${JSON.stringify(errMsg)}` };
    }
}
const resetHWID      = (pid, key)         => apiPost(`/projects/${pid}/users/reset-hwid`, { user_key: key });
const blacklistKey   = (pid, key, reason) => apiPost(`/projects/${pid}/users/blacklist`, { user_key: key, reason });
const unblacklistKey = (pid, key)         => apiPost(`/projects/${pid}/users/unblacklist`, { user_key: key });
const addTime        = (pid, key, days)   => apiPost(`/projects/${pid}/users/add-time`, { user_key: key, days });
const removeTime     = (pid, key, days)   => apiPost(`/projects/${pid}/users/remove-time`, { key, days });
const deleteKey      = (pid, key)         => apiPost(`/projects/${pid}/users?user_key=${key}`, {});
// Get an available unassigned key from the pool
async function getAvailableKey(projectId) {
    const users = await getAllUsers(projectId);
    console.log(`getAvailableKey: total=${users.length} first=${JSON.stringify(users[0])}`);
    return users.find(u => !u.discord_id && !u.hwid && !u.blacklisted) || null;
}

// Assign an existing key to a user by setting expiry and identifier
async function assignKey(projectId, key, discordId, expireTs) {
    try {
        const r = await axios.patch(`${LUARMOR}/projects/${projectId}/users?user_key=${key}`, {
            identifier: discordId,
            auth_expire: expireTs,
        }, { headers });
        return { ...r.data, user_key: key };
    } catch(e) {
        const errMsg = e?.response?.data?.message || e.message || "Failed";
        console.error("assignKey error:", e?.response?.status, JSON.stringify(e?.response?.data));
        return { success: false, message: errMsg };
    }
}

// ─── HELPERS ──────────────────────────────────────────────
function isAdmin(member) {
    return member.roles.cache.has(ADMIN_ROLE) || member.permissions.has(PermissionFlagsBits.Administrator);
}
function embed(title, desc, color = 0x2E78F0) {
    return new EmbedBuilder().setTitle(title).setDescription(desc).setColor(color)
        .setFooter({ text: "Cursed Notifier" }).setTimestamp();
}
function formatDate(ts) {
    if (!ts) return "Never";
    return new Date(ts * 1000).toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" });
}
function planName(p) { return p.charAt(0).toUpperCase() + p.slice(1); }
function getBalance(userId) { return (data.balances[userId] || 0).toFixed(2); }
function noKey(interaction, user) {
    const msg = user ? `${user} hasn't linked a key.` : "You haven't linked a key yet. Use `/key` first.";
    return interaction.editReply({ embeds: [embed("❌ No Key Found", msg, 0xFF3333)] });
}
function noAdmin(interaction) {
    return interaction.editReply({ embeds: [embed("❌ No Permission", "You need the admin role to use this command.", 0xFF3333)] });
}

// ─── COMMANDS ─────────────────────────────────────────────
const commands = [
    // USER
    new SlashCommandBuilder().setName("key").setDescription("Link your Luarmor key to your Discord account")
        .addStringOption(o => o.setName("key").setDescription("Your key").setRequired(true))
        .addStringOption(o => o.setName("plan").setDescription("Your plan").setRequired(true)
            .addChoices({name:"Premium",value:"premium"},{name:"Standard",value:"standard"})),

    new SlashCommandBuilder().setName("info").setDescription("Check your key info and expiry"),

    new SlashCommandBuilder().setName("resethwid_self").setDescription("Reset your own HWID (24h cooldown)"),

    new SlashCommandBuilder().setName("balance").setDescription("Check your balance"),

    new SlashCommandBuilder().setName("buy").setDescription("Buy a key using your balance")
        .addStringOption(o => o.setName("plan").setDescription("Plan to buy").setRequired(true)
            .addChoices({name:"Premium",value:"premium"},{name:"Standard",value:"standard"}))
        .addIntegerOption(o => o.setName("hours").setDescription("How many hours").setRequired(true)),

    new SlashCommandBuilder().setName("slots").setDescription("View available slots and pricing"),

    new SlashCommandBuilder().setName("setroblox").setDescription("Set your Roblox username (can change every 24h)")
        .addStringOption(o => o.setName("username").setDescription("Your Roblox username").setRequired(true)),

    // ADMIN
    new SlashCommandBuilder().setName("addbalance").setDescription("[ADMIN] Add balance to a user")
        .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
        .addNumberOption(o => o.setName("amount").setDescription("Amount in $").setRequired(true)),

    new SlashCommandBuilder().setName("removebalance").setDescription("[ADMIN] Remove balance from a user")
        .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
        .addNumberOption(o => o.setName("amount").setDescription("Amount in $").setRequired(true)),

    new SlashCommandBuilder().setName("addtime").setDescription("[ADMIN] Add time to a user's key")
        .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
        .addIntegerOption(o => o.setName("days").setDescription("Days to add").setRequired(true)),

    new SlashCommandBuilder().setName("removetime").setDescription("[ADMIN] Remove time from a user's key")
        .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
        .addIntegerOption(o => o.setName("days").setDescription("Days to remove").setRequired(true)),

    new SlashCommandBuilder().setName("resethwid").setDescription("[ADMIN] Reset a user's HWID")
        .addUserOption(o => o.setName("user").setDescription("User").setRequired(true)),

    new SlashCommandBuilder().setName("resetroblox").setDescription("[ADMIN] Force reset a user's Roblox username cooldown")
        .addUserOption(o => o.setName("user").setDescription("User").setRequired(true)),

    new SlashCommandBuilder().setName("blacklist").setDescription("[ADMIN] Blacklist a user's key")
        .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
        .addStringOption(o => o.setName("reason").setDescription("Reason")),

    new SlashCommandBuilder().setName("unblacklist").setDescription("[ADMIN] Unblacklist a user's key")
        .addUserOption(o => o.setName("user").setDescription("User").setRequired(true)),

    new SlashCommandBuilder().setName("extend").setDescription("[ADMIN] Add 1 free day to a user's key")
        .addUserOption(o => o.setName("user").setDescription("User").setRequired(true)),

    new SlashCommandBuilder().setName("createkey").setDescription("[ADMIN] Create a new Luarmor key")
        .addStringOption(o => o.setName("plan").setDescription("Plan").setRequired(true)
            .addChoices({name:"Premium",value:"premium"},{name:"Standard",value:"standard"}))
        .addIntegerOption(o => o.setName("days").setDescription("Days").setRequired(true))
        .addStringOption(o => o.setName("identifier").setDescription("Identifier (optional)")),

    new SlashCommandBuilder().setName("deletekey").setDescription("[ADMIN] Delete a user's key")
        .addUserOption(o => o.setName("user").setDescription("User").setRequired(true)),

    new SlashCommandBuilder().setName("givekey").setDescription("[ADMIN] Give a user a new key")
        .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
        .addStringOption(o => o.setName("plan").setDescription("Plan").setRequired(true)
            .addChoices({name:"Premium",value:"premium"},{name:"Standard",value:"standard"}))
        .addIntegerOption(o => o.setName("days").setDescription("Days").setRequired(true)),

    new SlashCommandBuilder().setName("listkeys").setDescription("[ADMIN] List all keys for a plan")
        .addStringOption(o => o.setName("plan").setDescription("Plan").setRequired(true)
            .addChoices({name:"Premium",value:"premium"},{name:"Standard",value:"standard"})),

    new SlashCommandBuilder().setName("compensate").setDescription("[ADMIN] Add time to ALL active keys")
        .addStringOption(o => o.setName("plan").setDescription("Plan").setRequired(true)
            .addChoices({name:"Premium",value:"premium"},{name:"Standard",value:"standard"},
                       {name:"Both",value:"both"}))
        .addIntegerOption(o => o.setName("days").setDescription("Days to add to everyone").setRequired(true)),

    new SlashCommandBuilder().setName("userinfo").setDescription("[ADMIN] Get info about a user's key")
        .addUserOption(o => o.setName("user").setDescription("User").setRequired(true)),

    new SlashCommandBuilder().setName("removekey").setDescription("[ADMIN] Unlink a user's key from the bot")
        .addUserOption(o => o.setName("user").setDescription("User").setRequired(true)),

    new SlashCommandBuilder().setName("unfreeze").setDescription("[ADMIN] Restore all backed up frozen keys"),

].map(c => c.toJSON());

// ─── BOT ──────────────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", async () => {
    console.log(`✅ Cursed Notifier Bot online as ${client.user.tag}`);
    const rest = new REST({ version: "10" }).setToken(BOT_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log("✅ Slash commands registered!");
    } catch(e) { console.error("❌ Failed to register commands:", e); }
});

client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, user, member } = interaction;
    await interaction.deferReply({ ephemeral: true });

    try {
        // ══════════════════════════════════════════
        // USER COMMANDS
        // ══════════════════════════════════════════

        if (commandName === "key") {
            const key     = interaction.options.getString("key");
            const plan    = interaction.options.getString("plan");
            const project = PROJECTS[plan].id;
            const luaUser = await getUser(project, key);
            if (!luaUser) return interaction.editReply({ embeds: [embed("❌ Invalid Key", "That key was not found. Make sure you picked the right plan.", 0xFF3333)] });
            data.userKeys[user.id] = { key, project, plan };
            saveData();
            return interaction.editReply({ embeds: [embed("✅ Key Linked",
                `Your **${planName(plan)}** key has been linked!\n\n**Key:** \`${key}\`\n**Expires:** ${formatDate(luaUser.auth_expire)}\n**Status:** ${luaUser.blacklisted ? "🔴 Blacklisted" : "🟢 Active"}`,
                0x00CC66)] });
        }

        if (commandName === "info") {
            const d = data.userKeys[user.id];
            if (!d) return noKey(interaction);
            const luaUser = await getUser(d.project, d.key);
            if (!luaUser) return interaction.editReply({ embeds: [embed("❌ Key Not Found", "Your key no longer exists.", 0xFF3333)] });
            return interaction.editReply({ embeds: [embed("🔑 Your Key Info",
                `**Plan:** ${planName(d.plan)}\n**Key:** \`${d.key}\`\n**Expires:** ${formatDate(luaUser.auth_expire)}\n` +
                `**HWID:** ${luaUser.hwid || "Not set"}\n**Status:** ${luaUser.blacklisted ? "🔴 Blacklisted" : "🟢 Active"}`,
                0x2E78F0)] });
        }

        if (commandName === "resethwid_self") {
            const d = data.userKeys[user.id];
            if (!d) return noKey(interaction);
            const now = Date.now();
            const last = data.hwidCooldown[d.key] || 0;
            if (now - last < 86400000) {
                const hrs = Math.ceil((86400000 - (now - last)) / 3600000);
                return interaction.editReply({ embeds: [embed("⏳ Cooldown", `You can reset your HWID again in **${hrs} hour(s)**.`, 0xFF9900)] });
            }
            const result = await resetHWID(d.project, d.key);
            if (result?.success === false) return interaction.editReply({ embeds: [embed("❌ Failed", result.message, 0xFF3333)] });
            data.hwidCooldown[d.key] = now;
            saveData();
            return interaction.editReply({ embeds: [embed("✅ HWID Reset", "Your HWID has been reset! You can now use your key on a new device.", 0x00CC66)] });
        }

        if (commandName === "balance") {
            return interaction.editReply({ embeds: [embed("💰 Your Balance",
                `**Balance**\n$${getBalance(user.id)}`, 0x2E78F0)] });
        }

        if (commandName === "buy") {
            const plan    = interaction.options.getString("plan");
            const hours   = interaction.options.getInteger("hours");
            const pricePerHour = plan === "premium" ? 8 : 4;
            if (hours < 2) return interaction.editReply({ embeds: [embed("❌ Minimum 2 Hours", "You must buy at least **2 hours**.", 0xFF3333)] });
            const total   = pricePerHour * hours;
            const bal     = data.balances[user.id] || 0;
            if (bal < total) {
                return interaction.editReply({ embeds: [embed("❌ Insufficient Balance",
                    `You need **$${total.toFixed(2)}** but only have **$${bal.toFixed(2)}**.\nAsk an admin to top up your balance.`,
                    0xFF3333)] });
            }
            // Check slots available
            const users   = await getAllUsers(PROJECTS[plan].id);
            const active  = users.filter(u => !u.blacklisted).length;
            const maxSlots = PROJECTS[plan].slots;
            if (active >= maxSlots) {
                return interaction.editReply({ embeds: [embed("❌ No Slots Available",
                    `All **${maxSlots} ${planName(plan)}** slots are currently taken. Check back later!`, 0xFF3333)] });
            }
            const expireTs = Math.floor(Date.now() / 1000) + (hours * 3600);
            const availKey = await getAvailableKey(PROJECTS[plan].id);
            if (!availKey) return interaction.editReply({ embeds: [embed("❌ No Keys Available", "No available keys in the pool. Please contact an admin.", 0xFF3333)] });
            const result = await assignKey(PROJECTS[plan].id, availKey.key, user.id, expireTs);
            if (!result?.user_key) return interaction.editReply({ embeds: [embed("❌ Failed", result?.message || "Failed to assign key.", 0xFF3333)] });
            data.balances[user.id] = parseFloat((bal - total).toFixed(2));
            data.userKeys[user.id] = { key: result.user_key, project: PROJECTS[plan].id, plan };
            saveData();
            try {
                await user.send({ embeds: [embed("🎉 Purchase Successful!",
                    `You bought a **${planName(plan)}** key!\n\n**Key:** \`${result.user_key}\`\n**Duration:** ${hours} hours\n**Charged:** $${total.toFixed(2)}`,
                    0x00CC66)] });
            } catch {}
            return interaction.editReply({ embeds: [embed("✅ Purchase Successful!",
                `**Plan:** ${planName(plan)}\n**Key:** \`${result.user_key}\`\n**Duration:** ${hours} hours\n**Charged:** $${total.toFixed(2)}\n**New Balance:** $${getBalance(user.id)}\n\nKey sent to your DMs!`,
                0x00CC66)] });
        }

        if (commandName === "slots") {
            const premUsers = await getAllUsers(PROJECTS.premium.id);
            const stdUsers  = await getAllUsers(PROJECTS.standard.id);
            const premActive = premUsers.filter(u => !u.blacklisted).length;
            const stdActive  = stdUsers.filter(u => !u.blacklisted).length;
            const premAvail  = PROJECTS.premium.slots - premActive;
            const stdAvail   = PROJECTS.standard.slots - stdActive;
            return interaction.editReply({ embeds: [embed("🎰 Key Shop",
                `**Status** — Active\n\n` +
                `**Premium (${premActive}/${PROJECTS.premium.slots} taken)**\n${premAvail > 0 ? `Price: ${PROJECTS.premium.price}` : "❌ No slots available"}\n\n` +
                `**Standard (${stdActive}/${PROJECTS.standard.slots} taken)**\n${stdAvail > 0 ? `Price: ${PROJECTS.standard.price}` : "❌ No slots available"}\n\n` +
                `**How to buy**\nUse \`/buy\` to purchase a key`,
                0x2E78F0)] });
        }

        if (commandName === "setroblox") {
            const username = interaction.options.getString("username");
            const now = Date.now();
            const last = data.robloxNames[user.id]?.ts || 0;
            if (now - last < 86400000) {
                const hrs = Math.ceil((86400000 - (now - last)) / 3600000);
                return interaction.editReply({ embeds: [embed("⏳ Cooldown", `You can change your Roblox username again in **${hrs} hour(s)**.`, 0xFF9900)] });
            }
            data.robloxNames[user.id] = { username, ts: now };
            saveData();
            return interaction.editReply({ embeds: [embed("✅ Roblox Username Set", `Your Roblox username has been set to **${username}**.`, 0x00CC66)] });
        }

        // ══════════════════════════════════════════
        // ADMIN COMMANDS
        // ══════════════════════════════════════════
        if (!isAdmin(member)) return noAdmin(interaction);

        if (commandName === "addbalance") {
            const target = interaction.options.getUser("user");
            const amount = interaction.options.getNumber("amount");
            data.balances[target.id] = parseFloat(((data.balances[target.id] || 0) + amount).toFixed(2));
            saveData();
            return interaction.editReply({ embeds: [embed("✅ Balance Added",
                `Added **$${amount.toFixed(2)}** to ${target}'s balance.\n**New Balance:** $${getBalance(target.id)}`, 0x00CC66)] });
        }

        if (commandName === "removebalance") {
            const target = interaction.options.getUser("user");
            const amount = interaction.options.getNumber("amount");
            data.balances[target.id] = parseFloat(Math.max(0, (data.balances[target.id] || 0) - amount).toFixed(2));
            saveData();
            return interaction.editReply({ embeds: [embed("✅ Balance Removed",
                `Removed **$${amount.toFixed(2)}** from ${target}'s balance.\n**New Balance:** $${getBalance(target.id)}`, 0x00CC66)] });
        }

        if (commandName === "addtime") {
            const target = interaction.options.getUser("user");
            const days   = interaction.options.getInteger("days");
            const d      = data.userKeys[target.id];
            if (!d) return noKey(interaction, target);
            const result = await addTime(d.project, d.key, days);
            if (result?.success === false) return interaction.editReply({ embeds: [embed("❌ Failed", result.message, 0xFF3333)] });
            return interaction.editReply({ embeds: [embed("✅ Time Added", `Added **${days} day(s)** to ${target}'s key.`, 0x00CC66)] });
        }

        if (commandName === "removetime") {
            const target = interaction.options.getUser("user");
            const days   = interaction.options.getInteger("days");
            const d      = data.userKeys[target.id];
            if (!d) return noKey(interaction, target);
            const result = await removeTime(d.project, d.key, days);
            if (result?.success === false) return interaction.editReply({ embeds: [embed("❌ Failed", result.message, 0xFF3333)] });
            return interaction.editReply({ embeds: [embed("✅ Time Removed", `Removed **${days} day(s)** from ${target}'s key.`, 0x00CC66)] });
        }

        if (commandName === "resethwid") {
            const target = interaction.options.getUser("user");
            const d      = data.userKeys[target.id];
            if (!d) return noKey(interaction, target);
            const result = await resetHWID(d.project, d.key);
            if (result?.success === false) return interaction.editReply({ embeds: [embed("❌ Failed", result.message, 0xFF3333)] });
            data.hwidCooldown[d.key] = 0;
            saveData();
            return interaction.editReply({ embeds: [embed("✅ HWID Reset", `Reset HWID for ${target}.`, 0x00CC66)] });
        }

        if (commandName === "resetroblox") {
            const target = interaction.options.getUser("user");
            if (data.robloxNames[target.id]) data.robloxNames[target.id].ts = 0;
            saveData();
            return interaction.editReply({ embeds: [embed("✅ Roblox Cooldown Reset", `${target} can now set a new Roblox username.`, 0x00CC66)] });
        }

        if (commandName === "blacklist") {
            const target = interaction.options.getUser("user");
            const reason = interaction.options.getString("reason") || "No reason provided";
            const d      = data.userKeys[target.id];
            if (!d) return noKey(interaction, target);
            const result = await blacklistKey(d.project, d.key, reason);
            if (result?.success === false) return interaction.editReply({ embeds: [embed("❌ Failed", result.message, 0xFF3333)] });
            return interaction.editReply({ embeds: [embed("🔴 Blacklisted", `${target}'s key has been blacklisted.\n**Reason:** ${reason}`, 0xFF3333)] });
        }

        if (commandName === "unblacklist") {
            const target = interaction.options.getUser("user");
            const d      = data.userKeys[target.id];
            if (!d) return noKey(interaction, target);
            const result = await unblacklistKey(d.project, d.key);
            if (result?.success === false) return interaction.editReply({ embeds: [embed("❌ Failed", result.message, 0xFF3333)] });
            return interaction.editReply({ embeds: [embed("🟢 Unblacklisted", `${target}'s key has been unblacklisted.`, 0x00CC66)] });
        }

        if (commandName === "extend") {
            const target = interaction.options.getUser("user");
            const d      = data.userKeys[target.id];
            if (!d) return noKey(interaction, target);
            const result = await addTime(d.project, d.key, 1);
            if (result?.success === false) return interaction.editReply({ embeds: [embed("❌ Failed", result.message, 0xFF3333)] });
            return interaction.editReply({ embeds: [embed("✅ Extended", `Added **1 day** to ${target}'s key.`, 0x00CC66)] });
        }

        if (commandName === "createkey") {
            const plan       = interaction.options.getString("plan");
            const days       = interaction.options.getInteger("days");
            const identifier = interaction.options.getString("identifier") || "";
            const result     = await createKey(PROJECTS[plan].id, days, identifier);
            if (!result?.user_key) return interaction.editReply({ embeds: [embed("❌ Failed", result?.message || "Failed.", 0xFF3333)] });
            return interaction.editReply({ embeds: [embed("✅ Key Created",
                `**Plan:** ${planName(plan)}\n**Key:** \`${result.user_key}\`\n**Days:** ${days}`, 0x00CC66)] });
        }

        if (commandName === "deletekey") {
            const target = interaction.options.getUser("user");
            const d      = data.userKeys[target.id];
            if (!d) return noKey(interaction, target);
            const result = await deleteKey(d.project, d.key);
            if (result?.success === false) return interaction.editReply({ embeds: [embed("❌ Failed", result.message, 0xFF3333)] });
            delete data.userKeys[target.id];
            saveData();
            return interaction.editReply({ embeds: [embed("🗑️ Key Deleted", `${target}'s key has been deleted.`, 0xFF3333)] });
        }

        if (commandName === "givekey") {
            const target = interaction.options.getUser("user");
            const plan   = interaction.options.getString("plan");
            const days   = interaction.options.getInteger("days");
            const expireTs2 = Math.floor(Date.now() / 1000) + (days * 86400);
            const availKey2 = await getAvailableKey(PROJECTS[plan].id);
            if (!availKey2) return interaction.editReply({ embeds: [embed("❌ No Keys Available", "No available keys in pool.", 0xFF3333)] });
            const result = await assignKey(PROJECTS[plan].id, availKey2.key, target.id, expireTs2);
            if (!result?.user_key) return interaction.editReply({ embeds: [embed("❌ Failed", result?.message || "Failed.", 0xFF3333)] });
            data.userKeys[target.id] = { key: result.user_key, project: PROJECTS[plan].id, plan };
            saveData();
            try {
                await target.send({ embeds: [embed("🎉 You received a key!",
                    `You've been given a **${planName(plan)}** key!\n\n**Key:** \`${result.user_key}\`\n**Duration:** ${days} days`,
                    0x00CC66)] });
            } catch {}
            return interaction.editReply({ embeds: [embed("✅ Key Given",
                `Gave ${target} a **${planName(plan)}** key.\n**Key:** \`${result.user_key}\``, 0x00CC66)] });
        }

        if (commandName === "listkeys") {
            const plan  = interaction.options.getString("plan");
            const users = await getAllUsers(PROJECTS[plan].id);
            if (!users.length) return interaction.editReply({ embeds: [embed("📋 No Keys", `No keys found for ${planName(plan)}.`, 0x2E78F0)] });
            const lines = users.slice(0, 20).map((u, i) =>
                `**${i+1}.** \`${u.key}\` — ${u.blacklisted ? "🔴" : "🟢"} Exp: ${formatDate(u.auth_expire)}`
            ).join("\n");
            const extra = users.length > 20 ? `\n\n*...and ${users.length - 20} more*` : "";
            return interaction.editReply({ embeds: [embed(`📋 ${planName(plan)} Keys (${users.length})`, lines + extra, 0x2E78F0)] });
        }

        if (commandName === "compensate") {
            const plan = interaction.options.getString("plan");
            const days = interaction.options.getInteger("days");
            const plans = plan === "both" ? ["premium", "standard"] : [plan];
            let total = 0;
            for (const p of plans) {
                const users = await getAllUsers(PROJECTS[p].id);
                for (const u of users) {
                    if (!u.blacklisted) {
                        await addTime(PROJECTS[p].id, u.key, days);
                        total++;
                    }
                }
            }
            return interaction.editReply({ embeds: [embed("✅ Compensated",
                `Added **${days} day(s)** to **${total}** active keys.`, 0x00CC66)] });
        }

        if (commandName === "userinfo") {
            const target  = interaction.options.getUser("user");
            const d       = data.userKeys[target.id];
            if (!d) return noKey(interaction, target);
            const luaUser = await getUser(d.project, d.key);
            if (!luaUser) return interaction.editReply({ embeds: [embed("❌ Not Found", "Key not found in Luarmor.", 0xFF3333)] });
            const roblox = data.robloxNames[target.id]?.username || "Not set";
            return interaction.editReply({ embeds: [embed(`🔑 ${target.username}'s Info`,
                `**Plan:** ${planName(d.plan)}\n**Key:** \`${d.key}\`\n**Expires:** ${formatDate(luaUser.auth_expire)}\n` +
                `**HWID:** ${luaUser.hwid || "Not set"}\n**Roblox:** ${roblox}\n` +
                `**Balance:** $${getBalance(target.id)}\n**Status:** ${luaUser.blacklisted ? "🔴 Blacklisted" : "🟢 Active"}`,
                0x2E78F0)] });
        }

        if (commandName === "removekey") {
            const target = interaction.options.getUser("user");
            if (!data.userKeys[target.id]) return noKey(interaction, target);
            delete data.userKeys[target.id];
            saveData();
            return interaction.editReply({ embeds: [embed("✅ Key Unlinked", `Removed ${target}'s linked key from the bot.`, 0x00CC66)] });
        }

        if (commandName === "unfreeze") {
            if (!data.frozenKeys || !data.frozenKeys.length) {
                return interaction.editReply({ embeds: [embed("❌ Nothing to Unfreeze", "No frozen keys found.", 0xFF3333)] });
            }
            let restored = 0;
            for (const entry of data.frozenKeys) {
                const result = await createKey(PROJECTS[entry.plan].id, entry.days || 1, entry.identifier || "");
                if (result?.key) restored++;
            }
            data.frozenKeys = [];
            saveData();
            return interaction.editReply({ embeds: [embed("✅ Unfrozen", `Restored **${restored}** keys.`, 0x00CC66)] });
        }

    } catch(e) {
        console.error(e);
        try { await interaction.editReply({ embeds: [embed("❌ Error", "Something went wrong. Please try again.", 0xFF3333)] }); } catch {}
    }
});

client.login(BOT_TOKEN);
