export class ChatStreamError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ChatStreamError";
    this.status = status;
  }
}

export async function streamChat(body, handlers = {}, fetchImpl = fetch) {
  const response = await fetchImpl("/api/chat", {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ChatStreamError(
      data?.message ?? data?.error ?? "Request failed",
      response.status,
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("text/event-stream")) {
    throw new ChatStreamError("Expected a server-sent event response", response.status);
  }
  if (response.body === null) {
    throw new ChatStreamError("Response stream is unavailable", response.status);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = consumeSseFrames(buffer);
      buffer = parsed.remainder;
      for (const event of parsed.events) {
        dispatchChatEvent(event, handlers);
        if (event.type === "done") completed = true;
        if (event.type === "error") {
          throw new ChatStreamError(
            event.data?.message ?? "AgentCore invocation failed",
            response.status,
          );
        }
      }
    }

    buffer += decoder.decode();
    const parsed = consumeSseFrames(buffer, true);
    for (const event of parsed.events) {
      dispatchChatEvent(event, handlers);
      if (event.type === "done") completed = true;
      if (event.type === "error") {
        throw new ChatStreamError(
          event.data?.message ?? "AgentCore invocation failed",
          response.status,
        );
      }
    }

    if (!completed) {
      throw new ChatStreamError("Chat stream ended before completion", response.status);
    }
  } finally {
    if (!completed) {
      await reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }
}

export function consumeSseFrames(buffer, flush = false) {
  const events = [];
  let remainder = buffer;
  let boundary = findBoundary(remainder);

  while (boundary !== null) {
    const frame = remainder.slice(0, boundary.index);
    remainder = remainder.slice(boundary.index + boundary.length);
    const event = parseSseFrame(frame);
    if (event !== null) events.push(event);
    boundary = findBoundary(remainder);
  }

  if (flush && remainder.length > 0) {
    const event = parseSseFrame(remainder);
    if (event !== null) events.push(event);
    remainder = "";
  }

  return { events, remainder };
}

function findBoundary(value) {
  const match = /\r?\n\r?\n/.exec(value);
  return match === null
    ? null
    : { index: match.index, length: match[0].length };
}

function parseSseFrame(frame) {
  let type = "message";
  const dataLines = [];

  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      type = line.slice(6).trimStart();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
    }
  }

  if (dataLines.length === 0) return null;
  const rawData = dataLines.join("\n");
  try {
    return { type, data: JSON.parse(rawData) };
  } catch {
    throw new ChatStreamError("Received an invalid server-sent event");
  }
}

function dispatchChatEvent(event, handlers) {
  const handler = handlers[event.type];
  if (typeof handler === "function") handler(event.data);
}
