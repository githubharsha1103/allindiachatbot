import { Context, Markup } from "telegraf";
import { ExtraTelegraf } from "../index";
import { isAdminContext, unauthorizedResponse } from "../Utils/adminAuth";
import { safeAnswerCbQuery, safeEditMessageText } from "../Utils/telegramUi";
import {
  getReengagementAnalytics,
  getReengagementEngineSettings,
  updateReengagementEngineSettings
} from "../storage/db";
import {
  getReengagementMessagePerformance,
  getReengagementMessagePreview,
  sendDailyReengagement
} from "../Utils/reengagementEngine";

type ReengagementInputMode = "send_time" | "threshold";

const pendingInputModes = new Map<number, ReengagementInputMode>();

function buildKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✅ Enable/Disable Engine", "ADMIN_REENGAGE_TOGGLE")],
    [Markup.button.callback("⏰ Send Time", "ADMIN_REENGAGE_SEND_TIME")],
    [Markup.button.callback("📅 Inactivity Threshold", "ADMIN_REENGAGE_THRESHOLD")],
    [Markup.button.callback("🎲 Random Message Rotation", "ADMIN_REENGAGE_ROTATION")],
    [Markup.button.callback("💞 Connect To Chat Button", "ADMIN_REENGAGE_BUTTON")],
    [Markup.button.callback("👁 Preview Message", "ADMIN_REENGAGE_PREVIEW")],
    [Markup.button.callback("📊 Analytics Dashboard", "ADMIN_REENGAGE_ANALYTICS")],
    [Markup.button.callback("⬅ Back", "ADMIN_BACK")],
    [Markup.button.callback("🏠 Admin Home", "ADMIN_BACK")]
  ]);
}

async function assertAdmin(ctx: Context): Promise<boolean> {
  if (!isAdminContext(ctx)) {
    await unauthorizedResponse(ctx, "Unauthorized");
    return false;
  }
  return true;
}

export async function showReengagementEngine(ctx: Context): Promise<void> {
  const settings = await getReengagementEngineSettings();
  const text = [
    "📈 <b>Re-engagement Engine</b>",
    "",
    `Engine: ${settings.enabled ? "✅ Enabled" : "❌ Disabled"}`,
    `Send Time: ${settings.sendTime}`,
    `Inactivity Threshold: ${settings.inactivityThresholdHours} hours`,
    `Random Rotation: ${settings.randomMessageRotation ? "✅ Enabled" : "❌ Disabled"}`,
    `Connect To Chat Button: ${settings.connectToChatButton ? "✅ Enabled" : "❌ Disabled"}`
  ].join("\n");
  await safeEditMessageText(ctx, text, { parse_mode: "HTML", ...buildKeyboard() });
}

async function showAnalytics(ctx: Context): Promise<void> {
  const analytics = await getReengagementAnalytics();
  const performance = getReengagementMessagePerformance(analytics);
  const ctr = analytics.reminders_sent > 0 ? ((analytics.reminders_clicked / analytics.reminders_sent) * 100).toFixed(1) : "0.0";

  const formatRow = (row: { message: string; sent: number; clicked: number; ctr: number }) =>
    `• ${row.message}\n  Sent: ${row.sent} | Clicked: ${row.clicked} | CTR: ${row.ctr.toFixed(1)}%`;

  const text = [
    "📊 <b>Re-engagement Analytics</b>",
    "",
    `Sent: ${analytics.reminders_sent}`,
    `Delivered: ${analytics.reminders_delivered}`,
    `Clicked: ${analytics.reminders_clicked}`,
    `Failed: ${analytics.reminders_failed}`,
    `Returned Users: ${analytics.users_returned}`,
    `Started Chat: ${analytics.next_started_from_reminder}`,
    `Matches Created: ${analytics.successful_matches_from_reminder}`,
    "",
    `CTR: ${ctr}%`,
    "",
    "🏆 Best Performing Messages",
    performance.best.length > 0 ? performance.best.map(formatRow).join("\n") : "No data yet.",
    "",
    "📉 Worst Performing Messages",
    performance.worst.length > 0 ? performance.worst.map(formatRow).join("\n") : "No data yet."
  ].join("\n");

  await safeEditMessageText(ctx, text, { parse_mode: "HTML", ...buildKeyboard() });
}

async function promptInput(ctx: Context, mode: ReengagementInputMode, text: string): Promise<void> {
  pendingInputModes.set(ctx.from!.id, mode);
  await safeEditMessageText(ctx, text, { parse_mode: "HTML", ...buildKeyboard() });
}

