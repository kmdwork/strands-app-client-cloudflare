import { InvokeAgentRuntimeCommand } from "@aws-sdk/client-bedrock-agentcore";
import { createAgentCoreClient } from "./client";
import type {
  InvokeRuntimeInput,
  InvokeRuntimeResult,
  InvokeRuntimeStreamResult,
  RuntimeImage,
  RuntimeStreamEvent,
  RuntimeUsage,
} from "./types";

const JSON_CONTENT_TYPE = "application/json";
const SSE_CONTENT_TYPE = "text/event-stream";

export class AgentCoreInvocationError extends Error {
  readonly causeName: string;

  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "AgentCoreInvocationError";
    this.causeName = cause instanceof Error ? cause.name : "UnknownError";
  }
}

export async function invokeRuntime(
  env: Env,
  input: InvokeRuntimeInput,
): Promise<InvokeRuntimeResult> {
  const stream = await invokeRuntimeStream(env, input);
  const textParts: string[] = [];
  const images: RuntimeImage[] = [];
  let usage: RuntimeUsage | undefined;
  let latencyMs: number | undefined;

  for await (const event of stream.events) {
    if (event.type === "delta") textParts.push(event.text);
    if (event.type === "image") images.push(event.image);
    if (event.type === "metadata") {
      usage = event.usage ?? usage;
      latencyMs = event.latencyMs ?? latencyMs;
    }
  }

  if (textParts.length === 0) {
    throw new AgentCoreInvocationError(
      "AgentCore Runtime response did not include a text message",
    );
  }

  return {
    message: textParts.join(""),
    sessionId: stream.sessionId,
    ...(images.length === 0 ? {} : { images }),
    ...(usage === undefined ? {} : { usage }),
    ...(latencyMs === undefined ? {} : { latencyMs }),
  };
}

export async function invokeRuntimeStream(
  env: Env,
  input: InvokeRuntimeInput,
  options: { abortSignal?: AbortSignal } = {},
): Promise<InvokeRuntimeStreamResult> {
  const client = createAgentCoreClient(env);
  const payload = {
    prompt: input.message,
    ...(input.image === undefined
      ? {}
      : {
          media: {
            type: "image",
            format: input.image.mediaType === "image/jpeg"
              ? "jpeg"
              : input.image.mediaType.slice("image/".length),
            data: input.image.data,
          },
        }),
  };

  try {
    const response = await client.send(
      new InvokeAgentRuntimeCommand({
        agentRuntimeArn: env.AGENTCORE_RUNTIME_ARN,
        qualifier: "DEFAULT",
        runtimeSessionId: input.sessionId,
        runtimeUserId: input.actorId,
        contentType: JSON_CONTENT_TYPE,
        accept: SSE_CONTENT_TYPE,
        payload: new TextEncoder().encode(JSON.stringify(payload)),
      }),
      { abortSignal: options.abortSignal },
    );

    if (response.statusCode !== undefined && response.statusCode >= 400) {
      throw new AgentCoreInvocationError(
        `AgentCore Runtime returned HTTP ${response.statusCode}`,
      );
    }

    if (!response.contentType?.toLowerCase().includes(SSE_CONTENT_TYPE)) {
      throw new AgentCoreInvocationError(
        `AgentCore Runtime returned unsupported content type: ${response.contentType ?? "missing"}`,
      );
    }

    if (response.response === undefined) {
      throw new AgentCoreInvocationError("AgentCore Runtime returned no response");
    }

    const body = response.response;
    let closed = false;
    const close = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      try {
        await cancelRuntimeBody(body);
      } finally {
        client.destroy();
      }
    };

    return {
      sessionId: response.runtimeSessionId ?? input.sessionId,
      events: parseRuntimeEventStream(readRuntimeBody(body), close),
      close,
    };
  } catch (error) {
    client.destroy();
    if (error instanceof AgentCoreInvocationError) {
      throw error;
    }
    throw new AgentCoreInvocationError("Failed to invoke AgentCore Runtime", error);
  }
}

export async function* parseRuntimeEventStream(
  chunks: AsyncIterable<Uint8Array | string>,
  cleanup: () => void | Promise<void> = () => {},
): AsyncGenerator<RuntimeStreamEvent> {
  const decoder = new TextDecoder();
  let buffer = "";
  let doneEmitted = false;

  const decode = (chunk: Uint8Array | string): string =>
    typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });

  try {
    for await (const chunk of chunks) {
      buffer += decode(chunk);
      let boundary = findEventBoundary(buffer);
      while (boundary !== undefined) {
        const frame = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary.length);
        for (const event of normalizeSseFrame(frame)) {
          yield event;
          if (event.type === "done") {
            doneEmitted = true;
            return;
          }
        }
        boundary = findEventBoundary(buffer);
      }
    }

    buffer += decoder.decode();
    if (buffer.length > 0) {
      for (const event of normalizeSseFrame(buffer)) {
        yield event;
        if (event.type === "done") doneEmitted = true;
      }
    }

    if (!doneEmitted) yield { type: "done" };
  } finally {
    await cleanup();
  }
}

