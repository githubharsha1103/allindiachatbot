import { Context, Markup } from "telegraf";
import { ChatMemberAdministrator, User as TelegramUser } from "@telegraf/types";
import { ExtraTelegraf } from "../index";
import { isAdminContext, unauthorizedResponse } from "../Utils/adminAuth";
import { getErrorMessage, safeAnswerCbQuery, safeEditMessageText } from "../Utils/telegramUi";
import {
  getDefaultGroupVerificationMessage,
  getGroupSettings,
  GroupSettings,
  updateGroupSettings,
  getUser
} from "../storage/db";

type GroupInputMode = "group_id" | "auto_kick_custom" | "invite_link" | "verification_message";

interface PendingGroupIdChange {
  oldGroupId: string;
  newGroupId: string;
}

const pendingInputModes = new Map<number, GroupInputMode>();
const pendingGroupIdChanges = new Map<number, PendingGroupIdChange>();

function buildBackAndHomeKeyboard(backCallback: string) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("⬅ Back", backCallback)],
    [Markup.button.callback("🏠 Admin Home", "ADMIN_BACK")]
  ]);
}

function buildGroupManagementKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🆔 Change Group ID", "ADMIN_GROUP_CHANGE_ID")],
    [Markup.button.callback("🔐 Verification Settings", "ADMIN_GROUP_VERIFICATION_SETTINGS")],
    [Markup.button.callback("👢 Auto Kick Settings", "ADMIN_GROUP_AUTOKICK_SETTINGS")],
    [Markup.button.callback("💬 Verification Message", "ADMIN_GROUP_MESSAGE_SETTINGS")],
    [Markup.button.callback("🔗 Group Invite Link", "ADMIN_GROUP_INVITE_SETTINGS")],
    [Markup.button.callback("🧪 Run Diagnostics", "ADMIN_GROUP_RUN_DIAGNOSTICS")],
    [Markup.button.callback("📋 View Configuration", "ADMIN_GROUP_VIEW_CONFIGURATION")],
    [Markup.button.callback("⬅ Back", "ADMIN_BACK")],
    [Markup.button.callback("🏠 Admin Home", "ADMIN_BACK")]
  ]);
}

function buildVerificationSettingsKeyboard(settings: GroupSettings) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✅ Enable Verification", "ADMIN_GROUP_ENABLE_VERIFICATION")],
    [Markup.button.callback("❌ Disable Verification", "ADMIN_GROUP_DISABLE_VERIFICATION")],
    [Markup.button.callback("⬅ Back", "ADMIN_GROUP_MANAGEMENT")],
    [Markup.button.callback("🏠 Admin Home", "ADMIN_BACK")]
  ]);
}

function buildAutoKickKeyboard(settings: GroupSettings) {
  const toggleLabel = settings.autoKickEnabled ? "❌ Auto Kick Disabled" : "✅ Auto Kick Enabled";

  return Markup.inlineKeyboard([
    [
      Markup.button.callback("➕ Increase", "ADMIN_GROUP_AUTOKICK_INCREASE"),
      Markup.button.callback("➖ Decrease", "ADMIN_GROUP_AUTOKICK_DECREASE")
    ],
    [Markup.button.callback("✏ Set Custom Value", "ADMIN_GROUP_AUTOKICK_CUSTOM")],
    [Markup.button.callback(toggleLabel, "ADMIN_GROUP_AUTOKICK_TOGGLE")],
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

function buildInviteLinkKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✏ Change Link", "ADMIN_GROUP_INVITE_EDIT")],
    [Markup.button.callback("👁 Preview", "ADMIN_GROUP_INVITE_PREVIEW")],
    [Markup.button.callback("⬅ Back", "ADMIN_GROUP_MANAGEMENT")],
    [Markup.button.callback("🏠 Admin Home", "ADMIN_BACK")]
  ]);
}

function buildGroupIdConfirmationKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("✅ Confirm", "ADMIN_GROUP_CONFIRM_ID"),
      Markup.button.callback("❌ Cancel", "ADMIN_GROUP_CANCEL_ID")
    ],
    [Markup.button.callback("⬅ Back", "ADMIN_GROUP_MANAGEMENT")],
    [Markup.button.callback("🏠 Admin Home", "ADMIN_BACK")]
  ]);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getUserMention(user: TelegramUser): string {
  const label = user.first_name || user.username || "there";
  return `<a href="tg://user?id=${user.id}">${escapeHtml(label)}</a>`;
}

