/**
 * Centralized Inline Keyboard Definitions
 * All user-facing inline buttons are defined here for consistency
 */

import { Markup } from "telegraf";

// ==================== MAIN MENU KEYBOARDS ====================

/**
 * Main menu keyboard - shown after /start for returning users
 */
export const mainMenuKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🔍 Find Partner", "START_SEARCH")],
    [Markup.button.callback("⚙️ Settings", "OPEN_SETTINGS")],
    [Markup.button.callback("🎁 Referrals", "OPEN_REFERRAL")],
    [Markup.button.callback("❓ Help", "START_HELP")]
]);

/**
 * Compact main menu - for quick access
 */
export const compactMainMenuKeyboard = Markup.inlineKeyboard([
    [
        Markup.button.callback("🔍 Search", "START_SEARCH"),
        Markup.button.callback("⚙️ Settings", "OPEN_SETTINGS")
    ],
    [
        Markup.button.callback("🎁 Referrals", "OPEN_REFERRAL"),
        Markup.button.callback("❓ Help", "START_HELP")
    ]
]);

// ==================== CHAT SCREEN KEYBOARDS ====================

/**
 * Active chat keyboard - shown during conversation
 */
export const chatActiveKeyboard = Markup.inlineKeyboard([
    [
        Markup.button.callback("🚪 Leave", "END_CHAT"),
        Markup.button.callback("🚨 Report", "OPEN_REPORT")
    ]
]);

/**
 * Chat waiting keyboard - shown while waiting for partner
 */
export const chatWaitingKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🔄 Cancel", "CANCEL_SEARCH")]
]);

// ==================== POST-CHAT KEYBOARDS ====================

/**
 * Post-chat keyboard - shown after chat ends with rating options
 */
export const postChatKeyboard = Markup.inlineKeyboard([
    [
        Markup.button.callback("😊 Good", "RATE_GOOD"),
        Markup.button.callback("😐 Okay", "RATE_OKAY"),
        Markup.button.callback("😞 Bad", "RATE_BAD")
    ],
    [
        Markup.button.callback("🔍 Find New Partner", "START_SEARCH"),
        Markup.button.callback("🚨 Report User", "OPEN_REPORT")
    ]
]);

/**
 * Post-chat simple keyboard - after partner leaves
 */
export const postPartnerLeftKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🚨 Report User", "OPEN_REPORT")],
    [Markup.button.callback("🔙 Main Menu", "BACK_MAIN_MENU")]
]);

/**
 * After reporting - confirmation keyboard
 */
export const afterReportKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🔙 Main Menu", "BACK_MAIN_MENU")]
]);

// ==================== SETTINGS KEYBOARDS ====================

/**
 * Settings main keyboard
 */
export const settingsKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("👤 Gender", "SET_GENDER")],
    [Markup.button.callback("🎂 Age", "SET_AGE")],
    [Markup.button.callback("📍 State", "SET_STATE")],
    [Markup.button.callback("💕 Preference", "SET_PREFERENCE")],
    [Markup.button.callback("🎁 Referrals", "OPEN_REFERRAL")],
    [Markup.button.callback("🔙 Back", "BACK_MAIN_MENU")]
]);

/**
 * Gender selection keyboard
 */
export const genderSelectionKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("👨 Male", "GENDER_MALE")],
    [Markup.button.callback("👩 Female", "GENDER_FEMALE")],
    [Markup.button.callback("🔙 Back", "OPEN_SETTINGS")]
]);

/**
 * Age selection keyboard
 */
export const ageSelectionKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("13-17", "AGE_13_17")],
    [Markup.button.callback("18-25", "AGE_18_25")],
    [Markup.button.callback("26-40", "AGE_26_40")],
    [Markup.button.callback("40+", "AGE_40_PLUS")],
    [Markup.button.callback("🔙 Back", "OPEN_SETTINGS")]
]);

/**
 * State selection keyboard
 */
export const stateSelectionKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🟢 Telangana", "STATE_TELANGANA")],
    [Markup.button.callback("🔵 Andhra Pradesh", "STATE_AP")],
    [Markup.button.callback("🇮🇳 Other Indian State", "STATE_OTHER")],
    [Markup.button.callback("🔙 Back", "OPEN_SETTINGS")]
]);

