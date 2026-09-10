export type ImageMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/webp";

export interface RuntimeImage {
  mediaType: ImageMediaType;
  data: string;
}

export interface InvokeRuntimeInput {
  message: string;
  sessionId: string;
  actorId: string;
  image?: RuntimeImage;
}

export interface InvokeRuntimeResult {
  message: string;
  sessionId: string;
  images?: RuntimeImage[];
  usage?: RuntimeUsage;
  latencyMs?: number;
}

export interface RuntimeUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadInputTokens?: number;
  cacheWriteInputTokens?: number;
}
