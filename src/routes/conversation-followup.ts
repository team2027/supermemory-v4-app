import { getActiveUsers, getUserHistory } from "../db/messages";
import type { StoredMessage } from "../db/messages";
import { getChatModel } from "../ai/models";
import { fetchMemoryMessages } from "../ai/supermemory";
import { entityContext, userContainerTag } from "../ai/supermemory-config";
import { addDocument } from "../ai/supermemory-http";
import { isMemoryEnabled } from "../feature-flags";
import { isAuthorized, json } from "./auth";

const FOLLOWUP_AFTER_MS = 24 * 3_600_000;
const FOLLOWUP_SYSTEM_PROMPT =
  "You are a helpful assistant checking in on an open conversation. Reply with one short follow-up message, or an empty reply if no follow-up is needed. Never repeat your last message.";

export function needsFollowUp(history: StoredMessage[], now = Date.now()) {
  const last = history.at(-1);
  return (
    last !== undefined &&
    last.role === "assistant" &&
    now - last.createdAt.getTime() >= FOLLOWUP_AFTER_MS
  );
}

export async function saveFollowUp(
  userId: number,
  lastUserMsg: StoredMessage,
  assistantResponseText: string,
) {
  return addDocument({
    content: `User: ${lastUserMsg.content}\n\nAssistant: ${assistantResponseText}`,
    containerTag: userContainerTag(userId),
    customId: `followup-u${userId}-m${lastUserMsg.id}`,
    entityContext: entityContext(),
    metadata: { source: "followup" },
    filterByMetadata: { source: "chat" },
  });
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    const users = await getActiveUsers();

    for (const user of users) {
      const userId = user.user_id;
      const recentMessages = await getUserHistory(userId, 21);
      if (!needsFollowUp(recentMessages)) continue;

      const memoryEnabled = isMemoryEnabled(userId);
      const lastUserMsg = recentMessages.findLast((m) => m.role === "user");
      const memoryMessages =
        memoryEnabled && lastUserMsg?.content
          ? await fetchMemoryMessages(userId, lastUserMsg.content).catch(
              (e) => {
                console.error("[supermemory] cron fetch failed:", e);
                return [];
              },
            )
          : [];

      const assistantResponseText = await getChatModel().generate({
        system: FOLLOWUP_SYSTEM_PROMPT,
        maxOutputTokens: 200,
        temperature: 0.7,
        messages: [
          ...memoryMessages,
          ...recentMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        ],
      });

      if (lastUserMsg?.content && assistantResponseText) {
        saveFollowUp(userId, lastUserMsg, assistantResponseText).catch((e) =>
          console.error("[supermemory] cron save failed:", e),
        );
      }
    }

    return json({ success: true });
  } catch (error) {
    console.error("Error in conversation follow-up cron:", error);
    return json({ error: "Internal server error" }, 500);
  }
}