function findEventBoundary(value: string): { index: number; length: number } | undefined {
  const match = /\r?\n\r?\n/.exec(value);
  return match === null ? undefined : { index: match.index, length: match[0].length };
}

function normalizeSseFrame(frame: string): RuntimeStreamEvent[] {
  const data = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""))
    .join("\n");

  if (data.length === 0) return [];
  if (data.trim() === "[DONE]") return [{ type: "done" }];

  try {
    return normalizeStreamValue(JSON.parse(data));
  } catch {
    // Ignore only the malformed frame; subsequent independent SSE events remain usable.
    return [];
  }
}

function normalizeStreamValue(value: unknown): RuntimeStreamEvent[] {
  if (typeof value === "string") return [{ type: "delta", text: value }];
  if (!isRecord(value)) return [];

  const event = isRecord(value.event) ? value.event : value;
  const contentBlockDelta = isRecord(event.contentBlockDelta)
    ? event.contentBlockDelta
    : undefined;
  const delta = isRecord(contentBlockDelta?.delta)
    ? contentBlockDelta.delta
    : undefined;
  const result: RuntimeStreamEvent[] = [];

  if (typeof delta?.text === "string") {
    result.push({ type: "delta", text: delta.text });
  } else {
    const directText = [value.message, value.response, value.result, value.output].find(
      (candidate): candidate is string => typeof candidate === "string",
    );
    if (directText !== undefined) result.push({ type: "delta", text: directText });
  }

  for (const image of normalizeResponseImages(value)) {
    result.push({ type: "image", image });
  }
  if (event !== value) {
    for (const image of normalizeResponseImages(event)) {
      result.push({ type: "image", image });
    }
  }

  const metadata = isRecord(event.metadata) ? event.metadata : undefined;
  if (metadata !== undefined) {
    const usage = normalizeUsage(metadata.usage);
    const metrics = isRecord(metadata.metrics) ? metadata.metrics : undefined;
    const latencyMs = typeof metrics?.latencyMs === "number"
      ? metrics.latencyMs
      : typeof metadata.latencyMs === "number"
        ? metadata.latencyMs
        : undefined;
    if (usage !== undefined || latencyMs !== undefined) {
      result.push({
        type: "metadata",
        ...(usage === undefined ? {} : { usage }),
        ...(latencyMs === undefined ? {} : { latencyMs }),
      });
    }
  }

  return result;
}

function readRuntimeBody(body: unknown): AsyncIterable<Uint8Array> {
  if (isReadableStream(body)) {
    return {
      async *[Symbol.asyncIterator]() {
        const reader = body.getReader();
        try {
          while (true) {
            const next = await reader.read();
            if (next.done) return;
            yield next.value;
          }
        } finally {
          reader.releaseLock();
        }
      },
    };
  }

  if (isAsyncIterable(body)) return body;
  throw new AgentCoreInvocationError("AgentCore Runtime returned an unsupported stream");
}

async function cancelRuntimeBody(body: unknown): Promise<void> {
  if (isReadableStream(body) && !body.locked) {
    await body.cancel().catch(() => undefined);
    return;
  }
  if (isRecord(body) && typeof body.destroy === "function") body.destroy();
}

function isReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
  return isRecord(value) && typeof value.getReader === "function";
}

function isAsyncIterable(value: unknown): value is AsyncIterable<Uint8Array> {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof value[Symbol.asyncIterator] === "function"
  );
}

function normalizeUsage(value: unknown): InvokeRuntimeResult["usage"] {
  if (!isRecord(value)) return undefined;
  const keys = [
    "inputTokens",
    "outputTokens",
    "totalTokens",
    "cacheReadInputTokens",
    "cacheWriteInputTokens",
  ] as const;
  const usage = Object.fromEntries(
    keys.flatMap((key) =>
      typeof value[key] === "number" ? [[key, value[key]]] : [],
    ),
  );
  return Object.keys(usage).length === 0 ? undefined : usage;
}

function normalizeResponseImages(value: Record<string, unknown>): RuntimeImage[] {
  const candidates = Array.isArray(value.images) ? value.images : [];

  return candidates.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const data = candidate.data ?? candidate.image_data;
    const mediaType = candidate.mediaType ?? candidate.media_type;
    if (typeof data !== "string" || !isImageMediaType(mediaType)) return [];
    return [{ data, mediaType }];
  });
}

function isImageMediaType(value: unknown): value is RuntimeImage["mediaType"] {
  return (
    value === "image/jpeg" ||
    value === "image/png" ||
    value === "image/webp"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
