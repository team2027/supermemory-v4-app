import { z } from "zod";
import {
  backfillUserMemory,
  getBackfillStatus,
} from "../ai/supermemory-backfill";
import { isAuthorized, json } from "./auth";

export const maxDuration = 300;

const userIdSchema = z
  .string()
  .regex(/^\d+$/, "userId must be a numeric string")
  .transform(Number);

const postBodySchema = z.object({
  userId: z.union([z.string(), z.number()]).transform((v) => {
    const n = typeof v === "string" ? Number(v) : v;
    if (!Number.isFinite(n) || n <= 0) throw new Error("invalid userId");
    return n;
  }),
  force: z.boolean().optional().default(false),
});

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const parsed = userIdSchema.safeParse(
    new URL(request.url).searchParams.get("userId"),
  );
  if (!parsed.success) {
    return json({ error: "valid numeric userId required" }, 400);
  }

  const status = await getBackfillStatus(parsed.data);
  return json(status);
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = postBodySchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: "Invalid request body", details: parsed.error.issues },
      400,
    );
  }

  try {
    const result = await backfillUserMemory(parsed.data.userId, {
      force: parsed.data.force,
    });
    return json(result);
  } catch (error) {
    console.error("[supermemory-backfill] failed:", error);
    return json({ error: "Backfill failed" }, 500);
  }
}
