"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.bot = exports.ExtraTelegraf = void 0;
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const telegraf_1 = require("telegraf");
const db_1 = require("./storage/db");
const telegramErrorHandler_1 = require("./Utils/telegramErrorHandler");
/* ---------------- BOT CLASS ---------------- */
// Simple mutex for race condition prevention
class Mutex {
    constructor() {
        this.locked = false;
        this.queue = [];
    }
    acquire() {
        return __awaiter(this, void 0, void 0, function* () {
            return new Promise(resolve => {
                if (!this.locked) {
                    this.locked = true;
                    resolve();
                }
                else {
                    this.queue.push(resolve);
                }
            });
        });
    }
    release() {
        if (this.queue.length > 0) {
            const next = this.queue.shift();
            if (next)
                next();
        }
        else {
            this.locked = false;
        }
    }
}
class ExtraTelegraf extends telegraf_1.Telegraf {
    constructor() {
        super(...arguments);
        this.waiting = null;
        this.waitingQueue = [];
        this.runningChats = [];
        // Message mapping for replies
        this.messageMap = new Map();
        // Message count tracking for chat statistics
        this.messageCountMap = new Map();
        // Statistics
        this.totalChats = 0;
        this.totalUsers = 0;
        // Spectator mode - admin ID -> { user1, user2 }
        this.spectatingChats = new Map();
        // Rate limiting - userId -> last command time
        this.rateLimitMap = new Map();
        // Action cooldown - userId -> { action -> last execution time }
        this.actionCooldownMap = new Map();
        // Cooldown duration in milliseconds (1 second)
        this.ACTION_COOLDOWN = 1000;
        // Mutexes for race condition prevention
        this.chatMutex = new Mutex();
        this.queueMutex = new Mutex();
        // Maximum queue size
        this.MAX_QUEUE_SIZE = 10000;
        // Rate limit window in milliseconds (1 second - faster for real-time chat)
        this.RATE_LIMIT_WINDOW = 1000;
    }
    // Check if user is in cooldown for a specific action
    isActionOnCooldown(userId, action) {
        const userCooldowns = this.actionCooldownMap.get(userId);
        if (!userCooldowns)
            return false;
        const lastActionTime = userCooldowns.get(action);
        if (!lastActionTime)
            return false;
        return (Date.now() - lastActionTime) < this.ACTION_COOLDOWN;
    }
    // Set action cooldown for user
    setActionCooldown(userId, action) {
        let userCooldowns = this.actionCooldownMap.get(userId);
        if (!userCooldowns) {
            userCooldowns = new Map();
            this.actionCooldownMap.set(userId, userCooldowns);
        }
        userCooldowns.set(action, Date.now());
        // Clean up old entries to prevent memory leaks
        if (this.actionCooldownMap.size > 1000) {
            const now = Date.now();
            for (const [uid, cooldowns] of this.actionCooldownMap) {
                let hasRecent = false;
                for (const [act, time] of cooldowns) {
                    if (now - time < 60000) { // Keep entries from last minute
                        hasRecent = true;
                    }
                    else {
                        cooldowns.delete(act);
                    }
                }
                if (!hasRecent) {
                    this.actionCooldownMap.delete(uid);
                }
            }
        }
    }
    getPartner(id) {
        const index = this.runningChats.indexOf(id);
        if (index === -1)
            return null; // User not in any chat
        // Validate that we have an even-indexed user (users should be stored in pairs)
        // Even index (0, 2, 4...) - partner is at index + 1
        if (index % 2 === 0) {
            // Check if partner exists at index + 1
            if (index + 1 < this.runningChats.length) {
                return this.runningChats[index + 1];
            }
            return null; // No partner found
        }
        // Odd index (1, 3, 5...) - partner is at index - 1
        if (index - 1 >= 0) {
            return this.runningChats[index - 1];
        }
        return null; // No partner found
    }
    incrementChatCount() {
        this.totalChats++;
        // Persist to database (fire and forget, don't await)
        (0, db_1.incrementTotalChats)().catch(err => console.error("[ERROR] - Failed to persist chat count:", err));
    }
    incrementUserCount() {
        this.totalUsers++;
    }
    // Check if a user is being spectated
    isUserInSpectatorChat(userId) {
        for (const [, chat] of this.spectatingChats) {
            if (chat.user1 === userId || chat.user2 === userId) {
                return true;
            }
        }
        return false;
    }
    // Get spectator chat for a user
    getSpectatorChatForUser(userId) {
        for (const [adminId, chat] of this.spectatingChats) {
            if (chat.user1 === userId || chat.user2 === userId) {
                return { adminId, chat };
            }
        }
        return null;
    }
    // Check if user is rate limited
    isRateLimited(userId) {
        const now = Date.now();
        const lastCommand = this.rateLimitMap.get(userId);
        if (lastCommand && (now - lastCommand) < this.RATE_LIMIT_WINDOW) {
            return true;
        }
        this.rateLimitMap.set(userId, now);
        return false;
    }
    // Check if queue is full
    isQueueFull() {
        return this.waitingQueue.length >= this.MAX_QUEUE_SIZE;
    }
}
exports.ExtraTelegraf = ExtraTelegraf;
exports.bot = new ExtraTelegraf(process.env.BOT_TOKEN);
// Global catch handler for callback query errors
exports.bot.catch((err, ctx) => {
    console.error("[Global bot error]:", err);
    // Always try to answer callback query to prevent UI freeze
    if (ctx.callbackQuery) {
        ctx.answerCbQuery().catch(() => { });
    }
});
// Add global error handling middleware for Telegraf BEFORE loading handlers
exports.bot.use((ctx, next) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        yield next();
    }
    catch (err) {
        const userId = (_a = ctx.from) === null || _a === void 0 ? void 0 : _a.id;
        console.error("[MIDDLEWARE ERROR] -", err);
        // Don't let errors propagate - log and continue
    }
}));
/* ---------------- LOADERS ---------------- */
const commandHandler_1 = require("./Utils/commandHandler");
const eventHandler_1 = require("./Utils/eventHandler");
const actionHandler_1 = require("./Utils/actionHandler");
// Initialize handlers
(0, commandHandler_1.loadCommands)();
(0, eventHandler_1.loadEvents)();
(0, actionHandler_1.loadActions)();
/* ---------------- ADMIN PANEL ---------------- */
const adminaccess_1 = require("./Commands/adminaccess");
(0, adminaccess_1.initAdminActions)(exports.bot);
/* ---------------- RE-ENGAGEMENT ---------------- */
const reengagement_1 = require("./Commands/reengagement");
(0, reengagement_1.initReengagementActions)(exports.bot);
/* ---------------- REFERRAL SYSTEM ---------------- */
const referral_1 = __importDefault(require("./Commands/referral"));
referral_1.default.initActions(exports.bot);
/* ---------------- ADMIN ---------------- */
const ADMINS = ((_a = process.env.ADMIN_IDS) === null || _a === void 0 ? void 0 : _a.split(",")) || [];
function isAdmin(id) {
    return ADMINS.includes(id.toString());
}
/* ---------------- GLOBAL BAN CHECK ---------------- */
exports.bot.use((ctx, next) => __awaiter(void 0, void 0, void 0, function* () {
    if (ctx.from && (yield (0, db_1.isBanned)(ctx.from.id))) {
        yield ctx.reply("🚫 You are banned.");
        return;
    }
    return next();
}));
/* ---------------- GENDER COMMAND ---------------- */
exports.bot.command("setgender", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const g = (_a = ctx.message.text.split(" ")[1]) === null || _a === void 0 ? void 0 : _a.toLowerCase();
    if (!g || !["male", "female"].includes(g)) {
        return ctx.reply("Use: /setgender male OR /setgender female");
    }
    yield (0, db_1.setGender)(ctx.from.id, g);
    ctx.reply(`Gender set to ${g}`);
}));
/* ---------------- ADMIN BAN ---------------- */
exports.bot.command("ban", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    if (!isAdmin(ctx.from.id))
        return;
    const id = Number(ctx.message.text.split(" ")[1]);
    if (!id)
        return ctx.reply("Usage: /ban USERID");
    yield (0, db_1.banUser)(id);
    ctx.reply(`User ${id} banned`);
}));
/* ---------------- ADMIN BROADCAST ---------------- */
exports.bot.command("broadcast", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    if (!isAdmin(ctx.from.id))
        return;
    const msg = ctx.message.text.replace("/broadcast", "").trim();
    if (!msg)
        return ctx.reply("Usage: /broadcast message");
    const users = yield (0, db_1.getAllUsers)();
    if (users.length === 0) {
        return ctx.reply("No users to broadcast to.");
    }
    // Send broadcast with rate limiting
    const userIds = users.map(id => Number(id)).filter(id => !isNaN(id));
    const { success, failed, failedUserIds } = yield (0, telegramErrorHandler_1.broadcastWithRateLimit)(exports.bot, userIds, msg);
    // Delete users who failed to receive broadcast (blocked or deactivated)
    let deletedCount = 0;
    for (const userId of failedUserIds) {
        yield (0, db_1.deleteUser)(userId, "Broadcast failed - blocked or deactivated");
        deletedCount++;
    }
    ctx.reply(`Broadcast completed!\n✅ Sent: ${success}\n❌ Failed: ${failed}\n🗑️ Deleted: ${deletedCount}`);
}));
/* ---------------- ADMIN ACTIVE CHATS ---------------- */
exports.bot.command("active", (ctx) => {
    if (!isAdmin(ctx.from.id))
        return;
    ctx.reply(`Active chats: ${exports.bot.runningChats.length / 2}`);
});
/* ---------------- ADMIN STATS ---------------- */
exports.bot.command("stats", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    if (!isAdmin(ctx.from.id))
        return;
    const allUsers = yield (0, db_1.getAllUsers)();
    const totalChats = yield (0, db_1.getTotalChats)();
    const stats = `
📊 <b>Bot Statistics</b>

👥 <b>Total Users:</b> ${allUsers.length}
💬 <b>Total Chats:</b> ${totalChats}
💭 <b>Active Chats:</b> ${exports.bot.runningChats.length / 2}
⏳ <b>Users Waiting:</b> ${exports.bot.waitingQueue.length}
`;
    ctx.reply(stats, { parse_mode: "HTML" });
}));
/* ---------------- ADMIN SET NAME ---------------- */
exports.bot.command("setname", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    if (!isAdmin(ctx.from.id))
        return;
    const args = ctx.message.text.split(" ");
    const id = Number(args[1]);
    const name = args.slice(2).join(" ").trim();
    if (!id || !name)
        return ctx.reply("Usage: /setname USERID NewName");
    yield (0, db_1.updateUser)(id, { name });
    ctx.reply(`User ${id} name updated to: ${name}`);
}));
/* ---------------- START ---------------- */
console.log("[INFO] - Bot is online");
// Load statistics from database
(0, db_1.getTotalChats)().then(chats => {
    exports.bot.totalChats = chats;
    console.log(`[INFO] - Loaded ${chats} total chats from database`);
}).catch(err => {
    console.error("[ERROR] - Failed to load statistics:", err);
});
// Get the port from environment (Render.com sets PORT)
const PORT = parseInt(process.env.PORT || "3000", 10);
const WEBHOOK_PATH = process.env.WEBHOOK_PATH || "/webhook";
// For production (Render.com), use webhooks
if (process.env.RENDER_EXTERNAL_HOSTNAME || process.env.WEBHOOK_URL) {
    const domain = process.env.WEBHOOK_URL || `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`;
    const webhookUrl = `${domain}${WEBHOOK_PATH}`;
    console.log(`[INFO] - Setting webhook to: ${webhookUrl}`);
    // Start HTTP server for webhooks
    const app = (0, express_1.default)();
    // Use Telegraf's built-in webhook callback (handles parsing correctly)
    app.use(exports.bot.webhookCallback(WEBHOOK_PATH));
    // Health check endpoint - simplified version that doesn't make API calls
    app.get("/health", (req, res) => {
        res.json({
            status: "OK",
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
        });
    });
    // Health check endpoints for Render - MUST return status 200
    app.get("/healthz", (req, res) => {
        res.status(200).send("OK");
    });
    app.get("/ready", (req, res) => {
        res.status(200).send("READY");
    });
    // ROOT endpoint - Render's health check hits this
    app.get("/", (req, res) => {
        res.status(200).send("OK");
    });
    // Start the server
    const server = app.listen(PORT, "0.0.0.0", () => __awaiter(void 0, void 0, void 0, function* () {
        console.log(`[INFO] - Server listening on port ${PORT}`);
        console.log(`[INFO] - Health check endpoints active`);
        // Set webhook AFTER server is listening
        try {
            yield exports.bot.telegram.setWebhook(webhookUrl);
            console.log("[INFO] - Webhook set successfully");
        }
        catch (err) {
            console.error("[ERROR] - Failed to set webhook:", err.message);
        }
    }));
}
else {
    // For local development, use long polling
    console.log("[INFO] - Using long polling (local development)");
    exports.bot.launch();
}
/* ---------------- GLOBAL ERROR HANDLING ---------------- */
// Use Telegraf's built-in error handling via middleware
/* ---------------- PERIODIC CLEANUP ---------------- */
// Clean up stale data from Maps to prevent memory leaks
function cleanupStaleData() {
    try {
        // Clean up rate limit map (remove entries older than 1 minute)
        const now = Date.now();
        const RATE_LIMIT_CLEANUP_THRESHOLD = 60000; // 1 minute
        for (const [userId, timestamp] of exports.bot.rateLimitMap) {
            if (now - timestamp > RATE_LIMIT_CLEANUP_THRESHOLD) {
                exports.bot.rateLimitMap.delete(userId);
            }
        }
        // Log cleanup stats
        console.log(`[CLEANUP] - Rate limit map size: ${exports.bot.rateLimitMap.size}, Running chats: ${exports.bot.runningChats.length}, Waiting queue: ${exports.bot.waitingQueue.length}`);
    }
    catch (error) {
        console.error("[CLEANUP] - Error during cleanup:", error);
    }
}
// Run cleanup every 5 minutes
setInterval(cleanupStaleData, 300000);
process.on("unhandledRejection", (reason, promise) => {
    console.error("[UNHANDLED REJECTION] -", reason);
});
process.on("uncaughtException", (error) => {
    console.error("[UNCAUGHT EXCEPTION] -", error.message);
    // Don't exit - let the process continue handling requests
});
process.once("SIGINT", () => __awaiter(void 0, void 0, void 0, function* () {
    console.log("[INFO] - Stopping bot (SIGINT)...");
    try {
        // In webhook mode, delete the webhook; in polling mode, stop the bot
        if (process.env.RENDER_EXTERNAL_HOSTNAME || process.env.WEBHOOK_URL) {
            yield exports.bot.telegram.deleteWebhook();
            console.log("[INFO] - Webhook deleted");
        }
        else if (exports.bot.botInfo) {
            yield exports.bot.stop("SIGINT");
        }
    }
    catch (error) {
        console.log("[INFO] - Bot stop skipped:", error.message);
    }
    // Close database connection
    try {
        yield (0, db_1.closeDatabase)();
    }
    catch (error) {
        // Ignore close errors
    }
    process.exit(0);
}));
process.once("SIGTERM", () => __awaiter(void 0, void 0, void 0, function* () {
    console.log("[INFO] - Stopping bot (SIGTERM)...");
    try {
        // In webhook mode, delete the webhook; in polling mode, stop the bot
        if (process.env.RENDER_EXTERNAL_HOSTNAME || process.env.WEBHOOK_URL) {
            yield exports.bot.telegram.deleteWebhook();
            console.log("[INFO] - Webhook deleted");
        }
        else if (exports.bot.botInfo) {
            yield exports.bot.stop("SIGTERM");
        }
    }
    catch (error) {
        console.log("[INFO] - Bot stop skipped:", error.message);
    }
    // Close database connection
    try {
        yield (0, db_1.closeDatabase)();
    }
    catch (error) {
        // Ignore close errors
    }
    process.exit(0);
}));
