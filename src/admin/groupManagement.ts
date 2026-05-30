import { Context, Markup } from "telegraf";
import { ChatMemberAdministrator, User as TelegramUser } from "@telegraf/types";
import { ExtraTelegraf } from "../index";
import { isAdminContext, unauthorizedResponse } from "../Utils/adminAuth";
import { getErrorMessage, safeAnswerCbQuery, safeEditMessageText } from "../Utils/telegramUi";
import {
  buildVerificationBotDisplay,
  buildVerificationBotUrl,
  getDefaultGroupVerificationMessage,
  getGroupSettings,
  GroupSettings,
  normalizeBotUsername,
  updateGroupSettings
} from "../storage/db";

type GroupInputMode = "group_id" | "verification_bot_username" | "verification_message" | "auto_kick_custom";

interface PendingGroupIdChange {
  oldGroupId: string;
  newGroupId: string;
}

const pendingInputModes = new Map<number, GroupInputMode>();
const pendingGroupIdChanges = new Map<number, PendingGroupIdChange>();
const pendingBotUsernamePreview = new Map<number, string>();

function buildBackAndHomeKeyboard(backCallback: string) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("⬅ Back", backCallback)],
    [Markup.button.callback("🏠 Admin Home", "ADMIN_BACK")]
  ]);
}

function buildGroupManagementKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🆔 Change Group ID", "ADMIN_GROUP_CHANGE_ID")],
    [Markup.button.callback("🤖 Verification Bot", "ADMIN_GROUP_VERIFICATION_BOT")],
    [Markup.button.callback("🔐 Verification Settings", "ADMIN_GROUP_VERIFICATION_SETTINGS")],
    [Markup.button.callback("👢 Auto Kick Settings", "ADMIN_GROUP_AUTOKICK_SETTINGS")],
    [Markup.button.callback("💬 Verification Message", "ADMIN_GROUP_MESSAGE_SETTINGS")],
    [Markup.button.callback("🧪 Run Diagnostics", "ADMIN_GROUP_RUN_DIAGNOSTICS")],
    [Markup.button.callback("📋 View Configuration", "ADMIN_GROUP_VIEW_CONFIGURATION")],
    [Markup.button.callback("⬅ Back", "ADMIN_BACK")],
    [Markup.button.callback("🏠 Admin Home", "ADMIN_BACK")]
  ]);
}

function buildGroupIdConfirmationKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✅ Confirm", "ADMIN_GROUP_CONFIRM_ID"), Markup.button.callback("❌ Cancel", "ADMIN_GROUP_CANCEL_ID")],
    [Markup.button.callback("⬅ Back", "ADMIN_GROUP_MANAGEMENT")],
    [Markup.button.callback("🏠 Admin Home", "ADMIN_BACK")]
  ]);
}

function buildVerificationBotKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✏ Change Username", "ADMIN_GROUP_VERIFICATION_BOT_EDIT")],
    [Markup.button.callback("👁 Preview Verification Button", "ADMIN_GROUP_VERIFICATION_BOT_PREVIEW")],
    [Markup.button.callback("⬅ Back", "ADMIN_GROUP_MANAGEMENT")],
    [Markup.button.callback("🏠 Admin Home", "ADMIN_BACK")]
  ]);
}

function buildVerificationSettingsKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✅ Enable Verification", "ADMIN_GROUP_ENABLE_VERIFICATION")],
    [Markup.button.callback("❌ Disable Verification", "ADMIN_GROUP_DISABLE_VERIFICATION")],
    [Markup.button.callback("⬅ Back", "ADMIN_GROUP_MANAGEMENT")],
    [Markup.button.callback("🏠 Admin Home", "ADMIN_BACK")]
  ]);
}

function buildAutoKickKeyboard(settings: GroupSettings) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✏ Edit Timeout", "ADMIN_GROUP_AUTOKICK_CUSTOM")],
    [Markup.button.callback(settings.autoKickEnabled ? "❌ Disable Auto Kick" : "✅ Enable Auto Kick", "ADMIN_GROUP_AUTOKICK_TOGGLE")],
    [Markup.button.callback("⬅ Back", "ADMIN_GROUP_MANAGEMENT")],
    [Markup.button.callback("🏠 Admin Home", "ADMIN_BACK")]
  ]);
}

function buildVerificationMessageKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✏ Edit Message", "ADMIN_GROUP_MESSAGE_EDIT")],
    [Markup.button.callback("🔄 Reset Default", "ADMIN_GROUP_MESSAGE_RESET")],
    [Markup.button.callback("👁 Preview", "ADMIN_GROUP_MESSAGE_PREVIEW")],
    [Markup.button.callback("⬅ Back", "ADMIN_GROUP_MANAGEMENT")],
    [Markup.button.callback("🏠 Admin Home", "ADMIN_BACK")]
  ]);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{(first_name|username|group_name|bot_username)\}/g, (_, key: string) => variables[key] ?? "");
}

async function getGroupName(bot: ExtraTelegraf, settings: GroupSettings): Promise<string> {
  if (!settings.groupId) return "this group";
  try {
    const chat = await bot.telegram.getChat(settings.groupId);
    return "title" in chat && typeof chat.title === "string" ? chat.title : "this group";
  } catch {
    return "this group";
  }
}

async function buildTemplateVariables(bot: ExtraTelegraf, settings: GroupSettings, user?: TelegramUser): Promise<Record<string, string>> {
  const groupName = await getGroupName(bot, settings);
  const botUsername = normalizeBotUsername(settings.verificationBotUsername || bot.botInfo?.username || process.env.BOT_USERNAME);
  return {
    first_name: user?.first_name ? escapeHtml(user.first_name) : "Guest",
    username: user?.username ? `@${escapeHtml(user.username)}` : "Guest",
    group_name: escapeHtml(groupName),
    bot_username: escapeHtml(botUsername)
  };
}

interface DiagnosticCheck {
  label: string;
  passed: boolean;
  detail: string;
}

async function runGroupDiagnostics(bot: ExtraTelegraf, settings: GroupSettings): Promise<DiagnosticCheck[]> {
  const checks: DiagnosticCheck[] = [];
  checks.push({ label: "Group configured", passed: Boolean(settings.groupId), detail: settings.groupId || "No group ID configured" });
  checks.push({ label: "Verification enabled", passed: settings.verificationEnabled, detail: settings.verificationEnabled ? "Enabled" : "Disabled" });
  checks.push({ label: "Verification bot username configured", passed: Boolean(settings.verificationBotUsername), detail: settings.verificationBotUsername || "No verification bot configured" });

  if (!settings.groupId) {
    checks.push({ label: "Group exists", passed: false, detail: "Missing group ID" });
    checks.push({ label: "Bot is admin", passed: false, detail: "Missing group ID" });
    checks.push({ label: "Restrict Members permission available", passed: false, detail: "Missing group ID" });
    checks.push({ label: "Ban Users permission available", passed: false, detail: "Missing group ID" });
    checks.push({ label: "Bot can send messages", passed: false, detail: "Missing group ID" });
    checks.push({ label: "Verification message configured", passed: Boolean(settings.verificationMessage), detail: settings.verificationMessage ? "Configured" : "Missing message" });
    return checks;
  }

  try {
    const chat = await bot.telegram.getChat(settings.groupId);
    checks.push({ label: "Group exists", passed: true, detail: "title" in chat && typeof chat.title === "string" ? chat.title : "Chat found" });
  } catch (error) {
    const message = getErrorMessage(error);
    checks.push({ label: "Group exists", passed: false, detail: message });
    checks.push({ label: "Bot is admin", passed: false, detail: message });
    checks.push({ label: "Restrict Members permission available", passed: false, detail: message });
    checks.push({ label: "Ban Users permission available", passed: false, detail: message });
    checks.push({ label: "Bot can send messages", passed: false, detail: message });
    checks.push({ label: "Verification message configured", passed: Boolean(settings.verificationMessage), detail: settings.verificationMessage ? "Configured" : "Missing message" });
    return checks;
  }

  const me = bot.botInfo || await bot.telegram.getMe();
  try {
    const member = await bot.telegram.getChatMember(settings.groupId, me.id);
    const isAdmin = member.status === "creator" || member.status === "administrator";
    checks.push({ label: "Bot is admin", passed: isAdmin, detail: `Current status: ${member.status}` });
    const canRestrict = member.status === "creator" || (member.status === "administrator" && Boolean((member as ChatMemberAdministrator).can_restrict_members));
    const canBan = member.status === "creator" || (member.status === "administrator" && Boolean((member as ChatMemberAdministrator).can_restrict_members));
    const canSend = isAdmin || member.status === "member" || member.status === "restricted";
    checks.push({ label: "Restrict Members permission available", passed: canRestrict, detail: canRestrict ? "Available" : "Grant Restrict Members" });
    checks.push({ label: "Ban Users permission available", passed: canBan, detail: canBan ? "Available" : "Grant Ban Users" });
    checks.push({ label: "Bot can send messages", passed: canSend, detail: canSend ? "Available" : "Grant message permission" });
  } catch (error) {
    const message = getErrorMessage(error);
    checks.push({ label: "Bot is admin", passed: false, detail: message });
    checks.push({ label: "Restrict Members permission available", passed: false, detail: message });
    checks.push({ label: "Ban Users permission available", passed: false, detail: message });
    checks.push({ label: "Bot can send messages", passed: false, detail: message });
  }

  checks.push({ label: "Verification message configured", passed: Boolean(settings.verificationMessage), detail: settings.verificationMessage ? "Configured" : "Missing message" });
  return checks;
}

