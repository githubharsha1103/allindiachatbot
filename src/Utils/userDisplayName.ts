import { ExtraTelegraf } from "..";
import { getUser } from "../storage/db";

/**
 * Get user's display name from database or Telegram.
 * Tries DB first, then falls back to Telegram username/firstName.
 * 
 * @param userId - The Telegram user ID
 * @param ctx - Bot context (for telegram API access)
 * @returns User's display name or fallback
 */
export async function getUserDisplayName(userId: number, ctx?: ExtraTelegraf): Promise<string> {
  // Try DB first
  try {
    const user = await getUser(userId).catch(() => null);
    if (user?.name && user.name !== "Unknown" && user.name !== "Not set" && user.name.trim() !== "") {
      return user.name;
    }
  } catch {
    // DB lookup failed, continue to Telegram
  }

  // Try Telegram
  if (ctx?.telegram) {
    try {
      const chat = await ctx.telegram.getChat(userId);
      const username = "username" in chat ? chat.username : undefined;
      const firstName = "first_name" in chat ? chat.first_name : undefined;
      return username || firstName || "no name";
    } catch {
      // Telegram lookup failed
    }
  }

  return "no name";
}

/**
 * Get user's display name without requiring context (only DB lookup)
 * @param userId - The Telegram user ID
 * @returns User's name from DB or "no name"
 */
export async function getUserDisplayNameFromDb(userId: number): Promise<string> {
  try {
    const user = await getUser(userId).catch(() => null);
    if (user?.name && user.name !== "Unknown" && user.name !== "Not set" && user.name.trim() !== "") {
      return user.name;
    }
  } catch {
    // Ignore errors
  }
  return "no name";
}