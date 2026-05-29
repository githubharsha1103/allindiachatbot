import { Context, Markup } from "telegraf";
import type { ChatPermissions, ChatMemberUpdated, User as TelegramUser } from "@telegraf/types";
import type { ExtraTelegraf } from "../index";
import { getUser, isUserVerifiedForGroup, markUserVerifiedForGroup, updateUser } from "../storage/db";

const DEFAULT_BOT_USERNAME = process.env.BOT_USERNAME || "allindiachatbot";
const joinMessageCooldowns = new Map<string, number>();
const autoKickTimeouts = new Map<string, NodeJS.Timeout>();
const JOIN_MESSAGE_DEDUPE_MS = 15 * 1000;

const RESTRICTED_PERMISSIONS: ChatPermissions = {
  can_send_messages: false,
  can_send_audios: false,
  can_send_documents: false,
  can_send_photos: false,
  can_send_videos: false,
  can_send_video_notes: false,
  can_send_voice_notes: false,
  can_send_polls: false,
  can_send_other_messages: false,
  can_add_web_page_previews: false
};

const VERIFIED_PERMISSIONS: ChatPermissions = {
  can_send_messages: true,
  can_send_audios: true,
  can_send_documents: true,
  can_send_photos: true,
  can_send_videos: true,
  can_send_video_notes: true,
  can_send_voice_notes: true,
  can_send_polls: true,
  can_send_other_messages: true,
  can_add_web_page_previews: true
};

type ChatMemberContext = Context & {
  chatMember?: ChatMemberUpdated;
};

function getVerificationEnabled(): boolean {
  return (process.env.VERIFICATION_ENABLED || "false").toLowerCase() === "true";
}

function getVerificationGroupId(): string | null {
  return process.env.GROUP_ID || process.env.GROUP_CHAT_ID || null;
}

