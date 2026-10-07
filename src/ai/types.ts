export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  cacheControl?: { type: "ephemeral" };
}

export interface GenerateOptions {
  system?: string;
  messages: ChatMessage[];
  maxOutputTokens: number;
  temperature: number;
  abortSignal?: AbortSignal;
}

export interface ChatModel {
  generate(options: GenerateOptions): Promise<string>;
}

export interface StructuredModel {
  generateObject(options: {
    system: string;
    prompt: string;
    maxOutputTokens: number;
    timeout: number;
    abortSignal?: AbortSignal;
  }): Promise<{ output: unknown }>;
}
