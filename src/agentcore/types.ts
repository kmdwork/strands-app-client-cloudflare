export type ImageMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/webp";

export interface RuntimeImage {
  mediaType: ImageMediaType;
  data: string;
}

interface RuntimeInvocationIdentity {
  sessionId: string;
  actorId: string;
  userAccessToken: string;
}

export interface RuntimeInterruptResponse {
  interruptId: string;
  response: "approve" | "reject";
}

export interface InvokeRuntimePromptInput extends RuntimeInvocationIdentity {
  message: string;
  image?: RuntimeImage;
}

export interface InvokeRuntimeResumeInput extends RuntimeInvocationIdentity {
  interruptResponses: RuntimeInterruptResponse[];
}

export type InvokeRuntimeInput =
  | InvokeRuntimePromptInput
  | InvokeRuntimeResumeInput;

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
  | {
    type: "confirmation_required";
    confirmation: RuntimeConfirmation;
  }
  | { type: "done" };

export interface RuntimeConfirmation {
  interruptId: string;
  toolName: string;
  summary: {
    operations?: Array<Record<string, string | number | boolean | null>>;
  };
}

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
