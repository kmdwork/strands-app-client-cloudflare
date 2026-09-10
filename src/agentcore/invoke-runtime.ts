import { InvokeAgentRuntimeCommand } from "@aws-sdk/client-bedrock-agentcore";
import { createAgentCoreClient } from "./client";
import type {
  InvokeRuntimeInput,
  InvokeRuntimeResult,
  RuntimeImage,
} from "./types";

const JSON_CONTENT_TYPE = "application/json";

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
        accept: JSON_CONTENT_TYPE,
        payload: new TextEncoder().encode(JSON.stringify(payload)),
      }),
    );

    if (response.response === undefined) {
      throw new AgentCoreInvocationError("AgentCore Runtime returned no response");
    }

    if (response.statusCode !== undefined && response.statusCode >= 400) {
      throw new AgentCoreInvocationError(
        `AgentCore Runtime returned HTTP ${response.statusCode}`,
      );
    }

    const rawBody = await response.response.transformToString();
    const result = parseRuntimeResponse(rawBody, response.contentType);

    return {
      ...result,
      sessionId: response.runtimeSessionId ?? input.sessionId,
    };
  } catch (error) {
    if (error instanceof AgentCoreInvocationError) {
      throw error;
    }

    throw new AgentCoreInvocationError("Failed to invoke AgentCore Runtime", error);
  } finally {
    client.destroy();
  }
}

export function parseRuntimeResponse(
  rawBody: string,
  contentType?: string,
): Omit<InvokeRuntimeResult, "sessionId"> {
  const normalizedBody = contentType?.includes("text/event-stream")
    ? parseServerSentEvents(rawBody)
    : rawBody.trim();

  if (normalizedBody.length === 0) {
    throw new AgentCoreInvocationError("AgentCore Runtime returned an empty response");
  }

  try {
    return normalizeJsonResponse(JSON.parse(normalizedBody));
  } catch (error) {
    if (error instanceof AgentCoreInvocationError) {
      throw error;
    }
    return { message: normalizedBody };
  }
}

function parseServerSentEvents(body: string): string {
  const events = body
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .filter((line) => line !== "[DONE]");

  const textParts: string[] = [];
  let usage: unknown;
  let latencyMs: unknown;

  for (const data of events) {
    try {
      const value: unknown = JSON.parse(data);
      if (typeof value === "string") {
        textParts.push(value);
        continue;
      }
      if (!isRecord(value)) continue;

      const event = isRecord(value.event) ? value.event : value;
      const contentBlockDelta = isRecord(event.contentBlockDelta)
        ? event.contentBlockDelta
        : undefined;
      const delta = isRecord(contentBlockDelta?.delta)
        ? contentBlockDelta.delta
        : undefined;
      if (typeof delta?.text === "string") {
        textParts.push(delta.text);
      }

      const directText = [value.message, value.response, value.result, value.output].find(
        (candidate): candidate is string => typeof candidate === "string",
      );
      if (directText !== undefined) textParts.push(directText);

      const metadata = isRecord(event.metadata) ? event.metadata : undefined;
      if (metadata?.usage !== undefined) usage = metadata.usage;
      const metrics = isRecord(metadata?.metrics) ? metadata.metrics : undefined;
      if (typeof metrics?.latencyMs === "number") latencyMs = metrics.latencyMs;
    } catch {
      textParts.push(data);
    }
  }

  return JSON.stringify({ message: textParts.join(""), usage, latencyMs });
}

function normalizeJsonResponse(
  value: unknown,
): Omit<InvokeRuntimeResult, "sessionId"> {
  if (typeof value === "string" && value.length > 0) {
    return { message: value };
  }

  if (!isRecord(value)) {
    throw new AgentCoreInvocationError(
      "AgentCore Runtime returned an unsupported JSON response",
    );
  }

  const message = [value.message, value.response, value.result, value.output].find(
    (candidate): candidate is string =>
      typeof candidate === "string" && candidate.length > 0,
  );

  if (message === undefined) {
    throw new AgentCoreInvocationError(
      "AgentCore Runtime response did not include a text message",
    );
  }

  const images = normalizeResponseImages(value);
  const usage = normalizeUsage(value.usage);
  const latencyMs = typeof value.latencyMs === "number" ? value.latencyMs : undefined;
  return {
    message,
    ...(images.length === 0 ? {} : { images }),
    ...(usage === undefined ? {} : { usage }),
    ...(latencyMs === undefined ? {} : { latencyMs }),
  };
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
