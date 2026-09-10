export interface ChatRequest {
  message: string;
  sessionId?: string;
  image?: {
    mediaType: "image/jpeg" | "image/png" | "image/webp";
    data: string;
  };
}

const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{32,99}$/;
const MAX_MESSAGE_LENGTH = 4_000;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const IMAGE_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export class RequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestValidationError";
  }
}

export function parseChatRequest(value: unknown): ChatRequest {
  if (!isRecord(value)) {
    throw new RequestValidationError("Request body must be a JSON object");
  }

  const message = value.message;
  if (typeof message !== "string") {
    throw new RequestValidationError("message must be a string");
  }

  const normalizedMessage = message.trim();
  if (normalizedMessage.length === 0) {
    throw new RequestValidationError("message must not be empty");
  }

  if (normalizedMessage.length > MAX_MESSAGE_LENGTH) {
    throw new RequestValidationError(
      `message must be ${MAX_MESSAGE_LENGTH} characters or fewer`,
    );
  }

  const sessionId = value.sessionId;
  if (sessionId !== undefined) {
    if (typeof sessionId !== "string" || !SESSION_ID_PATTERN.test(sessionId)) {
      throw new RequestValidationError(
        "sessionId must be 33-100 characters using letters, numbers, hyphens, or underscores",
      );
    }
  }

  const image = parseImage(value.image);

  return {
    message: normalizedMessage,
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(image === undefined ? {} : { image }),
  };
}

function parseImage(value: unknown): ChatRequest["image"] {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new RequestValidationError("image must be an object");
  }

  const { mediaType, data } = value;
  if (typeof mediaType !== "string" || !IMAGE_MEDIA_TYPES.has(mediaType)) {
    throw new RequestValidationError(
      "image.mediaType must be image/jpeg, image/png, or image/webp",
    );
  }
  if (typeof data !== "string" || data.length === 0 || !BASE64_PATTERN.test(data)) {
    throw new RequestValidationError("image.data must be valid base64");
  }

  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  const decodedBytes = (data.length * 3) / 4 - padding;
  if (decodedBytes > MAX_IMAGE_BYTES) {
    throw new RequestValidationError("image must be 2 MiB or smaller");
  }

  return {
    mediaType: mediaType as NonNullable<ChatRequest["image"]>["mediaType"],
    data,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
