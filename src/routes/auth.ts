import { env } from "../env";

export function isAuthorized(request: Request): boolean {
  if (!env.ADMIN_TOKEN) {
    throw new Error("ADMIN_TOKEN is required for admin routes");
  }
  return request.headers.get("authorization") === `Bearer ${env.ADMIN_TOKEN}`;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
