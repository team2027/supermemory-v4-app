import { env } from "../env";

const SUPERMEMORY_API_URL = "https://api.supermemory.ai";

export interface AddDocumentRequest {
  content: string;
  containerTag: string;
  customId?: string;
  entityContext?: string;
  metadata?: Record<string, string | number | boolean>;
  filterByMetadata?: Record<string, string | number | boolean>;
}

export interface AddDocumentResponse {
  id: string;
  status: string;
}

// The SDK's add params do not expose filterByMetadata, so this goes over HTTP.
export async function addDocument(
  request: AddDocumentRequest,
): Promise<AddDocumentResponse> {
  if (!env.SUPERMEMORY_API_KEY) {
    throw new Error("SUPERMEMORY_API_KEY is required for memory feature");
  }
  const response = await fetch(`${SUPERMEMORY_API_URL}/v3/documents`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.SUPERMEMORY_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    throw new Error(
      `supermemory POST /v3/documents failed: ${response.status} ${await response.text()}`,
    );
  }
  return (await response.json()) as AddDocumentResponse;
}
