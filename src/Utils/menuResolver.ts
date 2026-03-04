/**
 * Dynamic Menu Resolver
 * Returns the appropriate keyboard based on user state
 */

import {
    mainMenuKeyboard,
    chatActiveKeyboard,
    chatWaitingKeyboard,
    postChatKeyboard,
    postPartnerLeftKeyboard
} from "../keyboards/mainMenu";

/**
 * Resolves the appropriate keyboard based on user's current state
 * 
 * @param userId - The user's Telegram ID
 * @param bot - The bot instance with runningChats and waitingQueue
 * @returns The appropriate keyboard for the user's current state
 */
export function resolveMenu(userId: number, bot: any) {
    // Check if user is in an active chat
    const isInChat = bot.runningChats.includes(userId);
    
    // Check if user is searching for a partner
    const isSearching = bot.waitingQueue.some((w: any) => w.id === userId);
    
    // Return the appropriate keyboard based on state
    if (isInChat) {
        return chatActiveKeyboard;
    }
    
    if (isSearching) {
        return chatWaitingKeyboard;
    }
    
    // Default to main menu for idle users
    return mainMenuKeyboard;
}

/**
 * Checks if user is in an active chat
 */
export function isUserInChat(userId: number, bot: any): boolean {
    return bot.runningChats.includes(userId);
}

/**
 * Checks if user is searching for a partner
 */
export function isUserSearching(userId: number, bot: any): boolean {
    return bot.waitingQueue.some((w: any) => w.id === userId);
}

/**
 * Gets user's current chat partner ID
 */
export function getUserPartner(userId: number, bot: any): number | null {
    if (!bot.runningChats.includes(userId)) {
        return null;
    }
    
    const index = bot.runningChats.indexOf(userId);
    
    // Partner is either at index+1 (if userId is at even index) or index-1 (if at odd index)
    if (index % 2 === 0) {
        return bot.runningChats[index + 1] || null;
    } else {
        return bot.runningChats[index - 1] || null;
    }
}
