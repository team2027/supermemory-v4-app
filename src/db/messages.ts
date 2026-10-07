import { readFile } from "node:fs/promises";
import { z } from "zod";
import { env } from "../env";

const storedMessageSchema = z.object({
  id: z.number().int().positive(),
  userId: z.number().int().positive(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  createdAt: z.coerce.date(),
});

export type StoredMessage = z.infer<typeof storedMessageSchema>;

const ACTIVE_WINDOW_MS = 30 * 86_400_000;

async function loadMessages(): Promise<StoredMessage[]> {
  if (!env.MESSAGES_FILE) {
    throw new Error("MESSAGES_FILE is required to read the message store");
  }
  const raw = JSON.parse(await readFile(env.MESSAGES_FILE, "utf8"));
  return z.array(storedMessageSchema).parse(raw);
}

const byCreatedAt = (a: StoredMessage, b: StoredMessage) =>
  a.createdAt.getTime() - b.createdAt.getTime();

export async function getUserMessages(
  userId: number,
): Promise<StoredMessage[]> {
  return (await loadMessages())
    .filter((message) => message.userId === userId)
    .sort(byCreatedAt);
}

export async function countUserMessages(userId: number): Promise<number> {
  return (await getUserMessages(userId)).length;
}

export async function getUserHistory(
  userId: number,
  limit: number,
): Promise<StoredMessage[]> {
  return (await getUserMessages(userId)).slice(-limit);
}

export async function getUserSourceMessages(userId: number, ids: number[]) {
  const validIds = [...new Set(ids)]
    .filter((id) => Number.isSafeInteger(id) && id > 0)
    .slice(0, 4);
  if (!validIds.length) return [];

  return (await getUserMessages(userId))
    .filter(
      (message) => message.role === "user" && validIds.includes(message.id),
    )
    .map(({ id, content, createdAt }) => ({ id, content, createdAt }));
}

export async function getActiveUsers(
  now = Date.now(),
): Promise<{ user_id: number; msg_count: string }[]> {
  const counts = new Map<number, { total: number; lastAt: number }>();
  for (const message of await loadMessages()) {
    const entry = counts.get(message.userId) ?? { total: 0, lastAt: 0 };
    entry.total += 1;
    entry.lastAt = Math.max(entry.lastAt, message.createdAt.getTime());
    counts.set(message.userId, entry);
  }
  return [...counts.entries()]
    .filter(([, { lastAt }]) => now - lastAt <= ACTIVE_WINDOW_MS)
    .sort(([, a], [, b]) => a.total - b.total)
    .map(([user_id, { total }]) => ({ user_id, msg_count: String(total) }));
}