function formatDiagnosticsText(checks: DiagnosticCheck[]): string {
  const lines = checks.map((check) => `${check.passed ? "✅ PASS" : "❌ FAIL"} ${check.label}\n${check.detail}`);
  const allPass = checks.every((check) => check.passed);
  return `${allPass ? "✅ PASS" : "❌ FAIL"}\n\n${lines.join("\n\n")}`;
}

async function formatGroupManagementStatus(bot: ExtraTelegraf, settings: GroupSettings): Promise<string> {
  const diagnostics = await runGroupDiagnostics(bot, settings);
  const permissionHealth = diagnostics.filter((check) => ["Group exists", "Bot is admin", "Restrict Members permission available", "Ban Users permission available", "Bot can send messages"].includes(check.label)).every((check) => check.passed);
  return [
    "🛡 <b>Group Management</b>",
    "",
    `Group ID: <code>${escapeHtml(settings.groupId || "Not configured")}</code>`,
    `Verification: ${settings.verificationEnabled ? "✅ Enabled" : "❌ Disabled"}`,
    `Verification Bot: ${escapeHtml(buildVerificationBotDisplay(settings.verificationBotUsername))}`,
    `Auto Kick: ${settings.autoKickEnabled ? "✅ Enabled" : "❌ Disabled"}`,
    `Auto Kick Timeout: ${settings.autoKickMinutes} minute${settings.autoKickMinutes === 1 ? "" : "s"}`,
    `Verification Message: ${settings.verificationMessage ? "Configured" : "Not configured"}`,
    `Bot Permissions: ${permissionHealth ? "✅ Healthy" : "❌ Issues Found"}`
  ].join("\n");
}

async function assertAuthenticatedAdmin(ctx: Context): Promise<boolean> {
  if (!isAdminContext(ctx) || !ctx.from?.id) {
    await unauthorizedResponse(ctx, "Unauthorized");
    return false;
  }
  const adminUser = await getGroupSettings();
  void adminUser;
  return true;
}

function clearPending(adminId: number): void {
  pendingInputModes.delete(adminId);
  pendingGroupIdChanges.delete(adminId);
  pendingBotUsernamePreview.delete(adminId);
}

async function promptForInput(ctx: Context, adminId: number, mode: GroupInputMode, message: string): Promise<void> {
  pendingInputModes.set(adminId, mode);
  await safeEditMessageText(ctx, message, { parse_mode: "HTML", ...buildBackAndHomeKeyboard("ADMIN_GROUP_MANAGEMENT") });
}

