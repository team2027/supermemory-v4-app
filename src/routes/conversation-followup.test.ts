import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../env", () => ({
  env: { NODE_ENV: "test", SUPERMEMORY_API_KEY: "test-key" },
}));

import { saveFollowUp } from "./conversation-followup";

const fetchMock = vi.fn();
const lastUserMsg = {
  id: 9,
  userId: 42,
  role: "user" as const,
  content: "see you tomorrow",
  createdAt: new Date("2026-01-10T09:00:00Z"),
};

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ id: "doc-9", status: "queued" })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("follow-up memory", () => {
  it("stores the follow-up with entity context and a metadata filter", async () => {
    expect(await saveFollowUp(42, lastUserMsg, "how did it go?")).toEqual({
      id: "doc-9",
      status: "queued",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.supermemory.ai/v3/documents");
    expect(init.headers.authorization).toBe("Bearer test-key");
    expect(JSON.parse(init.body)).toEqual({
      content: "User: see you tomorrow\n\nAssistant: how did it go?",
      containerTag: "user-42",
      customId: "followup-u42-m9",
      entityContext: "Test entity context",
      metadata: { source: "followup" },
      filterByMetadata: { source: "chat" },
    });
  });

  it("fails loudly on an API error", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 401 }));
    await expect(saveFollowUp(42, lastUserMsg, "hi")).rejects.toThrow(
      "supermemory POST /v3/documents failed: 401 nope",
    );
  });

  it("refuses to build a container tag without the configured prefix", async () => {
    vi.stubEnv("SUPERMEMORY_CONTAINER_TAG_PREFIX", "");
    await expect(saveFollowUp(42, lastUserMsg, "hi")).rejects.toThrow(
      "SUPERMEMORY_CONTAINER_TAG_PREFIX is required",
    );
  });
});
