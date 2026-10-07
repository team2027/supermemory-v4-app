import Supermemory from "supermemory";
import { getUserMessages } from "../src/db/messages";

const SUPERMEMORY_API_KEY = process.env.SUPERMEMORY_API_KEY;
const SUPERMEMORY_CONTAINER_TAG_PREFIX =
  process.env.SUPERMEMORY_CONTAINER_TAG_PREFIX;
const SUPERMEMORY_ENTITY_CONTEXT = process.env.SUPERMEMORY_ENTITY_CONTEXT;
const BATCH_SIZE = 50;

if (!SUPERMEMORY_API_KEY) {
  throw new Error("SUPERMEMORY_API_KEY is required");
}
if (!SUPERMEMORY_CONTAINER_TAG_PREFIX) {
  throw new Error("SUPERMEMORY_CONTAINER_TAG_PREFIX is required");
}
if (!SUPERMEMORY_ENTITY_CONTEXT) {
  throw new Error("SUPERMEMORY_ENTITY_CONTEXT is required");
}

const args = process.argv.slice(2);
const force = args.includes("--force");
const userId = args.find((a) => /^\d+$/.test(a));
if (!userId) {
  throw new Error(
    "usage: npx tsx scripts/backfill-supermemory.ts <userId> [--force]",
  );
}

const client = new Supermemory({ apiKey: SUPERMEMORY_API_KEY });

async function backfill(userId: string) {
  const containerTag = `${SUPERMEMORY_CONTAINER_TAG_PREFIX}${userId}`;

  if (!force) {
    const existing = await client.documents.list({
      containerTags: [containerTag],
      limit: 1,
    });
    if (existing.memories?.length) {
      console.log(
        `user ${userId} already has memory documents. use --force to re-run.`,
      );
      return;
    }
  }

  console.log(`fetching messages for user ${userId}...`);

  const allMessages = await getUserMessages(Number(userId));

  console.log(`found ${allMessages.length} messages`);

  if (allMessages.length === 0) {
    console.log("no messages to backfill");
    return;
  }

  for (let i = 0; i < allMessages.length; i += BATCH_SIZE) {
    const batch = allMessages.slice(i, i + BATCH_SIZE);

    const conversationText = batch
      .map((msg) =>
        msg.role === "user"
          ? `User: ${msg.content}`
          : `Assistant: ${msg.content}`,
      )
      .join("\n\n");

    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(allMessages.length / BATCH_SIZE);

    console.log(
      `sending batch ${batchNum}/${totalBatches} (${batch.length} messages)...`,
    );

    try {
      const result = await client.add({
        content: conversationText,
        containerTag,
        entityContext: SUPERMEMORY_ENTITY_CONTEXT,
        metadata: { source: "chat" },
      });
      console.log(`  -> doc id: ${result.id}, status: ${result.status}`);
    } catch (error) {
      console.error(`  -> batch ${batchNum} failed:`, error);
    }
  }

  console.log(`backfill complete for user ${userId}`);
}

backfill(userId);