function applyTemplateVariables(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(/\{(first_name|username|group_name|bot_name)\}/g, (_, key: string) => {
    return variables[key] ?? "";
  });
}

function formatVerificationTemplatePreview(
  template: string,
  variables: Record<string, string>
): string {
  return applyTemplateVariables(template, variables);
}

async function getGroupName(bot: ExtraTelegraf, settings: GroupSettings): Promise<string> {
  if (!settings.groupId) {
    return "this group";
  }

  try {
    const chat = await bot.telegram.getChat(settings.groupId);
    return "title" in chat && typeof chat.title === "string" ? chat.title : "this group";
  } catch {
    return "this group";
  }
}

async function buildTemplateVariables(bot: ExtraTelegraf, settings: GroupSettings, user?: TelegramUser): Promise<Record<string, string>> {
  const groupName = await getGroupName(bot, settings);
  const botName = bot.botInfo?.username || process.env.BOT_USERNAME || "allindiachatbot";

  return {
    first_name: user ? getUserMention(user) : "Guest",
    username: user?.username ? `@${escapeHtml(user.username)}` : "Guest",
    group_name: escapeHtml(groupName),
    bot_name: escapeHtml(botName)
  };
}

interface DiagnosticCheck {
  label: string;
  passed: boolean;
  detail: string;
}

async function runGroupDiagnostics(bot: ExtraTelegraf, settings?: GroupSettings): Promise<DiagnosticCheck[]> {
  const resolvedSettings = settings || await getGroupSettings();
  const checks: DiagnosticCheck[] = [];

  checks.push({
    label: "Group ID configured",
    passed: Boolean(resolvedSettings.groupId),
    detail: resolvedSettings.groupId || "No group ID configured"
  });

  checks.push({
    label: "Verification enabled",
    passed: resolvedSettings.verificationEnabled,
    detail: resolvedSettings.verificationEnabled ? "Verification workflow is active" : "Verification workflow is disabled"
  });

  checks.push({
    label: "Invite link configured",
    passed: Boolean(resolvedSettings.inviteLink),
    detail: resolvedSettings.inviteLink || "No invite link configured"
  });

  if (!resolvedSettings.groupId) {
    checks.push({
      label: "Group exists",
      passed: false,
      detail: "Cannot verify without a group ID"
    });
    checks.push({
      label: "Bot is admin",
      passed: false,
      detail: "Cannot verify without a group ID"
    });
    checks.push({
      label: "Restrict Members permission",
      passed: false,
      detail: "Cannot verify without a group ID"
    });
    checks.push({
      label: "Ban Users permission",
      passed: !resolvedSettings.autoKickEnabled,
      detail: resolvedSettings.autoKickEnabled ? "Cannot verify without a group ID" : "Auto kick disabled"
    });
    checks.push({
      label: "Bot can send messages",
      passed: false,
      detail: "Cannot verify without a group ID"
    });
    return checks;
  }

  try {
    const chat = await bot.telegram.getChat(resolvedSettings.groupId);
    checks.push({
      label: "Group exists",
      passed: true,
      detail: "title" in chat && typeof chat.title === "string" ? chat.title : "Chat found"
    });
  } catch (error) {
    const message = getErrorMessage(error);
    checks.push({
      label: "Group exists",
      passed: false,
      detail: message
    });
    checks.push({
      label: "Bot is admin",
      passed: false,
      detail: "Skipped because the bot could not load the group"
    });
    checks.push({
      label: "Restrict Members permission",
      passed: false,
      detail: "Skipped because the bot could not load the group"
    });
    checks.push({
      label: "Ban Users permission",
      passed: !resolvedSettings.autoKickEnabled,
      detail: resolvedSettings.autoKickEnabled ? "Skipped because the bot could not load the group" : "Auto kick disabled"
    });
    checks.push({
      label: "Bot can send messages",
      passed: false,
      detail: "Skipped because the bot could not load the group"
    });
    return checks;
  }

  const me = bot.botInfo || await bot.telegram.getMe();

  try {
    const member = await bot.telegram.getChatMember(resolvedSettings.groupId, me.id);
    const isAdmin = member.status === "administrator" || member.status === "creator";
    checks.push({
      label: "Bot is admin",
      passed: isAdmin,
      detail: `Current status: ${member.status}`
    });

    let canRestrictMembers = false;
    let canSendMessages = false;
    let canBanUsers = !resolvedSettings.autoKickEnabled;

    if (member.status === "creator") {
      canRestrictMembers = true;
      canSendMessages = true;
      canBanUsers = true;
    } else if (member.status === "administrator") {
      const adminMember = member as ChatMemberAdministrator;
      canRestrictMembers = Boolean(adminMember.can_restrict_members);
      canSendMessages = true;
      canBanUsers = resolvedSettings.autoKickEnabled ? Boolean(adminMember.can_restrict_members) : true;
    } else if (member.status === "member") {
      canSendMessages = true;
    } else if (member.status === "restricted") {
      canSendMessages = Boolean(member.can_send_messages);
    }

    checks.push({
      label: "Restrict Members permission",
      passed: canRestrictMembers,
      detail: canRestrictMembers ? "Bot can restrict members" : "Grant Restrict Members to the bot"
    });
    checks.push({
      label: "Ban Users permission",
      passed: canBanUsers,
      detail: resolvedSettings.autoKickEnabled
        ? (canBanUsers ? "Bot can ban users for auto kick" : "Auto kick needs ban/restrict capability")
        : "Auto kick disabled"
    });
    checks.push({
      label: "Bot can send messages",
      passed: canSendMessages,
      detail: canSendMessages ? "Bot can send group messages" : "Bot cannot send messages in this group"
    });
  } catch (error) {
    const message = getErrorMessage(error);
    checks.push({
      label: "Bot is admin",
      passed: false,
      detail: message
    });
    checks.push({
      label: "Restrict Members permission",
      passed: false,
      detail: message
    });
    checks.push({
      label: "Ban Users permission",
      passed: !resolvedSettings.autoKickEnabled,
      detail: resolvedSettings.autoKickEnabled ? message : "Auto kick disabled"
    });
    checks.push({
      label: "Bot can send messages",
      passed: false,
      detail: message
    });
  }

  return checks;
}

