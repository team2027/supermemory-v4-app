function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for the memory feature`);
  }
  return value;
}

export function containerTagPrefix(): string {
  return requireEnv("SUPERMEMORY_CONTAINER_TAG_PREFIX");
}

export function entityContext(): string {
  return requireEnv("SUPERMEMORY_ENTITY_CONTEXT");
}

export function userContainerTag(userId: number | string): string {
  return `${containerTagPrefix()}${userId}`;
}

export function temporalContainerTag(userId: number | string): string {
  return `${userContainerTag(userId)}-time-v1`;
}
