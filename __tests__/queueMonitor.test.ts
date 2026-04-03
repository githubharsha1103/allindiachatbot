// jest globals for TS compilation
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const jest: any;
declare const describe: any;
declare const it: any;
declare const beforeEach: any;
declare const expect: any;
/// <reference types="jest" />

import { connectAdminToUser, safeRemoveFromQueue } from "../src/admin/queueMonitor";
import * as db from "../src/storage/db";

function createBot() {
  return {
    waitingQueue: [{ id: 100, preference: "any", gender: "male", isPremium: false }],
    premiumQueue: [],
    queueSet: new Set([100]),
    premiumQueueSet: new Set<number>(),
    runningChats: new Map<number, number>(),
    messageCountMap: new Map<number, number>(),
    messageMap: new Map<number, Record<number, number>>(),
    rateLimitMap: new Map<number, number>(),
    spectatingChats: new Map<string, Set<number>>(),
    removeSpectator: jest.fn(),
    telegram: {
      sendMessage: jest.fn().mockResolvedValue(undefined)
    },
    syncQueueState() {
      this.queueSet = new Set(this.waitingQueue.map((user: { id: number }) => user.id));
      this.premiumQueueSet = new Set(this.premiumQueue.map((user: { id: number }) => user.id));
    },
    async removeFromQueue(userId: number) {
      const index = this.waitingQueue.findIndex((user: { id: number }) => user.id === userId);
      if (index === -1) return false;
      this.waitingQueue.splice(index, 1);
      this.queueSet.delete(userId);
      return true;
    },
    async removeFromPremiumQueue(userId: number) {
      const index = this.premiumQueue.findIndex((user: { id: number }) => user.id === userId);
      if (index === -1) return false;
      this.premiumQueue.splice(index, 1);
      this.premiumQueueSet.delete(userId);
      return true;
    }
  } as any;
}

describe("queueMonitor", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it("removes a queued user from in-memory queue structures", async () => {
    const bot = createBot();

    const result = await safeRemoveFromQueue(bot, 100, 1);

    expect(result.success).toBe(true);
    expect(bot.waitingQueue).toHaveLength(0);
    expect(bot.queueSet.has(100)).toBe(false);
  });

  it("connects an admin to a queued user even if queueStatus is stale", async () => {
    const bot = createBot();
    const ctx: any = {};
    const immediateTimeout = ((callback: TimerHandler) => {
      if (typeof callback === "function") {
        callback();
      }
      return 0 as unknown as NodeJS.Timeout;
    }) as unknown as typeof setTimeout;
    const setTimeoutSpy = jest.spyOn(global, "setTimeout").mockImplementation(immediateTimeout);

    jest.spyOn(db, "getUser")
      .mockResolvedValueOnce({ telegramId: 100, queueStatus: "connecting" } as never)
      .mockResolvedValueOnce({ telegramId: 100, queueStatus: "connecting" } as never);
    jest.spyOn(db, "updateUser").mockResolvedValue(true as never);
    jest.spyOn(db, "tryLockUserForConnection").mockResolvedValue(true);
    jest.spyOn(db, "markUserAsConnected").mockResolvedValue(undefined);

    const result = await connectAdminToUser(ctx, bot, 1, 100);

    expect(result.success).toBe(true);
    expect(bot.runningChats.get(1)).toBe(100);
    expect(bot.runningChats.get(100)).toBe(1);
    expect(db.updateUser).toHaveBeenCalledWith(100, expect.objectContaining({ queueStatus: "waiting" }));
    setTimeoutSpy.mockRestore();
  });
});