function formatDiagnosticsText(checks: DiagnosticCheck[]): string {
  const lines = checks.map((check) => `${check.passed ? "✅ PASS" : "❌ FAIL"} ${check.label}\n${check.detail}`);
  return `🧪 <b>Group Diagnostics</b>\n\n${lines.join("\n\n")}`;
}

async function formatGroupManagementStatus(bot: ExtraTelegraf, settings: GroupSettings): Promise<string> {
  const diagnostics = await runGroupDiagnostics(bot, settings);
  const permissionHealth = diagnostics
    .filter((check) => ["Bot is admin", "Restrict Members permission", "Ban Users permission", "Bot can send messages"].includes(check.label))
    .every((check) => check.passed);

  return [
    "🛡 <b>Group Management</b>",
    "",
    "📊 <b>Current Status</b>",
    "",
    `Group ID: <code>${escapeHtml(settings.groupId || "Not configured")}</code>`,
    `Verification:\n${settings.verificationEnabled ? "✅ Enabled" : "❌ Disabled"}`,
    `Auto Kick:\n${settings.autoKickEnabled ? "✅ Enabled" : "❌ Disabled"}`,
    `Auto Kick Timeout: ${settings.autoKickMinutes} minute${settings.autoKickMinutes === 1 ? "" : "s"}`,
    "Verification Message:\nConfigured",
    `Bot Permissions Check:\n${permissionHealth ? "✅ Healthy" : "❌ Issues Found"}`
  ].join("\n");
}

async function assertAuthenticatedAdmin(ctx: Context): Promise<boolean> {
  if (!isAdminContext(ctx) || !ctx.from?.id) {
    await unauthorizedResponse(ctx, "Unauthorized");
    return false;
  }

  const adminUser = await getUser(ctx.from.id);
  const sessionExpiry = adminUser.adminSessionExpiresAt || 0;
  if (!adminUser.isAdminAuthenticated || sessionExpiry < Date.now()) {
    await unauthorizedResponse(ctx, "Run /adminaccess again");
    if ("reply" in ctx) {
      await ctx.reply("🔐 Your admin session expired. Run /adminaccess again.");
    }
    return false;
  }

  return true;
}

