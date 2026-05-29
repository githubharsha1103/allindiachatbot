import { User as TelegramUser } from "@telegraf/types";
import { ExtraTelegraf } from "../index";
import {
  buildVerificationBotDisplay,
  buildVerificationBotUrl,
  getDefaultGroupVerificationMessage,
  getGroupSettings,
  GroupSettings,
  normalizeBotUsername
} from "../storage/db";

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function getUserLabel(user: TelegramUser): string {
  return user.first_name || user.username || "there";
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

export async function getRuntimeGroupSettings(): Promise<GroupSettings> {
  return getGroupSettings();
}

export async function getRuntimeGroupId(): Promise<string | null> {
  const settings = await getGroupSettings();
  return settings.groupId || null;
}

export async function isRuntimeVerificationEnabled(): Promise<boolean> {
  const settings = await getGroupSettings();
  return settings.verificationEnabled;
}

export async function getRuntimeAutoKickMinutes(): Promise<number | null> {
  const settings = await getGroupSettings();
  return settings.autoKickEnabled ? settings.autoKickMinutes : null;
}

export function getVerificationButtonUrl(username: string): string {
  return buildVerificationBotUrl(username);
}

export function getVerificationButtonText(username: string): string {
  return `@${normalizeBotUsername(username)}`;
}

export async function renderVerificationMessage(
  bot: ExtraTelegraf,
  user: TelegramUser,
  settings?: GroupSettings
): Promise<string> {
  const resolvedSettings = settings || await getGroupSettings();
  const template = resolvedSettings.verificationMessage || getDefaultGroupVerificationMessage();
  const botUsername = normalizeBotUsername(resolvedSettings.verificationBotUsername || bot.botInfo?.username || process.env.BOT_USERNAME);
  const groupName = await getGroupName(bot, resolvedSettings);
  const username = user.username ? `@${escapeHtml(user.username)}` : "";

  return template
    .replace(/\{first_name\}/g, escapeHtml(getUserLabel(user)))
    .replace(/\{username\}/g, username)
    .replace(/\{group_name\}/g, escapeHtml(groupName))
    .replace(/\{bot_username\}/g, escapeHtml(botUsername));
}
