import type { ChatModel, StructuredModel } from "./types";

let chatModel: ChatModel | null = null;
let extractionModel: StructuredModel | null = null;

export function configureModels(models: {
  chat: ChatModel;
  extraction: StructuredModel;
}): void {
  chatModel = models.chat;
  extractionModel = models.extraction;
}

export function getChatModel(): ChatModel {
  if (!chatModel) {
    throw new Error("chat model is not configured, call configureModels()");
  }
  return chatModel;
}

export function getExtractionModel(): StructuredModel {
  if (!extractionModel) {
    throw new Error(
      "extraction model is not configured, call configureModels()",
    );
  }
  return extractionModel;
}