function getAutoKickUnverifiedMinutes(): number | null {
  const rawValue = process.env.AUTO_KICK_UNVERIFIED_MINUTES;
  if (!rawValue) {
    return null;
  }

  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function buildVerificationUrl(): string {
  return `https://t.me/${DEFAULT_BOT_USERNAME}?start=groupverify`;
}

function getJoinKey(groupId: string, userId: number): string {
  return `${groupId}:${userId}`;
}

function getUserMention(user: TelegramUser): string {
  const label = user.username ? `@${user.username}` : user.first_name;
  return `<a href="tg://user?id=${user.id}">${escapeHtml(label)}</a>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildVerificationMessage(user: TelegramUser): string {
  return `${getUserMention(user)}\n\n🔒 Welcome!\n\nTo chat in this group, you must start @${DEFAULT_BOT_USERNAME}.\n\nClick below to verify.`;
}

function buildVerificationKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.url("✅ Verify Account", buildVerificationUrl())]
  ]);
}

function shouldSendJoinMessage(groupId: string, userId: number): boolean {
  const joinKey = getJoinKey(groupId, userId);
  const lastSentAt = joinMessageCooldowns.get(joinKey);

  if (lastSentAt && Date.now() - lastSentAt < JOIN_MESSAGE_DEDUPE_MS) {
    return false;
  }

  joinMessageCooldowns.set(joinKey, Date.now());
  return true;
}

function clearAutoKickTimeout(groupId: string, userId: number): void {
  const joinKey = getJoinKey(groupId, userId);
  const timeout = autoKickTimeouts.get(joinKey);
  if (timeout) {
    clearTimeout(timeout);
    autoKickTimeouts.delete(joinKey);
  }
}

async function isGroupMember(bot: ExtraTelegraf, groupId: string, userId: number): Promise<boolean> {
  try {
    const member = await bot.telegram.getChatMember(groupId, userId);
    return ["creator", "administrator", "member", "restricted"].includes(member.status);
  } catch (error) {
    console.error(`[GROUP_VERIFY] Verification failed to check membership for user ${userId} in ${groupId}:`, error);
    return false;
  }
}

async function restrictUser(bot: ExtraTelegraf, groupId: string, userId: number): Promise<void> {
  await bot.telegram.restrictChatMember(groupId, userId, {
    permissions: RESTRICTED_PERMISSIONS
  });
}

export async function unrestrictVerifiedUser(bot: ExtraTelegraf, groupId: string, userId: number): Promise<void> {
  await bot.telegram.restrictChatMember(groupId, userId, {
    permissions: VERIFIED_PERMISSIONS
  });
}

async function kickUnverifiedUser(bot: ExtraTelegraf, groupId: string, userId: number): Promise<void> {
  await bot.telegram.banChatMember(groupId, userId, undefined, { revoke_messages: false });
  await bot.telegram.unbanChatMember(groupId, userId, { only_if_banned: true });
}

function scheduleAutoKick(bot: ExtraTelegraf, groupId: string, userId: number): void {
  const autoKickMinutes = getAutoKickUnverifiedMinutes();
  if (!autoKickMinutes) {
    return;
  }

  clearAutoKickTimeout(groupId, userId);

  const joinKey = getJoinKey(groupId, userId);
  const timeout = setTimeout(async () => {
    autoKickTimeouts.delete(joinKey);

    try {
      const stillVerified = await isUserVerifiedForGroup(userId, groupId);
      if (stillVerified) {
        return;
      }

      const stillMember = await isGroupMember(bot, groupId, userId);
      if (!stillMember) {
        return;
      }

      await kickUnverifiedUser(bot, groupId, userId);
      console.log(`[GROUP_VERIFY] User auto-kicked: userId=${userId}, groupId=${groupId}, timeoutMinutes=${autoKickMinutes}`);
    } catch (error) {
      console.error(`[GROUP_VERIFY] Auto-kick failed for user ${userId} in group ${groupId}:`, error);
    }
  }, autoKickMinutes * 60 * 1000);

  autoKickTimeouts.set(joinKey, timeout);
}

async function processJoinedUser(bot: ExtraTelegraf, groupId: string, user: TelegramUser): Promise<void> {
  if (user.is_bot) {
    return;
  }

  console.log(`[GROUP_VERIFY] User joined group: userId=${user.id}, groupId=${groupId}`);

  await getUser(user.id);
  await updateUser(user.id, {
    name: user.username || user.first_name || null,
    lastActive: Date.now()
  });

  const alreadyVerified = await isUserVerifiedForGroup(user.id, groupId);
  if (alreadyVerified) {
    console.log(`[GROUP_VERIFY] User ${user.id} already verified for group ${groupId}, skipping restriction`);
    clearAutoKickTimeout(groupId, user.id);

    try {
      await unrestrictVerifiedUser(bot, groupId, user.id);
      console.log(`[GROUP_VERIFY] User unrestricted: userId=${user.id}, groupId=${groupId}`);
    } catch (error) {
      console.error(`[GROUP_VERIFY] Failed to ensure unrestricted state for verified user ${user.id}:`, error);
    }
    return;
  }

  await restrictUser(bot, groupId, user.id);
  console.log(`[GROUP_VERIFY] User restricted: userId=${user.id}, groupId=${groupId}`);

  if (shouldSendJoinMessage(groupId, user.id)) {
    await bot.telegram.sendMessage(groupId, buildVerificationMessage(user), {
      parse_mode: "HTML",
      ...buildVerificationKeyboard()
    });
  }

  scheduleAutoKick(bot, groupId, user.id);
}

export async function handleChatMemberUpdate(ctx: ChatMemberContext, bot: ExtraTelegraf): Promise<void> {
  if (!getVerificationEnabled()) {
    return;
  }

  const groupId = getVerificationGroupId();
  const update = ctx.chatMember;
  if (!groupId || !update || String(update.chat.id) !== groupId) {
    return;
  }

  const oldStatus = update.old_chat_member.status;
  const newStatus = update.new_chat_member.status;
  const joinedStatuses = ["member", "restricted", "administrator"];
  const oldJoinedStatuses = ["member", "restricted", "administrator", "creator"];

  if (!joinedStatuses.includes(newStatus) || oldJoinedStatuses.includes(oldStatus)) {
    return;
  }

  try {
    await processJoinedUser(bot, groupId, update.new_chat_member.user);
  } catch (error) {
    console.error(`[GROUP_VERIFY] Failed handling chat_member update for user ${update.new_chat_member.user.id}:`, error);
  }
}

export async function handleGroupVerificationStart(ctx: Context, bot: ExtraTelegraf): Promise<boolean> {
  if (!ctx.from) {
    await ctx.reply("⚠️ Could not identify your account. Please try again.");
    return true;
  }

  if (!getVerificationEnabled()) {
    await ctx.reply("❌ Verification is currently disabled.");
    return true;
  }

  const groupId = getVerificationGroupId();
  if (!groupId) {
    console.error("[GROUP_VERIFY] Verification requested but GROUP_ID/GROUP_CHAT_ID is not configured");
    await ctx.reply("❌ Verification is not configured right now.");
    return true;
  }

  const userId = ctx.from.id;
  console.log(`[GROUP_VERIFY] Verification started: userId=${userId}, groupId=${groupId}`);

  const alreadyVerified = await isUserVerifiedForGroup(userId, groupId);
  if (alreadyVerified) {
    clearAutoKickTimeout(groupId, userId);
    await ctx.reply("✅ You are already verified.");
    return true;
  }

  const isMember = await isGroupMember(bot, groupId, userId);
  if (!isMember) {
    console.log(`[GROUP_VERIFY] Verification failed: userId=${userId}, reason=not_in_group`);
    await ctx.reply("❌ Join the group first.");
    return true;
  }

  try {
    const user = await getUser(userId);
    await markUserVerifiedForGroup(userId, groupId);
    await updateUser(userId, {
      name: ctx.from.username || ctx.from.first_name || user.name,
      lastActive: Date.now(),
      hasJoinedGroup: true,
      groupVerified: true
    });

    await unrestrictVerifiedUser(bot, groupId, userId);
    clearAutoKickTimeout(groupId, userId);

    console.log(`[GROUP_VERIFY] Verification successful: userId=${userId}, groupId=${groupId}`);
    console.log(`[GROUP_VERIFY] User unrestricted: userId=${userId}, groupId=${groupId}`);
    await ctx.reply("✅ Verification successful. You can now chat in the group.");
  } catch (error) {
    console.error(`[GROUP_VERIFY] Verification failed: userId=${userId}, groupId=${groupId}:`, error);
    await ctx.reply("❌ Verification failed. Please try again in a moment.");
  }

  return true;
}
