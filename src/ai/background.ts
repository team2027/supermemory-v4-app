const pending = new Set<Promise<unknown>>();

export function runInBackground(task: Promise<unknown>): void {
  pending.add(task);
  task.finally(() => pending.delete(task)).catch(() => {});
}

export async function drainBackground(): Promise<void> {
  await Promise.allSettled([...pending]);
}
