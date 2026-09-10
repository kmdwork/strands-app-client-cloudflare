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

export type RuntimeStreamEvent =
  | { type: "delta"; text: string }
  | { type: "image"; image: RuntimeImage }
  | { type: "metadata"; usage?: RuntimeUsage; latencyMs?: number }
  | { type: "done" };

export interface InvokeRuntimeStreamResult {
  sessionId: string;
  events: AsyncIterable<RuntimeStreamEvent>;
  close: () => Promise<void>;
}

export interface RuntimeUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadInputTokens?: number;
  cacheWriteInputTokens?: number;
}
