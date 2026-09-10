export class RequestBodyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestBodyError";
  }
}

export async function readJsonWithLimit(
  request: Request,
  maxBytes: number,
): Promise<unknown> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number.parseInt(declaredLength, 10);
    if (!Number.isFinite(parsedLength) || parsedLength < 0) {
      throw new RequestBodyError("Invalid Content-Length header");
    }
    if (parsedLength > maxBytes) {
      throw new RequestBodyError("Request body is too large");
    }
  }

  if (request.body === null) {
    throw new RequestBodyError("Request body is required");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel("Request body is too large");
        throw new RequestBodyError("Request body is too large");
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new RequestBodyError("Request body must contain valid JSON");
  }
}