export async function processReengagementEngineInput(ctx: Context): Promise<boolean> {
  const adminId = ctx.from?.id;
  if (!adminId) return false;
  const mode = pendingInputModes.get(adminId);
  if (!mode) return false;

  if (!(await assertAdmin(ctx))) {
    pendingInputModes.delete(adminId);
    return true;
  }

  const messageText = "message" in ctx.update && ctx.update.message && "text" in ctx.update.message ? ctx.update.message.text : "";
  const input = messageText.trim();
  if (!input) {
    await ctx.reply("❌ Please send a valid value.");
    return true;
  }

  if (mode === "send_time") {
    if (!/^\d{1,2}:\d{2}$/.test(input)) {
      await ctx.reply("❌ Use 24-hour format like 10:00.");
      return true;
    }
    pendingInputModes.delete(adminId);
    await updateReengagementEngineSettings({ sendTime: input }, adminId);
    await ctx.reply(`✅ Send time updated to ${input}.`);
    return true;
  }

  if (mode === "threshold") {
    const hours = Number.parseInt(input, 10);
    if (!Number.isFinite(hours) || hours < 1 || hours > 168) {
      await ctx.reply("❌ Threshold must be between 1 and 168 hours.");
      return true;
    }
    pendingInputModes.delete(adminId);
    await updateReengagementEngineSettings({ inactivityThresholdHours: hours }, adminId);
    await ctx.reply(`✅ Inactivity threshold updated to ${hours} hours.`);
    return true;
  }

  return false;
}

export function registerReengagementEngineCallbacks(bot: ExtraTelegraf): void {
  bot.action("ADMIN_REENGAGE_ENGINE", async (ctx) => {
    if (!(await assertAdmin(ctx))) return;
    await safeAnswerCbQuery(ctx);
    await showReengagementEngine(ctx);
  });

  bot.action("ADMIN_REENGAGE_TOGGLE", async (ctx) => {
    if (!(await assertAdmin(ctx))) return;
    const settings = await getReengagementEngineSettings();
    await updateReengagementEngineSettings({ enabled: !settings.enabled }, ctx.from!.id);
    await safeAnswerCbQuery(ctx, "Updated");
    await showReengagementEngine(ctx);
  });

  bot.action("ADMIN_REENGAGE_SEND_TIME", async (ctx) => {
    if (!(await assertAdmin(ctx))) return;
    await safeAnswerCbQuery(ctx);
    await promptInput(ctx, "send_time", "Send the new time in 24-hour format.\nExample: <code>10:00</code>");
  });

  bot.action("ADMIN_REENGAGE_THRESHOLD", async (ctx) => {
    if (!(await assertAdmin(ctx))) return;
    await safeAnswerCbQuery(ctx);
    await promptInput(ctx, "threshold", "Send the inactivity threshold in hours.\nExample: <code>24</code>");
  });

  bot.action("ADMIN_REENGAGE_ROTATION", async (ctx) => {
    if (!(await assertAdmin(ctx))) return;
    const settings = await getReengagementEngineSettings();
    await updateReengagementEngineSettings({ randomMessageRotation: !settings.randomMessageRotation }, ctx.from!.id);
    await safeAnswerCbQuery(ctx, "Updated");
    await showReengagementEngine(ctx);
  });

  bot.action("ADMIN_REENGAGE_BUTTON", async (ctx) => {
    if (!(await assertAdmin(ctx))) return;
    const settings = await getReengagementEngineSettings();
    await updateReengagementEngineSettings({ connectToChatButton: !settings.connectToChatButton }, ctx.from!.id);
    await safeAnswerCbQuery(ctx, "Updated");
    await showReengagementEngine(ctx);
  });

  bot.action("ADMIN_REENGAGE_PREVIEW", async (ctx) => {
    if (!(await assertAdmin(ctx))) return;
    const preview = getReengagementMessagePreview();
    await safeAnswerCbQuery(ctx);
    await safeEditMessageText(
      ctx,
      `👁 <b>Message Preview</b>\n\n${preview.message}\n\nButton: ${preview.buttonLabel}\nURL: <code>${preview.deepLink}</code>`,
      { parse_mode: "HTML", ...buildKeyboard() }
    );
  });

  bot.action("ADMIN_REENGAGE_ANALYTICS", async (ctx) => {
    if (!(await assertAdmin(ctx))) return;
    await safeAnswerCbQuery(ctx);
    await showAnalytics(ctx);
  });

  bot.action("ADMIN_REENGAGE_RUN_NOW", async (ctx) => {
    if (!(await assertAdmin(ctx))) return;
    await safeAnswerCbQuery(ctx, "Sending reminders...");
    await sendDailyReengagement(bot);
    await showAnalytics(ctx);
  });
}
