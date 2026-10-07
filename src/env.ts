import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  // Supermemory
  SUPERMEMORY_API_KEY: z.string().min(1).optional(),
  MESSAGES_FILE: z.string().min(1).optional(),
  ADMIN_TOKEN: z.string().min(1).optional(),
});

export const env = envSchema.parse({
  NODE_ENV: process.env.NODE_ENV,
  // Supermemory
  SUPERMEMORY_API_KEY: process.env.SUPERMEMORY_API_KEY,
  MESSAGES_FILE: process.env.MESSAGES_FILE,
  ADMIN_TOKEN: process.env.ADMIN_TOKEN,
});
