import { getClient } from "./supermemory";
import { temporalContainerTag } from "./supermemory-config";
import {
  temporalDocument,
  temporalCustomId,
  type TimeSource,
} from "./temporal-events";

async function findTemporalDocumentId(
  userId: number,
  messageId: number,
): Promise<string | null> {
  const { memories } = await getClient().documents.list({
    containerTags: [temporalContainerTag(userId)],
    filters: {
      AND: [
        { key: "user_id", value: String(userId) },
        {
          key: "source_message_id",
          value: String(messageId),
          filterType: "numeric",
          numericOperator: "=",
        },
      ],
    },
    limit: 1,
  });
  return memories[0]?.id ?? null;
}

export async function correctTemporalMessage(
  userId: number,
  edited: TimeSource,
  timezone: string,
): Promise<{ id: string; status: string } | null> {
  const id = await findTemporalDocumentId(userId, edited.id);
  if (!id) return null;
  const { content, containerTag, customId, metadata } = temporalDocument(
    userId,
    edited,
    timezone,
    [],
  );
  return getClient().documents.update(id, {
    content,
    containerTag,
    customId,
    metadata,
  });
}

export async function forgetTemporalMessage(
  userId: number,
  messageId: number,
): Promise<void> {
  await getClient().documents.delete(temporalCustomId(userId, messageId));
}
