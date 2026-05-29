import { Context } from "telegraf";

export function isPrivateChat(ctx: Context): boolean {
  if (ctx.chat?.type) {
    return ctx.chat.type === "private";
  }

  const callbackQuery = ctx.callbackQuery as { message?: { chat?: { type?: string } } } | undefined;
  return callbackQuery?.message?.chat?.type === "private";
}

export async function blockNonPrivateChat(ctx: Context): Promise<boolean> {
  if (isPrivateChat(ctx)) {
    return false;
  }

  return true;
}
