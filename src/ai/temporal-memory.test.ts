import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { searchDocuments, addDocument, extract, deferred } = vi.hoisted(() => ({
  searchDocuments: vi.fn(),
  addDocument: vi.fn(),
  extract: vi.fn(),
  deferred: vi.fn(),
}));

vi.mock("./background", () => ({ runInBackground: deferred }));
vi.mock("./models", () => ({
  getExtractionModel: () => ({ generateObject: extract }),
}));
vi.mock("../db/messages", () => ({ getUserSourceMessages: vi.fn() }));
vi.mock("./supermemory", () => ({
  getClient: vi.fn(() => ({
    search: { documents: searchDocuments },
    add: addDocument,
  })),
}));

import { getUserSourceMessages } from "../db/messages";
import { getClient } from "./supermemory";
import { temporalDocument, type TimeSource } from "./temporal-events";
import {
  fetchTemporalMemories,
  indexTemporalMessages,
  queueTemporalMessages,
  TEMPORAL_SEARCH_BUDGET_MS,
} from "./temporal-memory";

const source: TimeSource = {
  id: 125,
  content: "Yesterday I went to the dentist",
  createdAt: new Date("2026-09-11T11:00:00Z"),
};
const event = {
  sourceId: 125,
  quote: source.content,
  timeExpression: "Yesterday",
  kind: "reported" as const,
};
const current = [{ messageId: 125, createdAt: source.createdAt.getTime() }];
const now = Date.parse("2026-09-11T11:00:30Z");

