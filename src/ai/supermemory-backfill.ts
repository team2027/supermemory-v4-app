import { countUserMessages, getUserMessages } from "../db/messages";
import { getClient } from "./supermemory";
import {
  entityContext,
  temporalContainerTag,
  userContainerTag,
} from "./supermemory-config";

const BATCH_SIZE = 50;
const CONCURRENCY = 10;

type BackfillStatus = {
  documentCount: number;
  messageCount: number;
};

type BackfillResult = {
  status: "skipped" | "completed";
  messagesProcessed: number;
  batches: number;
  failedBatches: number;
};

export async function getBackfillStatus(
  userId: number,
): Promise<BackfillStatus> {
  const client = getClient();
  const containerTag = userContainerTag(userId);

  const [list, count] = await Promise.all([
    client.documents.list({ containerTags: [containerTag], limit: 1 }),
    countUserMessages(userId),
  ]);

  return {
    documentCount: list.pagination.totalItems ?? 0,
    messageCount: count,
  };
}

async function clearUserMemory(userId: number): Promise<void> {
  const client = getClient();
  // containerTags param is marked deprecated in the SDK but is still the only
  // way to bulk-delete by container without listing every document id first.
  // If supermemory removes it, swap to a paginated list+delete loop.
  await Promise.all(
    [userContainerTag(userId), temporalContainerTag(userId)].map((containerTag) =>
      client.documents.deleteBulk({ containerTags: [containerTag] }),
    ),
  );
}

export async function backfillUserMemory(
  userId: number,
  { force = false }: { force?: boolean } = {},
): Promise<BackfillResult> {
  const client = getClient();
  const containerTag = userContainerTag(userId);
  const context = entityContext();

  const existing = await client.documents.list({
    containerTags: [containerTag],
    limit: 1,
  });
  const hasDocuments = (existing.pagination.totalItems ?? 0) > 0;

  if (hasDocuments && !force) {
    return {
      status: "skipped",
      messagesProcessed: 0,
      batches: 0,
      failedBatches: 0,
    };
  }

  if (force) {
    await clearUserMemory(userId);
  }

  const allMessages = await getUserMessages(userId);

  if (allMessages.length === 0) {
    return {
      status: "completed",
      messagesProcessed: 0,
      batches: 0,
      failedBatches: 0,
    };
  }

  const chunks: string[] = [];
  for (let i = 0; i < allMessages.length; i += BATCH_SIZE) {
    const batch = allMessages.slice(i, i + BATCH_SIZE);
    chunks.push(
      batch
        .map((msg) =>
          msg.role === "user"
            ? `User: ${msg.content}`
            : `Assistant: ${msg.content}`,
        )
        .join("\n\n"),
    );
  }

  let nextIndex = 0;
  let failedBatches = 0;
  const workers = Array.from(
    { length: Math.min(CONCURRENCY, chunks.length) },
    async () => {
      while (true) {
        const idx = nextIndex++;
        if (idx >= chunks.length) return;
        try {
          await client.add({
            content: chunks[idx],
            containerTag,
            entityContext: context,
            metadata: { source: "chat" },
          });
        } catch (error) {
          failedBatches += 1;
          console.error(
            `[supermemory-backfill] batch ${idx} failed for user ${userId}:`,
            error,
          );
        }
      }
    },
  );
  await Promise.all(workers);

  return {
    status: "completed",
    messagesProcessed: allMessages.length,
    batches: chunks.length,
    failedBatches,
  };
}
