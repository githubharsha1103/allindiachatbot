import { Context, Markup } from "telegraf";
import type { ChatPermissions, ChatMemberUpdated, User as TelegramUser } from "@telegraf/types";
import type { ExtraTelegraf } from "../index";
import {
  clearPendingGroupVerification,
  getPendingGroupVerification,
  getUser,
  isUserVerifiedForGroup,
  markPendingGroupVerified,
  markUserVerifiedForGroup,
  upsertPendingGroupVerification,
  updateUser
} from "../storage/db";
import { getRuntimeAutoKickMinutes, getRuntimeGroupSettings, getVerificationButtonText, getVerificationButtonUrl, renderVerificationMessage } from "./groupRuntime";

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

const autoKickTimeouts = new Map<string, NodeJS.Timeout>();

type ChatMemberContext = Context & { chatMember?: ChatMemberUpdated };

function joinKey(groupId: string, userId: number): string {
  return `${groupId}:${userId}`;
}

function verificationKeyboard(username: string) {
  return Markup.inlineKeyboard([
    [Markup.button.url("▶ Start Verification", getVerificationButtonUrl(username))]
  ]);
}

async function restrictUser(bot: ExtraTelegraf, groupId: string, userId: number): Promise<void> {
  await bot.telegram.restrictChatMember(groupId, userId, { permissions: RESTRICTED_PERMISSIONS });
}

export async function unrestrictVerifiedUser(bot: ExtraTelegraf, groupId: string, userId: number): Promise<void> {
  await bot.telegram.restrictChatMember(groupId, userId, { permissions: VERIFIED_PERMISSIONS });
}

async function kickUnverifiedUser(bot: ExtraTelegraf, groupId: string, userId: number): Promise<void> {
  await bot.telegram.banChatMember(groupId, userId, undefined, { revoke_messages: false });
  await bot.telegram.unbanChatMember(groupId, userId, { only_if_banned: true });
}

function clearAutoKickTimeout(groupId: string, userId: number): void {
  const timeout = autoKickTimeouts.get(joinKey(groupId, userId));
  if (timeout) {
    clearTimeout(timeout);
    autoKickTimeouts.delete(joinKey(groupId, userId));
  }
}

async function scheduleAutoKick(bot: ExtraTelegraf, groupId: string, userId: number): Promise<void> {
  const autoKickMinutes = await getRuntimeAutoKickMinutes();
  if (!autoKickMinutes) {
    return;
  }

  clearAutoKickTimeout(groupId, userId);

  const timeout = setTimeout(async () => {
    autoKickTimeouts.delete(joinKey(groupId, userId));
    try {
      const pending = await getPendingGroupVerification(userId, groupId);
      if (!pending || pending.verified) {
        return;
      }

      const member = await bot.telegram.getChatMember(groupId, userId);
      if (!["member", "restricted"].includes(member.status)) {
        return;
      }

      await kickUnverifiedUser(bot, groupId, userId);
    } catch (error) {
      console.error(`[GROUP_VERIFY] Auto-kick failed for user ${userId} in group ${groupId}:`, error);
    }
  }, autoKickMinutes * 60 * 1000);

  autoKickTimeouts.set(joinKey(groupId, userId), timeout);
}

async function processJoinedUser(bot: ExtraTelegraf, groupId: string, user: TelegramUser): Promise<void> {
  if (user.is_bot) return;

  const settings = await getRuntimeGroupSettings();
  const alreadyVerified = await isUserVerifiedForGroup(user.id, groupId);

  await getUser(user.id);
  await updateUser(user.id, { name: user.username || user.first_name || null, lastActive: Date.now() });

  if (alreadyVerified) {
    clearAutoKickTimeout(groupId, user.id);
    await unrestrictVerifiedUser(bot, groupId, user.id);
    return;
  }

  await restrictUser(bot, groupId, user.id);

  const joinedAt = Date.now();
  const autoKickAt = settings.autoKickEnabled ? joinedAt + (settings.autoKickMinutes * 60 * 1000) : undefined;
  await upsertPendingGroupVerification(user.id, groupId, joinedAt, autoKickAt, autoKickAt);

  await bot.telegram.sendMessage(
    groupId,
    await renderVerificationMessage(bot, user, settings),
    {
      parse_mode: "HTML",
      ...verificationKeyboard(settings.verificationBotUsername)
    }
  );

  await scheduleAutoKick(bot, groupId, user.id);
}

export async function handleChatMemberUpdate(ctx: ChatMemberContext, bot: ExtraTelegraf): Promise<void> {
  const settings = await getRuntimeGroupSettings();
  const update = ctx.chatMember;
  if (!update || !settings.verificationEnabled || !settings.groupId || String(update.chat.id) !== settings.groupId) {
    return;
  }

  const oldStatus = update.old_chat_member.status;
  const newStatus = update.new_chat_member.status;
  if (!["member", "restricted", "administrator"].includes(newStatus) || ["member", "restricted", "administrator", "creator"].includes(oldStatus)) {
    return;
  }

  await processJoinedUser(bot, settings.groupId, update.new_chat_member.user);
}

export async function handleGroupVerificationStart(ctx: Context, bot: ExtraTelegraf): Promise<boolean> {
  if (!ctx.from) {
    await ctx.reply("❌ Could not identify your account. Please try again.");
    return true;
  }

  const settings = await getRuntimeGroupSettings();
  if (!settings.verificationEnabled) {
    await ctx.reply("❌ Verification is currently disabled.");
    return true;
  }

  if (!settings.groupId) {
    await ctx.reply("❌ Verification is not configured right now.");
    return true;
  }

  const userId = ctx.from.id;
  const pending = await getPendingGroupVerification(userId, settings.groupId);
  if (!pending) {
    const verified = await isUserVerifiedForGroup(userId, settings.groupId);
    if (verified) {
      await ctx.reply("✅ You are already verified.");
      return true;
    }
    await ctx.reply("❌ Join the group first.");
    return true;
  }

  if (pending.groupId !== settings.groupId) {
    await ctx.reply("❌ Join the group first.");
    return true;
  }

  if (pending.verified || await isUserVerifiedForGroup(userId, settings.groupId)) {
    await ctx.reply("✅ You are already verified.");
    return true;
  }

  try {
    await markPendingGroupVerified(userId, settings.groupId);
    await markUserVerifiedForGroup(userId, settings.groupId);
    await unrestrictVerifiedUser(bot, settings.groupId, userId);
    clearAutoKickTimeout(settings.groupId, userId);
    await clearPendingGroupVerification(userId, settings.groupId);
    await updateUser(userId, { hasJoinedGroup: true, groupVerified: true, lastActive: Date.now() });
    await ctx.reply("✅ Verification successful.\n\nYou can now chat in the group.");
    return true;
  } catch (error) {
    console.error(`[GROUP_VERIFY] Verification failed for user ${userId}:`, error);
    await ctx.reply("❌ Verification failed. Please try again.");
    return true;
  }
}
