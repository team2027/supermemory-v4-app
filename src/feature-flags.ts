export function isMemoryEnabled(userId: number): boolean {
  const allowlist = process.env.MEMORY_USER_IDS;
  if (allowlist === undefined) {
    throw new Error("MEMORY_USER_IDS must be set (use * for all users)");
  }
  if (allowlist.trim() === "*") return true;
  return allowlist.split(",").some((value) => value.trim() === String(userId));
}
