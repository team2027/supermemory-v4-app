import { beforeEach, describe, expect, it, vi } from "vitest";

const { profile, add, construct } = vi.hoisted(() => ({
  profile: vi.fn(),
  add: vi.fn(),
  construct: vi.fn(),
}));

vi.mock("supermemory", () => ({
  default: class {
    profile = profile;
    add = add;
    constructor(options: unknown) {
      construct(options);
    }
  },
}));
vi.mock("../env", () => ({
  env: { NODE_ENV: "test", SUPERMEMORY_API_KEY: "test-key" },
}));

import { fetchMemoryMessages, saveMemory } from "./supermemory";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  add.mockResolvedValue({ id: "doc", status: "queued" });
});

describe("long-term memory", () => {
  it("splits the profile into cached static and per-turn dynamic context", async () => {
    profile.mockResolvedValue({
      profile: { static: ["Prefers metric units"], dynamic: ["Planning a trip"] },
      searchResults: {
        results: [{ memory: "Booked a flight" }, { chunk: "not a memory" }],
        total: 2,
        timing: 12,
      },
    });
    const messages = await fetchMemoryMessages(42, "where am I going?");
    expect(profile).toHaveBeenCalledWith({
      containerTag: "user-42",
      q: "where am I going?",
    });
    expect(messages).toEqual([
      {
        role: "user",
        content: "<memory-static>\nPrefers metric units\n</memory-static>",
        cacheControl: { type: "ephemeral" },
      },
      {
        role: "user",
        content:
          "<memory-dynamic>\nPlanning a trip\nBooked a flight\n</memory-dynamic>",
      },
    ]);
  });

  it("creates the client once with the configured api key", async () => {
    profile.mockResolvedValue({ profile: { static: [], dynamic: [] } });
    vi.resetModules();
    const fresh = await import("./supermemory");
    fresh.getClient();
    fresh.getClient();
    expect(construct).toHaveBeenCalledTimes(1);
    expect(construct).toHaveBeenCalledWith({ apiKey: "test-key" });
  });

  it("returns nothing when the profile is empty and search is absent", async () => {
    profile.mockResolvedValue({ profile: { static: [], dynamic: [] } });
    expect(await fetchMemoryMessages(42, "hi")).toEqual([]);
  });

  it("stores each exchange in the user's container", async () => {
    await saveMemory(42, "hello", "hi there");
    expect(add).toHaveBeenCalledWith({
      content: "User: hello\n\nAssistant: hi there",
      containerTag: "user-42",
      entityContext: "Test entity context",
      metadata: { source: "chat" },
    });
  });
});