async function showGroupManagementHome(ctx: Context, bot: ExtraTelegraf): Promise<void> {
  const settings = await getGroupSettings();
  const text = await formatGroupManagementStatus(bot, settings);
  await safeEditMessageText(ctx, text, { parse_mode: "HTML", ...buildGroupManagementKeyboard() });
}

async function showVerificationSettings(ctx: Context): Promise<void> {
  const settings = await getGroupSettings();
  const text = [
    "🔐 <b>Verification Settings</b>",
    "",
    `Verification Enabled: ${settings.verificationEnabled ? "ON" : "OFF"}`,
    "",
    settings.verificationEnabled
      ? "New members are restricted and must verify before chatting."
      : "No restriction or verification workflow will be applied."
  ].join("\n");

  await safeEditMessageText(ctx, text, {
    parse_mode: "HTML",
    ...buildVerificationSettingsKeyboard(settings)
  });
}

async function showAutoKickSettings(ctx: Context): Promise<void> {
  const settings = await getGroupSettings();
  const text = [
    "👢 <b>Auto Kick Settings</b>",
    "",
    `Current timeout: ${settings.autoKickMinutes} minute${settings.autoKickMinutes === 1 ? "" : "s"}`,
    `Auto Kick: ${settings.autoKickEnabled ? "Enabled" : "Disabled"}`
  ].join("\n");

  await safeEditMessageText(ctx, text, {
    parse_mode: "HTML",
    ...buildAutoKickKeyboard(settings)
  });
}

async function showVerificationMessageSettings(ctx: Context): Promise<void> {
  const settings = await getGroupSettings();
  const text = [
    "💬 <b>Verification Message</b>",
    "",
    "<b>Current message:</b>",
    `<pre>${escapeHtml(settings.verificationMessage)}</pre>`,
    "",
    "Supported variables:",
    "{first_name}",
    "{username}",
    "{group_name}",
    "{bot_name}"
  ].join("\n");

  await safeEditMessageText(ctx, text, {
    parse_mode: "HTML",
    ...buildVerificationMessageKeyboard()
  });
}

async function showInviteLinkSettings(ctx: Context): Promise<void> {
  const settings = await getGroupSettings();
  const text = [
    "🔗 <b>Group Invite Link</b>",
    "",
    `Current invite link:\n<code>${escapeHtml(settings.inviteLink || "Not configured")}</code>`
  ].join("\n");

  await safeEditMessageText(ctx, text, {
    parse_mode: "HTML",
    ...buildInviteLinkKeyboard()
  });
}

async function showConfiguration(ctx: Context): Promise<void> {
  const settings = await getGroupSettings();
  const text = [
    "📋 <b>Group Configuration</b>",
    "",
    `Group ID: <code>${escapeHtml(settings.groupId || "Not configured")}</code>`,
    `Invite Link: <code>${escapeHtml(settings.inviteLink || "Not configured")}</code>`,
    `Verification Enabled: ${settings.verificationEnabled ? "Yes" : "No"}`,
    `Auto Kick Enabled: ${settings.autoKickEnabled ? "Yes" : "No"}`,
    `Auto Kick Timeout: ${settings.autoKickMinutes} minute${settings.autoKickMinutes === 1 ? "" : "s"}`,
    "<b>Verification Message:</b>",
    `<pre>${escapeHtml(settings.verificationMessage)}</pre>`
  ].join("\n");

  await safeEditMessageText(ctx, text, {
    parse_mode: "HTML",
    ...buildBackAndHomeKeyboard("ADMIN_GROUP_MANAGEMENT")
  });
}

function clearPendingGroupManagementState(adminId: number): void {
  pendingInputModes.delete(adminId);
  pendingGroupIdChanges.delete(adminId);
}

async function promptForInput(ctx: Context, adminId: number, mode: GroupInputMode, message: string): Promise<void> {
  pendingInputModes.set(adminId, mode);
  if (mode !== "group_id") {
    pendingGroupIdChanges.delete(adminId);
  }
  await safeEditMessageText(ctx, message, {
    parse_mode: "HTML",
    ...buildBackAndHomeKeyboard("ADMIN_GROUP_MANAGEMENT")
  });
}

