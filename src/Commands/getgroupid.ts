import { Context } from "telegraf";
import { Command } from "../Utils/commandHandler";
import { getRuntimeGroupSettings } from "../Utils/groupRuntime";

interface ChatWithTitle {
  title?: string;
}

export default {
  name: "getgroupid",
  description: "Get the group chat ID from the invite link",
  adminOnly: true,
  execute: async (ctx: Context) => {
    if (!ctx.from) return;

    try {
      const settings = await getRuntimeGroupSettings();
      const chat = await ctx.telegram.getChat(settings.groupId);
      const chatId = chat.id;
      const chatType = chat.type;
      const chatTitle = (chat as ChatWithTitle).title || "N/A";

      await ctx.reply(
        "📋 *Group Information*\n\n" +
          "🆔 *Chat ID:* `" + chatId + "`\n" +
          "📝 *Title:* " + chatTitle + "\n" +
          "👥 *Type:* " + chatType + "\n\n" +
          "💡 Use this Chat ID in Group Management if you need to update the runtime configuration.",
        { parse_mode: "Markdown" }
      );
    } catch (error: unknown) {
      const errorLike = error as { description?: string; message?: string };
      console.error("[GetGroupId] - Error:", errorLike.message || error);
      await ctx.reply(
        "❌ *Error getting group info*\n\n" +
          "Make sure the bot is added to the group and the configured group ID is valid.\n\n" +
          "Error: " + (errorLike.description || errorLike.message || "Unknown error"),
        { parse_mode: "Markdown" }
      );
    }
  }
} as Command;
