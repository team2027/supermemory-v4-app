import { getChatModel } from "./models";
import { fetchMemoryMessages, saveMemory } from "./supermemory";
import {
  type CurrentMessageTime,
  fetchTemporalMemories,
  queueTemporalMessages,
} from "./temporal-memory";
import type { ChatMessage } from "./types";

const MESSAGE_HISTORY_LENGTH = 30;

export interface ReplyOptions {
  systemPrompt: string;
  userId?: number;
  timezone: string;
  currentMessageTimes?: CurrentMessageTime[];
  useMemory?: boolean;
  abortSignal?: AbortSignal;
}

export function timeContext(now: number, timezone: string): string {
  const local = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    dateStyle: "full",
    timeStyle: "short",
  }).format(now);
  return `<time now="${local}" timezone="${timezone}" />`;
}

export async function generateReply(
  history: ChatMessage[],
  userText: string,
  {
    systemPrompt,
    userId,
    timezone,
    currentMessageTimes,
    useMemory,
    abortSignal,
  }: ReplyOptions,
): Promise<string> {
  const now = Date.now();

  const [memoryMessages, temporalMemories] = await Promise.all([
    useMemory && userId
      ? fetchMemoryMessages(userId, userText || "[image message]").catch(
          (error) => {
            console.error("[supermemory] error fetching memories:", error);
            return [] as ChatMessage[];
          },
        )
      : Promise.resolve([] as ChatMessage[]),
    useMemory && userId
      ? fetchTemporalMemories(userId, userText, now, abortSignal)
      : Promise.resolve([] as ChatMessage[]),
  ]);

  const reply = await getChatModel().generate({
    system: systemPrompt,
    maxOutputTokens: 2048,
    temperature: 0.8,
    abortSignal,
    messages: [
      ...memoryMessages,
      ...temporalMemories,
      { role: "system", content: timeContext(now, timezone) },
      ...history.slice(-MESSAGE_HISTORY_LENGTH),
      { role: "user", content: userText },
    ],
  });

  if (userId) {
    saveMemory(userId, userText || "[image message]", reply).catch((error) =>
      console.error("[supermemory] background save failed:", error),
    );
    if (useMemory)
      queueTemporalMessages(userId, currentMessageTimes ?? [], timezone);
  }

  return reply;
}