export async function processGroupManagementInput(ctx: Context, bot: ExtraTelegraf): Promise<boolean> {
  const adminId = ctx.from?.id;
  if (!adminId) return false;
  const mode = pendingInputModes.get(adminId);
  if (!mode) return false;

  if (!(await assertAuthenticatedAdmin(ctx))) {
    clearPending(adminId);
    return true;
  }

  const messageText = "message" in ctx.update && ctx.update.message && "text" in ctx.update.message ? ctx.update.message.text : "";
  const text = messageText.trim();
  if (!text) {
    await ctx.reply("❌ Please send a valid value.");
    return true;
  }

  if (mode === "group_id") {
    if (!/^-100\d{5,}$/.test(text)) {
      await ctx.reply("❌ Invalid Telegram Group ID. Example: -1001234567890");
      return true;
    }
    const settings = await getGroupSettings();
    pendingInputModes.delete(adminId);
    pendingGroupIdChanges.set(adminId, { oldGroupId: settings.groupId, newGroupId: text });
    await ctx.reply(
      `🆔 <b>Confirm Group ID Change</b>\n\nOld Group ID: <code>${escapeHtml(settings.groupId || "Not configured")}</code>\nNew Group ID: <code>${escapeHtml(text)}</code>`,
      { parse_mode: "HTML", ...buildGroupIdConfirmationKeyboard() }
    );
    return true;
  }

  if (mode === "verification_bot_username") {
    const normalized = normalizeBotUsername(text);
    pendingInputModes.delete(adminId);
    pendingBotUsernamePreview.set(adminId, normalized);
    await updateGroupSettings({ verificationBotUsername: normalized }, adminId);
    await ctx.reply(`✅ Verification bot username updated to ${buildVerificationBotDisplay(normalized)}.`);
    return true;
  }

  if (mode === "verification_message") {
    if (text.length < 5) {
      await ctx.reply("❌ Verification message is too short.");
      return true;
    }
    pendingInputModes.delete(adminId);
    await updateGroupSettings({ verificationMessage: text }, adminId);
    const settings = await getGroupSettings();
    const preview = formatTemplate(text, await buildTemplateVariables(bot, settings));
    await ctx.reply(`✅ Verification message updated.\n\n<b>Preview</b>\n${preview}`, { parse_mode: "HTML" });
    return true;
  }

  if (mode === "auto_kick_custom") {
    const minutes = Number.parseInt(text, 10);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      await ctx.reply("❌ Auto kick timeout must be a positive number.");
      return true;
    }
    pendingInputModes.delete(adminId);
    await updateGroupSettings({ autoKickEnabled: true, autoKickMinutes: minutes }, adminId);
    await ctx.reply(`✅ Auto kick timeout updated to ${minutes} minute${minutes === 1 ? "" : "s"}.`);
    return true;
  }

  return false;
}

