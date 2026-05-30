import { Markup, Context } from "telegraf";
import { ExtraTelegraf } from "../index";
import {
  getInactiveUsers,
  getReengagementEngineSettings,
  getReengagementAnalytics,
  incrementReengagementAnalytics,
  getUser,
  updateUser
} from "../storage/db";
import { sendMessageWithRetry } from "./telegramErrorHandler";
import nextCommand from "../Commands/next";

type EngineRuntime = {
  timer?: NodeJS.Timeout;
};

const runtime: EngineRuntime = {};
const sentCache = new Map<number, string[]>();
const messages = [
  "👀 Someone interesting might be online right now.",
  "💭 You never know who you'll meet today.",
  "❤️ Someone could be waiting for a message from you.",
  "🔥 New people joined today.",
  "✨ Your next favorite conversation could start with one tap.",
  "🌙 A fresh chat might be the best part of your day.",
  "🌈 One new message can change your mood.",
  "🫶 A friendly conversation could be one click away.",
  "🎯 Your next match may already be waiting.",
  "💡 A fun chat might be closer than you think.",
  "🌟 Someone new could brighten your day.",
  "🚀 It only takes one tap to meet someone new.",
  "🎉 New conversations are always better than waiting.",
  "💬 A simple hello can turn into a great chat.",
  "🧡 Someone out there could be looking for you too.",
  "🔔 Fresh matches are popping up now.",
  "🪩 Your next conversation could be surprisingly good.",
  "🌻 A quick chat can make the whole day feel lighter.",
  "📣 People are active and ready to talk.",
  "🧭 A new chat might be exactly what you need.",
  "🌌 The next great conversation could start tonight.",
  "💌 Someone new may be ready to reply.",
  "🍀 Good chats happen when you jump back in.",
  "🎈 Make a new connection with one tap.",
  "⚡ Your next match could be one refresh away.",
  "👋 Say hi to someone new today.",
  "🌍 New users join every day, and one of them could be your next friend.",
  "🔥 The room is moving fast, don’t miss the moment.",
  "💫 A conversation can start instantly if you do.",
  "🫰 Your next favorite person might be online right now.",
  "🎵 A good chat can change the rhythm of your day.",
  "🧠 Curiosity pays off when you reconnect.",
  "🌹 A friendly message can go a long way.",
  "📱 One tap can bring you back into the action.",
  "🧋 New people are waiting to say hello.",
  "💎 Sometimes the best match appears when you least expect it.",
  "🕊️ A calm chat with someone new can feel refreshing.",
  "🎲 Give matchmaking another shot and see who appears.",
  "🛎️ There may already be a perfect chat waiting.",
  "🏁 The next round of conversations is ready.",
  "💬 Your next good conversation is closer than you think.",
  "🪄 Reconnect and let the bot do the matching.",
  "📬 Someone might be hoping you come back online.",
  "🌤️ A brighter chat could be one tap away.",
  "🎁 Returning now could uncover a great new friend.",
  "🥳 The next conversation may be the one you enjoy most.",
  "🧿 Fresh matches are the best kind of surprise.",
  "💞 One click can put you back in the conversation flow.",
  "🔎 Explore who’s active right now.",
  "🎤 Your voice could start a great chat today.",
  "🫧 The community keeps moving. Jump back in.",
  "🌱 New connections grow fast when you return.",
  "📈 Activity is up. Your next match might be waiting."
];
const defaultPreviewMessage = messages[0];

function pickMessage(userId: number, randomRotation: boolean): string {
  const history = sentCache.get(userId) || [];
  if (!randomRotation) {
    const selected = messages.find((message) => history.at(-1) !== message) || messages[0];
    const nextHistory = [...history, selected].slice(-14);
    sentCache.set(userId, nextHistory);
    return selected;
  }
  const recent = history.slice(-7);
  const candidates = messages.filter((message) => !recent.includes(message) && history.at(-1) !== message);
  const pool = candidates.length > 0 ? candidates : messages.filter((message) => history.at(-1) !== message);
  const selected = pool[Math.floor(Math.random() * pool.length)] || messages[0];
  const nextHistory = [...history, selected].slice(-14);
  sentCache.set(userId, nextHistory);
  return selected;
}

function buildDeepLink(username: string): string {
  return `https://t.me/${username}?start=reengage_chat`;
}

function parseSendTime(sendTime: string): { hours: number; minutes: number } | null {
  const match = sendTime.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  return { hours, minutes };
}

