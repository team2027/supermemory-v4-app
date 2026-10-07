import { beforeEach, describe, expect, it, vi } from "vitest";

const { list, deleteBulk, add, getUserMessages } = vi.hoisted(() => ({
  list: vi.fn(),
  deleteBulk: vi.fn(),
  add: vi.fn(),
  getUserMessages: vi.fn(),
}));
vi.mock("../db/messages", () => ({
  getUserMessages,
  countUserMessages: vi.fn(),
}));
vi.mock("./supermemory", () => ({
  getClient: () => ({ documents: { list, deleteBulk }, add }),
}));

import { backfillUserMemory } from "./supermemory-backfill";

const message = (id: number, role: "user" | "assistant") => ({
  id,
  userId: 123,
  role,
  content: `message ${id}`,
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, id)),
});

beforeEach(() => {
  deleteBulk.mockResolvedValue({ deletedCount: 0 });
  add.mockResolvedValue({ id: "doc", status: "queued" });
  getUserMessages.mockResolvedValue([]);
});

describe("memory rebuild and temporal sources", () => {
  it.each([
    0, 1,
  ])("clears both memory containers on a forced rebuild, even with %s ordinary documents", async (totalItems) => {
    list.mockResolvedValue({ pagination: { totalItems } });
    await backfillUserMemory(123, { force: true });
    expect(deleteBulk).toHaveBeenCalledTimes(2);
    expect(deleteBulk).toHaveBeenCalledWith({ containerTags: ["user-123"] });
    expect(deleteBulk).toHaveBeenCalledWith({
      containerTags: ["user-123-time-v1"],
    });
  });

  it("does not delete either container when a normal backfill is skipped", async () => {
    list.mockResolvedValue({ pagination: { totalItems: 1 } });
    expect((await backfillUserMemory(123)).status).toBe("skipped");
    expect(deleteBulk).not.toHaveBeenCalled();
    expect(getUserMessages).not.toHaveBeenCalled();
  });

  it("sends history in batches of 50 into the user's container", async () => {
    list.mockResolvedValue({ pagination: { totalItems: 0 } });
    getUserMessages.mockResolvedValue(
      Array.from({ length: 51 }, (_, i) =>
        message(i + 1, i % 2 ? "assistant" : "user"),
      ),
    );
    const result = await backfillUserMemory(123);
    expect(result).toEqual({
      status: "completed",
      messagesProcessed: 51,
      batches: 2,
      failedBatches: 0,
    });
    expect(add).toHaveBeenCalledTimes(2);
    expect(add).toHaveBeenCalledWith({
      content: expect.stringContaining("User: message 1\n\nAssistant: message 2"),
      containerTag: "user-123",
      entityContext: "Test entity context",
      metadata: { source: "chat" },
    });
  });

  it("counts failed batches without aborting the rest", async () => {
    list.mockResolvedValue({ pagination: { totalItems: 0 } });
    getUserMessages.mockResolvedValue([message(1, "user")]);
    add.mockRejectedValue(new Error("rate limited"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await backfillUserMemory(123)).failedBatches).toBe(1);
  });
});