export function registerGroupManagementCallbacks(bot: ExtraTelegraf): void {
  bot.action("ADMIN_GROUP_MANAGEMENT", async (ctx: Context) => {
    if (!(await assertAuthenticatedAdmin(ctx))) return;
    await safeAnswerCbQuery(ctx);
    const settings = await getGroupSettings();
    await safeEditMessageText(ctx, await formatGroupManagementStatus(bot, settings), { parse_mode: "HTML", ...buildGroupManagementKeyboard() });
  });

  bot.action("ADMIN_GROUP_CHANGE_ID", async (ctx: Context) => {
    if (!(await assertAuthenticatedAdmin(ctx))) return;
    await safeAnswerCbQuery(ctx);
    await promptForInput(ctx, ctx.from!.id, "group_id", "Send the new Telegram Group ID\n\nExample:\n<code>-1001234567890</code>");
  });

  bot.action("ADMIN_GROUP_CONFIRM_ID", async (ctx: Context) => {
    if (!(await assertAuthenticatedAdmin(ctx))) return;
    const pending = pendingGroupIdChanges.get(ctx.from!.id);
    if (!pending) {
      await safeAnswerCbQuery(ctx, "No pending change");
      return;
    }
    await updateGroupSettings({ groupId: pending.newGroupId }, ctx.from!.id);
    pendingGroupIdChanges.delete(ctx.from!.id);
    await safeAnswerCbQuery(ctx, "Group ID updated");
    await safeEditMessageText(ctx, "✅ Group ID updated.", { parse_mode: "HTML", ...buildBackAndHomeKeyboard("ADMIN_GROUP_MANAGEMENT") });
  });

  bot.action("ADMIN_GROUP_CANCEL_ID", async (ctx: Context) => {
    if (!(await assertAuthenticatedAdmin(ctx))) return;
    pendingGroupIdChanges.delete(ctx.from!.id);
    await safeAnswerCbQuery(ctx, "Cancelled");
    await safeEditMessageText(ctx, "Cancelled.", { parse_mode: "HTML", ...buildBackAndHomeKeyboard("ADMIN_GROUP_MANAGEMENT") });
  });

  bot.action("ADMIN_GROUP_VERIFICATION_BOT", async (ctx: Context) => {
    if (!(await assertAuthenticatedAdmin(ctx))) return;
    await safeAnswerCbQuery(ctx);
    const settings = await getGroupSettings();
    await safeEditMessageText(
      ctx,
      `🤖 <b>Verification Bot</b>\n\nCurrent Bot: ${escapeHtml(buildVerificationBotDisplay(settings.verificationBotUsername))}`,
      { parse_mode: "HTML", ...buildVerificationBotKeyboard() }
    );
  });

  bot.action("ADMIN_GROUP_VERIFICATION_BOT_EDIT", async (ctx: Context) => {
    if (!(await assertAuthenticatedAdmin(ctx))) return;
    await safeAnswerCbQuery(ctx);
    await promptForInput(ctx, ctx.from!.id, "verification_bot_username", "Send the new verification bot username.\n\nExample:\n<code>newbot</code>\nor\n<code>@NewBot</code>");
  });

  bot.action("ADMIN_GROUP_VERIFICATION_BOT_PREVIEW", async (ctx: Context) => {
    if (!(await assertAuthenticatedAdmin(ctx))) return;
    const settings = await getGroupSettings();
    const buttonText = "🚀 Start";
    const buttonUrl = buildVerificationBotUrl(settings.verificationBotUsername);
    await safeAnswerCbQuery(ctx);
    await safeEditMessageText(
      ctx,
      `👁 <b>Verification Button Preview</b>\n\nText: ${escapeHtml(buttonText)}\nURL: <code>${escapeHtml(buttonUrl)}</code>`,
      { parse_mode: "HTML", ...buildBackAndHomeKeyboard("ADMIN_GROUP_VERIFICATION_BOT") }
    );
  });

  bot.action("ADMIN_GROUP_VERIFICATION_SETTINGS", async (ctx: Context) => {
    if (!(await assertAuthenticatedAdmin(ctx))) return;
    await safeAnswerCbQuery(ctx);
    const settings = await getGroupSettings();
    await safeEditMessageText(ctx, `🔐 <b>Verification Settings</b>\n\nVerification Enabled: ${settings.verificationEnabled ? "ON" : "OFF"}`, { parse_mode: "HTML", ...buildVerificationSettingsKeyboard() });
  });

  bot.action("ADMIN_GROUP_ENABLE_VERIFICATION", async (ctx: Context) => {
    if (!(await assertAuthenticatedAdmin(ctx))) return;
    await updateGroupSettings({ verificationEnabled: true }, ctx.from!.id);
    await safeAnswerCbQuery(ctx, "Verification enabled");
    await safeEditMessageText(ctx, "✅ Verification enabled.", { parse_mode: "HTML", ...buildBackAndHomeKeyboard("ADMIN_GROUP_VERIFICATION_SETTINGS") });
  });

  bot.action("ADMIN_GROUP_DISABLE_VERIFICATION", async (ctx: Context) => {
    if (!(await assertAuthenticatedAdmin(ctx))) return;
    await updateGroupSettings({ verificationEnabled: false }, ctx.from!.id);
    await safeAnswerCbQuery(ctx, "Verification disabled");
    await safeEditMessageText(ctx, "❌ Verification disabled.", { parse_mode: "HTML", ...buildBackAndHomeKeyboard("ADMIN_GROUP_VERIFICATION_SETTINGS") });
  });

  bot.action("ADMIN_GROUP_AUTOKICK_SETTINGS", async (ctx: Context) => {
    if (!(await assertAuthenticatedAdmin(ctx))) return;
    await safeAnswerCbQuery(ctx);
    const settings = await getGroupSettings();
    await safeEditMessageText(ctx, `👢 <b>Auto Kick Settings</b>\n\nCurrent timeout: ${settings.autoKickMinutes} minute${settings.autoKickMinutes === 1 ? "" : "s"}\nAuto Kick: ${settings.autoKickEnabled ? "Enabled" : "Disabled"}`, { parse_mode: "HTML", ...buildAutoKickKeyboard(settings) });
  });

  bot.action("ADMIN_GROUP_AUTOKICK_CUSTOM", async (ctx: Context) => {
    if (!(await assertAuthenticatedAdmin(ctx))) return;
    await safeAnswerCbQuery(ctx);
    await promptForInput(ctx, ctx.from!.id, "auto_kick_custom", "Send the new auto kick timeout in minutes.");
  });

  bot.action("ADMIN_GROUP_AUTOKICK_TOGGLE", async (ctx: Context) => {
    if (!(await assertAuthenticatedAdmin(ctx))) return;
    const settings = await getGroupSettings();
    await updateGroupSettings({ autoKickEnabled: !settings.autoKickEnabled }, ctx.from!.id);
    await safeAnswerCbQuery(ctx, "Auto kick updated");
    await safeEditMessageText(ctx, "✅ Auto kick updated.", { parse_mode: "HTML", ...buildBackAndHomeKeyboard("ADMIN_GROUP_AUTOKICK_SETTINGS") });
  });

  bot.action("ADMIN_GROUP_MESSAGE_SETTINGS", async (ctx: Context) => {
    if (!(await assertAuthenticatedAdmin(ctx))) return;
    await safeAnswerCbQuery(ctx);
    const settings = await getGroupSettings();
    await safeEditMessageText(
      ctx,
      `💬 <b>Verification Message</b>\n\n<pre>${escapeHtml(settings.verificationMessage)}</pre>\n\nSupported variables:\n{first_name}\n{username}\n{group_name}\n{bot_username}`,
      { parse_mode: "HTML", ...buildVerificationMessageKeyboard() }
    );
  });

  bot.action("ADMIN_GROUP_MESSAGE_EDIT", async (ctx: Context) => {
    if (!(await assertAuthenticatedAdmin(ctx))) return;
    await safeAnswerCbQuery(ctx);
    await promptForInput(ctx, ctx.from!.id, "verification_message", "Send the new verification message.");
  });

  bot.action("ADMIN_GROUP_MESSAGE_RESET", async (ctx: Context) => {
    if (!(await assertAuthenticatedAdmin(ctx))) return;
    await updateGroupSettings({ verificationMessage: getDefaultGroupVerificationMessage() }, ctx.from!.id);
    await safeAnswerCbQuery(ctx, "Message reset");
    await safeEditMessageText(ctx, "✅ Verification message reset.", { parse_mode: "HTML", ...buildBackAndHomeKeyboard("ADMIN_GROUP_MESSAGE_SETTINGS") });
  });

  bot.action("ADMIN_GROUP_MESSAGE_PREVIEW", async (ctx: Context) => {
    if (!(await assertAuthenticatedAdmin(ctx))) return;
    const settings = await getGroupSettings();
    const preview = formatTemplate(settings.verificationMessage, await buildTemplateVariables(bot, settings, ctx.from as TelegramUser));
    await safeAnswerCbQuery(ctx);
    await safeEditMessageText(ctx, `👁 <b>Verification Message Preview</b>\n\n${preview}`, { parse_mode: "HTML", ...buildBackAndHomeKeyboard("ADMIN_GROUP_MESSAGE_SETTINGS") });
  });

  bot.action("ADMIN_GROUP_RUN_DIAGNOSTICS", async (ctx: Context) => {
    if (!(await assertAuthenticatedAdmin(ctx))) return;
    const settings = await getGroupSettings();
    const diagnostics = await runGroupDiagnostics(bot, settings);
    await safeAnswerCbQuery(ctx);
    await safeEditMessageText(ctx, formatDiagnosticsText(diagnostics), { parse_mode: "HTML", ...buildBackAndHomeKeyboard("ADMIN_GROUP_MANAGEMENT") });
  });

  bot.action("ADMIN_GROUP_VIEW_CONFIGURATION", async (ctx: Context) => {
    if (!(await assertAuthenticatedAdmin(ctx))) return;
    await safeAnswerCbQuery(ctx);
    const settings = await getGroupSettings();
    await safeEditMessageText(
      ctx,
      `📋 <b>Group Configuration</b>\n\nGroup ID: <code>${escapeHtml(settings.groupId || "Not configured")}</code>\nVerification Bot: ${escapeHtml(buildVerificationBotDisplay(settings.verificationBotUsername))}\nVerification Enabled: ${settings.verificationEnabled ? "Yes" : "No"}\nAuto Kick Enabled: ${settings.autoKickEnabled ? "Yes" : "No"}\nAuto Kick Timeout: ${settings.autoKickMinutes} minute${settings.autoKickMinutes === 1 ? "" : "s"}\n\n<b>Verification Message:</b>\n<pre>${escapeHtml(settings.verificationMessage)}</pre>`,
      { parse_mode: "HTML", ...buildBackAndHomeKeyboard("ADMIN_GROUP_MANAGEMENT") }
    );
  });
}