function getNextRunDelay(sendTime: string): number {
  const parsed = parseSendTime(sendTime) || { hours: 10, minutes: 0 };
  const now = new Date();
  const next = new Date(now);
  next.setHours(parsed.hours, parsed.minutes, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

async function bumpAnalytics(delta: Partial<{
  reminders_sent: number;
  reminders_delivered: number;
  reminders_clicked: number;
  reminders_failed: number;
  users_returned: number;
  next_started_from_reminder: number;
  successful_matches_from_reminder: number;
}> & { messageText?: string }): Promise<void> {
  await incrementReengagementAnalytics(delta);
}

export async function sendDailyReengagement(bot: ExtraTelegraf): Promise<void> {
  const settings = await getReengagementEngineSettings();
  if (!settings.enabled) return;

  const threshold = Date.now() - settings.inactivityThresholdHours * 60 * 60 * 1000;
  const inactiveUsers = await getInactiveUsers(settings.inactivityThresholdHours / 24);
  const targetIds = inactiveUsers
    .map((id) => Number.parseInt(id, 10))
    .filter((id) => Number.isFinite(id));

  for (const userId of targetIds) {
    const userRecord = await getUser(userId);
    if (!userRecord || userRecord.banned || userRecord.blockedUsers?.length) continue;
    if (userRecord.lastActive && userRecord.lastActive >= threshold) continue;
    if (userRecord.chatStartTime) continue;

    const message = pickMessage(userId, settings.randomMessageRotation);
    const text = `💌 ${message}\n\nTap below to connect to chat.`;
    const deepLink = buildDeepLink(bot.botInfo?.username || process.env.BOT_USERNAME || "allindiachatbot");
    const sent = await sendMessageWithRetry(bot, userId, text, settings.connectToChatButton ? Markup.inlineKeyboard([[Markup.button.url("💞 Connect to Chat", deepLink)]]) : undefined);
    if (sent) {
      await updateUser(userId, {
        lastReengagementSentAt: Date.now(),
        lastReengagementMessageId: message,
        reengagementHistory: [...(userRecord.reengagementHistory || []), { messageId: message, sentAt: Date.now() }].slice(-20)
      });
      await bumpAnalytics({ reminders_sent: 1, reminders_delivered: 1, messageText: message });
    } else {
      await bumpAnalytics({ reminders_failed: 1 });
    }
  }
}

export async function handleReengagementStart(ctx: Context, bot: ExtraTelegraf): Promise<boolean> {
  if (!ctx.from) return false;
  const user = await getUser(ctx.from.id);
  const lastMessage = user.lastReengagementMessageId || undefined;
  await bumpAnalytics({ reminders_clicked: 1, messageText: lastMessage });
  const userId = ctx.from.id;
  await updateUser(userId, { lastReengagementClickedAt: Date.now(), lastActive: Date.now() });
  await bumpAnalytics({ users_returned: 1 });
  await nextCommand.execute(ctx, bot);
  await bumpAnalytics({ next_started_from_reminder: 1 });
  return true;
}

export function startReengagementScheduler(bot: ExtraTelegraf): void {
  if (runtime.timer) return;
  const schedule = async () => {
    const settings = await getReengagementEngineSettings();
    const delay = getNextRunDelay(settings.sendTime);
    runtime.timer = setTimeout(async () => {
      try {
        await sendDailyReengagement(bot);
      } catch (error) {
        console.error("[REENGAGEMENT] scheduler error:", error);
      } finally {
        runtime.timer = undefined;
        void schedule();
      }
    }, delay);
  };
  void schedule();
}

export function stopReengagementScheduler(): void {
  if (runtime.timer) clearTimeout(runtime.timer);
  runtime.timer = undefined;
}

export function getReengagementMessagePreview(): { message: string; buttonLabel: string; deepLink: string } {
  const username = process.env.BOT_USERNAME || "allindiachatbot";
  return {
    message: defaultPreviewMessage,
    buttonLabel: "💞 Connect to Chat",
    deepLink: buildDeepLink(username)
  };
}

export function getReengagementMessagePerformance(analytics: Awaited<ReturnType<typeof getReengagementAnalytics>>) {
  const stats = analytics.messageStats || {};
  const rows = Object.entries(stats).map(([message, data]) => {
    const ctr = data.sent > 0 ? (data.clicked / data.sent) * 100 : 0;
    return { message, sent: data.sent, clicked: data.clicked, ctr };
  }).sort((a, b) => b.ctr - a.ctr);
  return {
    best: rows.slice(0, 5),
    worst: rows.slice(-5).reverse()
  };
}