export async function processGroupManagementInput(ctx: Context, bot: ExtraTelegraf): Promise<boolean> {
  const adminId = ctx.from?.id;
  if (!adminId) {
    return false;
  }

  const mode = pendingInputModes.get(adminId);
  if (!mode) {
    return false;
  }

  if (!(await assertAuthenticatedAdmin(ctx))) {
    clearPendingGroupManagementState(adminId);
    return true;
  }

  const messageText =
    "message" in ctx.update &&
    ctx.update.message &&
    "text" in ctx.update.message
      ? ctx.update.message.text
      : "";
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
    pendingGroupIdChanges.set(adminId, {
      oldGroupId: settings.groupId,
      newGroupId: text
    });

    await ctx.reply(
      [
        "🆔 <b>Confirm Group ID Change</b>",
        "",
        `Old Group ID: <code>${escapeHtml(settings.groupId || "Not configured")}</code>`,
        `New Group ID: <code>${escapeHtml(text)}</code>`
      ].join("\n"),
      { parse_mode: "HTML", ...buildGroupIdConfirmationKeyboard() }
    );
    return true;
  }

  if (mode === "auto_kick_custom") {
    const minutes = Number.parseInt(text, 10);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      await ctx.reply("❌ Auto kick timeout must be a positive number of minutes.");
      return true;
    }

    pendingInputModes.delete(adminId);
    await updateGroupSettings({
      autoKickEnabled: true,
      autoKickMinutes: minutes
    }, adminId);
    await ctx.reply(`✅ Auto kick timeout updated to ${minutes} minute${minutes === 1 ? "" : "s"}.`);
    return true;
  }

  if (mode === "invite_link") {
    if (!/^https:\/\/t\.me\/.+/i.test(text)) {
      await ctx.reply("❌ Invite link must start with https://t.me/");
      return true;
    }

    pendingInputModes.delete(adminId);
    await updateGroupSettings({ inviteLink: text }, adminId);
    await ctx.reply("✅ Group invite link updated successfully.");
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
    const variables = await buildTemplateVariables(bot, settings);
    const preview = formatVerificationTemplatePreview(text, variables);
    await ctx.reply(
      `✅ Verification message updated.\n\n<b>Preview</b>\n${preview}`,
      { parse_mode: "HTML" }
    );
    return true;
  }

  return false;
}

