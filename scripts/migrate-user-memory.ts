import Supermemory from "supermemory";
import { getActiveUsers, getUserMessages } from "../src/db/messages";

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

const client = new Supermemory({ apiKey: SUPERMEMORY_API_KEY });

async function isBackfilled(containerTag: string): Promise<boolean> {
  const existing = await client.documents.list({
    containerTags: [containerTag],
    limit: 1,
  });
  return (existing.memories?.length ?? 0) > 0;
}

async function backfillUser(userId: string): Promise<boolean> {
  const containerTag = `${SUPERMEMORY_CONTAINER_TAG_PREFIX}${userId}`;

  if (await isBackfilled(containerTag)) {
    console.log(`  [skip] already backfilled`);
    return true;
  }

  const allMessages = await getUserMessages(Number(userId));

  if (allMessages.length === 0) {
    console.log(`  [skip] no messages`);
    return true;
  }

  const totalBatches = Math.ceil(allMessages.length / BATCH_SIZE);

  for (let i = 0; i < allMessages.length; i += BATCH_SIZE) {
    const batch = allMessages.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    const conversationText = batch
      .map((msg) =>
        msg.role === "user"
          ? `User: ${msg.content}`
          : `Assistant: ${msg.content}`,
      )
      .join("\n\n");

    try {
      await client.add({
        content: conversationText,
        containerTag,
        entityContext: SUPERMEMORY_ENTITY_CONTEXT,
        metadata: { source: "chat" },
      });
      process.stdout.write(`  batch ${batchNum}/${totalBatches}\r`);
    } catch (error: any) {
      if (error?.status === 429) {
        console.log(`\n  [error] token limit reached. stopping.`);
        return false;
      }
      console.error(`\n  [error] batch ${batchNum} failed:`, error?.message);
    }
  }

  console.log(
    `  [done] ${allMessages.length} messages in ${totalBatches} batches`,
  );
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const singleUser = args.find((a) => /^\d+$/.test(a));

  if (singleUser) {
    console.log(`\nmigrating user ${singleUser}...`);
    await backfillUser(singleUser);
    return;
  }

  const users = await getActiveUsers();
  console.log(`found ${users.length} active users\n`);

  let backfilled = 0;
  let skipped = 0;
  let failed = 0;

  for (const user of users) {
    const userId = user.user_id.toString();
    const msgCount = Number(user.msg_count);

    console.log(`[${userId}] ${msgCount} messages`);

    if (dryRun) {
      const containerTag = `${SUPERMEMORY_CONTAINER_TAG_PREFIX}${userId}`;
      const done = await isBackfilled(containerTag);
      console.log(`  ${done ? "[already done]" : "[needs backfill]"}`);
      if (done) skipped++;
      else backfilled++;
      continue;
    }

    const success = await backfillUser(userId);
    if (success) {
      backfilled++;
    } else {
      failed++;
      console.log(
        `\nstopping migration due to error. ${backfilled} done, ${users.length - backfilled - skipped} remaining.`,
      );
      break;
    }
  }

  console.log(`\n--- summary ---`);
  console.log(`backfilled: ${backfilled}`);
  console.log(`skipped: ${skipped}`);
  console.log(`failed: ${failed}`);
  console.log(`\nnext step: add backfilled users to MEMORY_USER_IDS`);
}

main();
