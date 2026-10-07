import Supermemory from "supermemory";
import { env } from "../env";
import { z } from "zod";
import { entityContext, userContainerTag } from "./supermemory-config";
import type { ChatMessage } from "./types";

const searchResultSchema = z.object({
  memory: z.string(),
});

let _client: Supermemory | null = null;

export function getClient() {
  if (!env.SUPERMEMORY_API_KEY) {
    throw new Error("SUPERMEMORY_API_KEY is required for memory feature");
  }
  if (!_client) {
    _client = new Supermemory({ apiKey: env.SUPERMEMORY_API_KEY });
  }
  return _client;
}

export async function fetchMemoryMessages(
  userId: number,
  userMessage: string,
): Promise<ChatMessage[]> {
  const client = getClient();
  const containerTag = userContainerTag(userId);

  const { profile, searchResults } = await client.profile({
    containerTag,
    q: userMessage,
  });

  if (env.NODE_ENV !== "production") {
    console.log("[supermemory] profile fetched", {
      containerTag,
      static: profile.static.length,
      dynamic: profile.dynamic.length,
      searchResults: searchResults?.total ?? 0,
    });
  }

  const messages: ChatMessage[] = [];

  const staticText = profile.static.join("\n");
  if (staticText) {
    messages.push({
      role: "user" as const,
      content: `<memory-static>\n${staticText}\n</memory-static>`,
      cacheControl: { type: "ephemeral" },
    });
  }

  const searchMemories =
    searchResults?.results
      ?.map((r) => searchResultSchema.safeParse(r))
      .filter((r) => r.success)
      .map((r) => r.data.memory) ?? [];

  const dynamicParts = [...profile.dynamic, ...searchMemories].filter(Boolean);

  const dynamicText = dynamicParts.join("\n");
  if (dynamicText) {
    messages.push({
      role: "user" as const,
      content: `<memory-dynamic>\n${dynamicText}\n</memory-dynamic>`,
    });
  }

  return messages;
}

export async function saveMemory(
  userId: number,
  userMessage: string,
  assistantResponse: string,
): Promise<void> {
  const client = getClient();
  await client.add({
    content: `User: ${userMessage}\n\nAssistant: ${assistantResponse}`,
    containerTag: userContainerTag(userId),
    entityContext: entityContext(),
    metadata: { source: "chat" },
  });
}