/**
 * Preference selection keyboard
 */
export const preferenceSelectionKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("👨 Male", "PREF_MALE")],
    [Markup.button.callback("👩 Female", "PREF_FEMALE")],
    [Markup.button.callback("🔙 Back", "OPEN_SETTINGS")]
]);

// ==================== REPORT KEYBOARDS ====================

/**
 * Report reasons keyboard
 */
export const reportReasonsKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🎭 Impersonating", "REPORT_IMPERSONATING")],
    [Markup.button.callback("🔞 Sexual content", "REPORT_SEXUAL")],
    [Markup.button.callback("💰 Fraud", "REPORT_FRAUD")],
    [Markup.button.callback("😠 Insulting", "REPORT_INSULTING")],
    [Markup.button.callback("🔙 Cancel", "REPORT_CANCEL")]
]);

/**
 * Report confirmation keyboard
 */
export const reportConfirmKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("✅ Confirm Report", "REPORT_CONFIRM")],
    [Markup.button.callback("🔙 Cancel", "REPORT_CANCEL")]
]);

// ==================== SETUP KEYBOARDS ====================

/**
 * Welcome keyboard - for new users
 */
export const welcomeKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🌟 Get Started", "SETUP_GENDER_MALE")]
]);

/**
 * Setup gender keyboard
 */
export const setupGenderKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("👨 Male", "SETUP_GENDER_MALE")],
    [Markup.button.callback("👩 Female", "SETUP_GENDER_FEMALE")]
]);

/**
 * Setup age keyboard
 */
export const setupAgeKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("13-17", "SETUP_AGE_13_17")],
    [Markup.button.callback("18-25", "SETUP_AGE_18_25")],
    [Markup.button.callback("26-40", "SETUP_AGE_26_40")],
    [Markup.button.callback("40+", "SETUP_AGE_40_PLUS")],
    [Markup.button.callback("📝 Type Age", "SETUP_AGE_MANUAL")]
]);

/**
 * Setup state keyboard
 */
export const setupStateKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🟢 Telangana", "SETUP_STATE_TELANGANA")],
    [Markup.button.callback("🔵 Andhra Pradesh", "SETUP_STATE_AP")],
    [Markup.button.callback("🇮🇳 Other Indian State", "SETUP_STATE_OTHER")],
    [Markup.button.callback("🌍 Outside India", "SETUP_COUNTRY_OTHER")]
]);

// ==================== GROUP VERIFICATION ====================

/**
 * Group join keyboard
 */
export const groupJoinKeyboard = Markup.inlineKeyboard([
    [Markup.button.url("📢 Join Our Group", process.env.GROUP_INVITE_LINK || "https://t.me/teluguanomychat")],
    [Markup.button.callback("✅ I've Joined", "VERIFY_GROUP_JOIN")]
]);

// ==================== UTILITY FUNCTIONS ====================

/**
 * Safe answer callback query helper
 */
export async function safeAnswerCbQuery(ctx: any, text?: string) {
    try {
        if (ctx.callbackQuery?.id) {
            await ctx.answerCbQuery(text);
        }
    } catch {
        // Query too old or invalid, ignore
    }
}

/**
 * Safe editMessageText helper - handles errors with fallback to reply
 */
export async function safeEditMessageText(ctx: any, text: string, extra?: any) {
    try {
        await ctx.editMessageText(text, extra);
    } catch (error: any) {
        // Check for "message not modified" - this is not an error
        if (error.description && error.description.includes("message is not modified")) {
            return;
        }
        // For all other errors, try to reply instead
        console.log("[safeEditMessageText] Falling back to reply:", error.description || error.message);
        try {
            await ctx.reply(text, extra);
        } catch (replyError: any) {
            console.error("[safeEditMessageText] Failed to reply:", replyError.message);
        }
    }
}

/**
 * Safe editMessageReplyMarkup - updates only keyboard
 */
export async function safeEditKeyboard(ctx: any, keyboard: any) {
    try {
        await ctx.editMessageReplyMarkup(keyboard);
    } catch (error: any) {
        // Ignore errors - keyboard might be too old
        if (error.description && error.description.includes("message is not modified")) {
            return;
        }
        console.log("[safeEditKeyboard] Error:", error.description || error.message);
    }
}
