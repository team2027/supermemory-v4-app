import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { generate, timeSearch, timeAdd } = vi.hoisted(() => ({
  generate: vi.fn(),
  timeSearch: vi.fn(),
  timeAdd: vi.fn(),
}));

vi.mock("./models", () => ({
  getChatModel: () => ({ generate }),
  getExtractionModel: () => ({
    generateObject: async () => ({ output: { events: [] } }),
  }),
}));
vi.mock("../db/messages", () => ({ getUserSourceMessages: vi.fn() }));
vi.mock("./supermemory", () => ({
  fetchMemoryMessages: vi.fn(),
  saveMemory: vi.fn(),
  getClient: () => ({ search: { documents: timeSearch }, add: timeAdd }),
}));

import { getUserSourceMessages } from "../db/messages";
import { generateReply } from "./assistant";
import { drainBackground } from "./background";
import { fetchMemoryMessages, saveMemory } from "./supermemory";
import { temporalDocument } from "./temporal-events";

const source = {
  id: 77,
  content: "I moved to a new flat yesterday",
  createdAt: new Date("2026-09-11T11:00:00Z"),
};
const now = Date.parse("2026-09-11T11:00:30Z");
const options = {
  systemPrompt: "You are a helpful assistant.",
  userId: 123,
  timezone: "Europe/London",
  useMemory: true,
  currentMessageTimes: [
    { messageId: source.id, createdAt: source.createdAt.getTime() },
  ],
};

beforeEach(() => {
  vi.stubEnv("TEMPORAL_MEMORY", "allowlist");
  vi.stubEnv("TEMPORAL_MEMORY_USER_IDS", "123");
  vi.spyOn(Date, "now").mockReturnValue(now);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(getUserSourceMessages).mockResolvedValue([source]);
  vi.mocked(fetchMemoryMessages).mockResolvedValue([
    { role: "user", content: "<memory-static>\nLikes tea\n</memory-static>" },
  ]);
  vi.mocked(saveMemory).mockResolvedValue(undefined);
  generate.mockResolvedValue("Congrats on the move!");
  timeAdd.mockResolvedValue({ id: "doc", status: "queued" });
  timeSearch.mockResolvedValue({
    results: [temporalDocument(123, source, "Europe/London", [])],
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("reply with long-term and temporal memory", () => {
  it("injects profile and dated memories before the turn and saves the exchange", async () => {
    const reply = await generateReply([], "when did I move?", options);
    expect(reply).toBe("Congrats on the move!");
    const { messages } = generate.mock.calls[0][0];
    expect(messages[0].content).toContain("Likes tea");
    expect(messages[1].content).toContain("<history_times>");
    expect(messages.at(-1)).toEqual({
      role: "user",
      content: "when did I move?",
    });
    expect(saveMemory).toHaveBeenCalledWith(
      123,
      "when did I move?",
      "Congrats on the move!",
    );
    await drainBackground();
    expect(timeAdd).toHaveBeenCalledWith(
      expect.objectContaining({ containerTag: "user-123-time-v1" }),
      expect.objectContaining({ maxRetries: 0 }),
    );
  });

  it("continues the reply when memory retrieval fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(fetchMemoryMessages).mockRejectedValue(new Error("down"));
    timeSearch.mockRejectedValue(new Error("down"));
    expect(await generateReply([], "hello", options)).toBe(
      "Congrats on the move!",
    );
    expect(generate.mock.calls[0][0].messages).toHaveLength(2);
  });

  it("skips memory reads when memory is off but still saves the exchange", async () => {
    await generateReply([], "hello", { ...options, useMemory: false });
    expect(fetchMemoryMessages).not.toHaveBeenCalled();
    expect(timeSearch).not.toHaveBeenCalled();
    expect(saveMemory).toHaveBeenCalledOnce();
  });
});