export function registerGroupManagementCallbacks(bot: ExtraTelegraf): void {
  bot.action("ADMIN_GROUP_MANAGEMENT", async (ctx: Context) => {
    try {
      if (!(await assertAuthenticatedAdmin(ctx))) {
        return;
      }
      clearPendingGroupManagementState(ctx.from!.id);
      await safeAnswerCbQuery(ctx);
      await showGroupManagementHome(ctx, bot);
    } catch (error) {
      console.error("[groupManagement] ADMIN_GROUP_MANAGEMENT error:", getErrorMessage(error));
      await safeAnswerCbQuery(ctx, "Error loading group management");
    }
  });

  bot.action("ADMIN_GROUP_CHANGE_ID", async (ctx: Context) => {
    try {
      if (!(await assertAuthenticatedAdmin(ctx))) {
        return;
      }
      await safeAnswerCbQuery(ctx);
      await promptForInput(ctx, ctx.from!.id, "group_id", "Send the new Telegram Group ID\n\nExample:\n<code>-1001234567890</code>");
    } catch (error) {
      console.error("[groupManagement] ADMIN_GROUP_CHANGE_ID error:", getErrorMessage(error));
      await safeAnswerCbQuery(ctx, "Error opening group ID editor");
    }
  });

  bot.action("ADMIN_GROUP_CONFIRM_ID", async (ctx: Context) => {
    try {
      if (!(await assertAuthenticatedAdmin(ctx))) {
        return;
      }
      const pendingChange = pendingGroupIdChanges.get(ctx.from!.id);
      if (!pendingChange) {
        await safeAnswerCbQuery(ctx, "No pending change");
        return;
      }

      await updateGroupSettings({ groupId: pendingChange.newGroupId }, ctx.from!.id);
      pendingGroupIdChanges.delete(ctx.from!.id);
      await safeAnswerCbQuery(ctx, "Group ID updated");
      await showGroupManagementHome(ctx, bot);
    } catch (error) {
      console.error("[groupManagement] ADMIN_GROUP_CONFIRM_ID error:", getErrorMessage(error));
      await safeAnswerCbQuery(ctx, "Error saving group ID");
    }
  });

  bot.action("ADMIN_GROUP_CANCEL_ID", async (ctx: Context) => {
    try {
      if (!(await assertAuthenticatedAdmin(ctx))) {
        return;
      }
      pendingGroupIdChanges.delete(ctx.from!.id);
      await safeAnswerCbQuery(ctx, "Cancelled");
      await showGroupManagementHome(ctx, bot);
    } catch (error) {
      console.error("[groupManagement] ADMIN_GROUP_CANCEL_ID error:", getErrorMessage(error));
      await safeAnswerCbQuery(ctx, "Error cancelling");
    }
  });

  bot.action("ADMIN_GROUP_VERIFICATION_SETTINGS", async (ctx: Context) => {
    if (!(await assertAuthenticatedAdmin(ctx))) {
      return;
    }
    await safeAnswerCbQuery(ctx);
    await showVerificationSettings(ctx);
  });

  bot.action("ADMIN_GROUP_ENABLE_VERIFICATION", async (ctx: Context) => {
    if (!(await assertAuthenticatedAdmin(ctx))) {
      return;
    }
    await updateGroupSettings({ verificationEnabled: true }, ctx.from!.id);
    await safeAnswerCbQuery(ctx, "Verification enabled");
    await showVerificationSettings(ctx);
  });

  bot.action("ADMIN_GROUP_DISABLE_VERIFICATION", async (ctx: Context) => {
    if (!(await assertAuthenticatedAdmin(ctx))) {
      return;
    }
    await updateGroupSettings({ verificationEnabled: false }, ctx.from!.id);
    await safeAnswerCbQuery(ctx, "Verification disabled");
    await showVerificationSettings(ctx);
  });

  bot.action("ADMIN_GROUP_AUTOKICK_SETTINGS", async (ctx: Context) => {
    if (!(await assertAuthenticatedAdmin(ctx))) {
      return;
    }
    await safeAnswerCbQuery(ctx);
    await showAutoKickSettings(ctx);
  });

  bot.action("ADMIN_GROUP_AUTOKICK_TOGGLE", async (ctx: Context) => {
    if (!(await assertAuthenticatedAdmin(ctx))) {
      return;
    }
    const settings = await getGroupSettings();
    await updateGroupSettings({ autoKickEnabled: !settings.autoKickEnabled }, ctx.from!.id);
    await safeAnswerCbQuery(ctx, "Auto kick updated");
    await showAutoKickSettings(ctx);
  });

  bot.action("ADMIN_GROUP_AUTOKICK_INCREASE", async (ctx: Context) => {
    if (!(await assertAuthenticatedAdmin(ctx))) {
      return;
    }
    const settings = await getGroupSettings();
    await updateGroupSettings({ autoKickEnabled: true, autoKickMinutes: settings.autoKickMinutes + 1 }, ctx.from!.id);
    await safeAnswerCbQuery(ctx, "Timeout increased");
    await showAutoKickSettings(ctx);
  });

  bot.action("ADMIN_GROUP_AUTOKICK_DECREASE", async (ctx: Context) => {
    if (!(await assertAuthenticatedAdmin(ctx))) {
      return;
    }
    const settings = await getGroupSettings();
    const nextMinutes = Math.max(1, settings.autoKickMinutes - 1);
    await updateGroupSettings({ autoKickEnabled: true, autoKickMinutes: nextMinutes }, ctx.from!.id);
    await safeAnswerCbQuery(ctx, "Timeout decreased");
    await showAutoKickSettings(ctx);
  });

  bot.action("ADMIN_GROUP_AUTOKICK_CUSTOM", async (ctx: Context) => {
    if (!(await assertAuthenticatedAdmin(ctx))) {
      return;
    }
    await safeAnswerCbQuery(ctx);
    await promptForInput(ctx, ctx.from!.id, "auto_kick_custom", "Send the new auto kick timeout in minutes.");
  });

  bot.action("ADMIN_GROUP_MESSAGE_SETTINGS", async (ctx: Context) => {
    if (!(await assertAuthenticatedAdmin(ctx))) {
      return;
    }
    await safeAnswerCbQuery(ctx);
    await showVerificationMessageSettings(ctx);
  });

  bot.action("ADMIN_GROUP_MESSAGE_EDIT", async (ctx: Context) => {
    if (!(await assertAuthenticatedAdmin(ctx))) {
      return;
    }
    await safeAnswerCbQuery(ctx);
    await promptForInput(
      ctx,
      ctx.from!.id,
      "verification_message",
      [
        "Send the new verification message.",
        "",
        "Supported variables:",
        "{first_name}",
        "{username}",
        "{group_name}",
        "{bot_name}"
      ].join("\n")
    );
  });

  bot.action("ADMIN_GROUP_MESSAGE_RESET", async (ctx: Context) => {
    if (!(await assertAuthenticatedAdmin(ctx))) {
      return;
    }
    await updateGroupSettings({ verificationMessage: getDefaultGroupVerificationMessage() }, ctx.from!.id);
    await safeAnswerCbQuery(ctx, "Message reset");
    await showVerificationMessageSettings(ctx);
  });

  bot.action("ADMIN_GROUP_MESSAGE_PREVIEW", async (ctx: Context) => {
    if (!(await assertAuthenticatedAdmin(ctx))) {
      return;
    }
    const settings = await getGroupSettings();
    const variables = await buildTemplateVariables(bot, settings, ctx.from as TelegramUser);
    const preview = formatVerificationTemplatePreview(settings.verificationMessage, variables);
    await safeAnswerCbQuery(ctx);
    await safeEditMessageText(ctx, `👁 <b>Verification Message Preview</b>\n\n${preview}`, {
      parse_mode: "HTML",
      ...buildBackAndHomeKeyboard("ADMIN_GROUP_MESSAGE_SETTINGS")
    });
  });

  bot.action("ADMIN_GROUP_INVITE_SETTINGS", async (ctx: Context) => {
    if (!(await assertAuthenticatedAdmin(ctx))) {
      return;
    }
    await safeAnswerCbQuery(ctx);
    await showInviteLinkSettings(ctx);
  });

  bot.action("ADMIN_GROUP_INVITE_EDIT", async (ctx: Context) => {
    if (!(await assertAuthenticatedAdmin(ctx))) {
      return;
    }
    await safeAnswerCbQuery(ctx);
    await promptForInput(ctx, ctx.from!.id, "invite_link", "Send the new Telegram invite link.");
  });

  bot.action("ADMIN_GROUP_INVITE_PREVIEW", async (ctx: Context) => {
    if (!(await assertAuthenticatedAdmin(ctx))) {
      return;
    }
    const settings = await getGroupSettings();
    await safeAnswerCbQuery(ctx);
    await safeEditMessageText(ctx, `👁 <b>Invite Link Preview</b>\n\n${escapeHtml(settings.inviteLink)}`, {
      parse_mode: "HTML",
      ...buildBackAndHomeKeyboard("ADMIN_GROUP_INVITE_SETTINGS")
    });
  });

  bot.action("ADMIN_GROUP_RUN_DIAGNOSTICS", async (ctx: Context) => {
    if (!(await assertAuthenticatedAdmin(ctx))) {
      return;
    }
    const settings = await getGroupSettings();
    const diagnostics = await runGroupDiagnostics(bot, settings);
    await safeAnswerCbQuery(ctx);
    await safeEditMessageText(ctx, formatDiagnosticsText(diagnostics), {
      parse_mode: "HTML",
      ...buildBackAndHomeKeyboard("ADMIN_GROUP_MANAGEMENT")
    });
  });

  bot.action("ADMIN_GROUP_VIEW_CONFIGURATION", async (ctx: Context) => {
    if (!(await assertAuthenticatedAdmin(ctx))) {
      return;
    }
    await safeAnswerCbQuery(ctx);
    await showConfiguration(ctx);
  });
}

export async function getRuntimeGroupSettings(): Promise<GroupSettings> {
  return getGroupSettings();
}

export function getPendingGroupManagementMode(adminId: number): GroupInputMode | null {
  return pendingInputModes.get(adminId) ?? null;
}

export function clearPendingGroupManagementInput(adminId: number): void {
  clearPendingGroupManagementState(adminId);
}