beforeEach(() => {
  vi.stubEnv("TEMPORAL_MEMORY", "allowlist");
  vi.stubEnv("TEMPORAL_MEMORY_USER_IDS", "123");
  vi.spyOn(Date, "now").mockReturnValue(now);
  vi.mocked(getUserSourceMessages).mockResolvedValue([source]);
  extract.mockResolvedValue({ output: { events: [event] } });
  addDocument.mockResolvedValue({ id: "document", status: "queued" });
  searchDocuments.mockResolvedValue({
    results: [temporalDocument(123, source, "Europe/London", [event])],
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("temporal memory I/O", () => {
  it("does no I/O or extra model calls when off or not allowlisted", async () => {
    vi.stubEnv("TEMPORAL_MEMORY", "off");
    expect(await fetchTemporalMemories(123, "dentist", now)).toEqual([]);
    await indexTemporalMessages(123, current, "Europe/London");
    queueTemporalMessages(123, current, "Europe/London");
    vi.stubEnv("TEMPORAL_MEMORY", "allowlist");
    expect(await fetchTemporalMemories(999, "dentist", now)).toEqual([]);
    await indexTemporalMessages(999, current, "Europe/London");
    expect(getClient).not.toHaveBeenCalled();
    expect(getUserSourceMessages).not.toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();
    expect(deferred).not.toHaveBeenCalled();
  });

  it("looks up retrieved ids within the same user's original messages", async () => {
    const result = await fetchTemporalMemories(
      123,
      "When was the dentist?",
      now,
    );
    expect(searchDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        containerTags: ["user-123-time-v1"],
        limit: 4,
        filters: { AND: [{ key: "user_id", value: "123" }] },
      }),
      expect.objectContaining({ maxRetries: 0 }),
    );
    expect(getUserSourceMessages).toHaveBeenCalledWith(123, [125]);
    expect(result[0].content).toContain("date_if_message_timezone=2026-09-10");
    expect(extract).not.toHaveBeenCalled();
  });

  it("rejects foreign or undated legacy results before the database lookup", async () => {
    searchDocuments.mockResolvedValue({
      results: [
        temporalDocument(999, source, "Europe/London", [event]),
        {
          metadata: null,
          createdAt: new Date(now).toISOString(),
          memory: "Yesterday was the dentist",
        },
      ],
    });
    expect(await fetchTemporalMemories(123, "dentist", now)).toEqual([]);
    expect(getUserSourceMessages).not.toHaveBeenCalled();
  });

  it.each([
    "search",
    "database",
  ])("continues without temporal context after a %s failure", async (stage) => {
    if (stage === "search")
      searchDocuments.mockRejectedValue(new Error("unavailable"));
    else
      vi.mocked(getUserSourceMessages).mockRejectedValue(
        new Error("unavailable"),
      );
    expect(await fetchTemporalMemories(123, "dentist", now)).toEqual([]);
  });

  it("bounds waiting even when the search or database ignores cancellation", async () => {
    vi.useFakeTimers();
    vi.mocked(getUserSourceMessages).mockImplementation(
      () => new Promise(() => {}),
    );
    const pending = fetchTemporalMemories(123, "dentist", now);
    await vi.advanceTimersByTimeAsync(TEMPORAL_SEARCH_BUDGET_MS);
    expect(await pending).toEqual([]);
    expect(searchDocuments.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it("does not start retrieval for an already superseded generation", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(
      await fetchTemporalMemories(123, "dentist", now, controller.signal),
    ).toEqual([]);
    expect(searchDocuments).not.toHaveBeenCalled();
  });

  it("extracts quotes in the background and leaves ordinary memory untouched", async () => {
    await indexTemporalMessages(123, current, "Europe/London");
    expect(extract).toHaveBeenCalledOnce();
    expect(extract.mock.calls[0][0]).toEqual(
      expect.objectContaining({ timeout: 6000 }),
    );
    expect(addDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        content: source.content,
        containerTag: "user-123-time-v1",
        metadata: expect.objectContaining({
          source_message_id: 125,
          timezone_at_capture: "Europe/London",
          events: JSON.stringify([event]),
        }),
      }),
      expect.objectContaining({ maxRetries: 0 }),
    );
    expect(searchDocuments).not.toHaveBeenCalled();
  });

  it("keeps only the source date when the extractor fails", async () => {
    extract.mockRejectedValue(new Error("model down"));
    await expect(
      indexTemporalMessages(123, current, "Europe/London"),
    ).resolves.toBeUndefined();
    expect(addDocument.mock.calls[0][0].metadata.events).toBe("[]");
    expect(addDocument.mock.calls[0][0].metadata.source_sent_at_ms).toBe(
      source.createdAt.getTime(),
    );
    expect(extract).toHaveBeenCalledOnce();
  });

  it("does not spend an extra model call on a message without a supported date expression", async () => {
    vi.mocked(getUserSourceMessages).mockResolvedValue([
      { ...source, content: "I just want to talk for a bit" },
    ]);
    await indexTemporalMessages(123, current, "Europe/London");
    expect(extract).not.toHaveBeenCalled();
    expect(addDocument).toHaveBeenCalledOnce();
    expect(addDocument.mock.calls[0][0].metadata.events).toBe("[]");
  });

  it("does not accept an extractor's invented quotation as evidence", async () => {
    extract.mockResolvedValue({
      output: { events: [{ ...event, quote: "Yesterday was the interview" }] },
    });
    await indexTemporalMessages(123, current, "Europe/London");
    expect(addDocument.mock.calls[0][0].metadata.events).toBe("[]");
  });

  it("does not assign today's timezone to an old message", async () => {
    vi.spyOn(Date, "now").mockReturnValue(now + 86_400_000);
    await indexTemporalMessages(123, current, "Europe/London");
    expect(addDocument.mock.calls[0][0].metadata.timezone_at_capture).toBe(
      "unknown",
    );
  });

  it("does not index an inconsistent message id/timestamp or invent ids", async () => {
    await indexTemporalMessages(
      123,
      [{ ...current[0], createdAt: now }],
      "Europe/London",
    );
    await indexTemporalMessages(123, [{ createdAt: now }], "Europe/London");
    expect(extract).not.toHaveBeenCalled();
    expect(addDocument).not.toHaveBeenCalled();
  });

  it("isolates write failures from the user reply", async () => {
    addDocument.mockRejectedValue(new Error("storage unavailable"));
    await expect(
      indexTemporalMessages(123, current, "Europe/London"),
    ).resolves.toBeUndefined();
    expect(addDocument).toHaveBeenCalledOnce();
  });

  it("registers background work without waiting for it", async () => {
    vi.mocked(getUserSourceMessages).mockImplementation(
      () => new Promise(() => {}),
    );
    vi.useFakeTimers();
    expect(
      queueTemporalMessages(123, current, "Europe/London"),
    ).toBeUndefined();
    expect(deferred).toHaveBeenCalledWith(expect.any(Promise));
    await vi.advanceTimersByTimeAsync(12_000);
    await deferred.mock.calls[0][0];
  });
});
