import { beforeEach, describe, expect, it, vi } from "vitest";

const { list, update, remove } = vi.hoisted(() => ({
  list: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("./supermemory", () => ({
  getClient: () => ({ documents: { list, update, delete: remove } }),
}));

import {
  correctTemporalMessage,
  forgetTemporalMessage,
} from "./memory-maintenance";

const edited = {
  id: 125,
  content: "Actually it was two days ago",
  createdAt: new Date("2026-09-11T11:00:00Z"),
};

beforeEach(() => {
  update.mockResolvedValue({ id: "doc-1", status: "queued" });
  remove.mockResolvedValue(undefined);
});

describe("temporal memory maintenance", () => {
  it("finds the indexed document by source message and rewrites it", async () => {
    list.mockResolvedValue({
      memories: [{ id: "doc-1" }],
      pagination: { totalItems: 1 },
    });
    expect(await correctTemporalMessage(123, edited, "UTC")).toEqual({
      id: "doc-1",
      status: "queued",
    });
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({
        containerTags: ["user-123-time-v1"],
        limit: 1,
      }),
    );
    expect(update).toHaveBeenCalledWith(
      "doc-1",
      expect.objectContaining({
        content: edited.content,
        containerTag: "user-123-time-v1",
        customId: "chat-time-v1-u123-m125",
        metadata: expect.objectContaining({ source_message_id: 125 }),
      }),
    );
  });

  it("skips the update when the message was never indexed", async () => {
    list.mockResolvedValue({ memories: [], pagination: { totalItems: 0 } });
    expect(await correctTemporalMessage(123, edited, "UTC")).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it("deletes a forgotten message by its custom id", async () => {
    await forgetTemporalMessage(123, 125);
    expect(remove).toHaveBeenCalledWith("chat-time-v1-u123-m125");
  });
});
