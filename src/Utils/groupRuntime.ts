import { User as TelegramUser } from "@telegraf/types";
import { ExtraTelegraf } from "../index";
import {
  getDefaultGroupInviteLink,
  getDefaultGroupVerificationMessage,
  getGroupSettings,
  GroupSettings
} from "../storage/db";

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

export async function getRuntimeGroupInviteLink(): Promise<string> {
  const settings = await getGroupSettings();
  return settings.inviteLink || getDefaultGroupInviteLink();
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

export async function renderVerificationMessage(
  bot: ExtraTelegraf,
  user: TelegramUser,
  settings?: GroupSettings
): Promise<string> {
  const resolvedSettings = settings || await getGroupSettings();
  const template = resolvedSettings.verificationMessage || getDefaultGroupVerificationMessage();
  const botName = bot.botInfo?.username || process.env.BOT_USERNAME || "allindiachatbot";
  const groupName = await getGroupName(bot, resolvedSettings);
  const username = user.username ? `@${escapeHtml(user.username)}` : getUserMention(user);

  return template.replace(/\{(first_name|username|group_name|bot_name)\}/g, (_, key: string) => {
    switch (key) {
      case "first_name":
        return getUserMention(user);
      case "username":
        return username;
      case "group_name":
        return escapeHtml(groupName);
      case "bot_name":
        return escapeHtml(botName);
      default:
        return "";
    }
  });
}
