/**
 * Minimal SSE-over-fetch helper.
 *
 * EventSource can't be used here because we need POST + cookie auth.
 * This parses the standard `event: <name>\ndata: <json>\n\n` frame format
 * one frame at a time and invokes the callback for each.
 */

import { apiBaseUrl, ensureCsrfToken } from "./api";

export type SseEvent = {
  event: string;
  data: unknown;
};

export type SseHandler = (event: SseEvent) => void;

export type StreamMealPlanOptions = {
  store: string;
  days: number;
  idempotencyKey: string;
  onEvent: SseHandler;
  signal?: AbortSignal;
  correlationId?: string;
};

/**
 * POSTs /api/mealplans/generate-ai and streams the SSE response.
 * Resolves when the stream ends. Throws on HTTP error / abort.
 *
 * The caller is responsible for matching on `event.event === "complete"`,
 * `"mealplan_saved"`, or `"error"` to know when work has finished.
 */
export async function streamMealPlan(
  opts: StreamMealPlanOptions
): Promise<void> {
  await ensureCsrfToken();
  const correlationId = opts.correlationId ?? crypto.randomUUID();
  const url = new URL(`${apiBaseUrl}/api/mealplans/generate-ai`);
  url.searchParams.set("store", opts.store);
  url.searchParams.set("days", String(opts.days));

  const res = await fetch(url.toString(), {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "text/event-stream",
      "Idempotency-Key": opts.idempotencyKey,
      "X-XSRF-TOKEN": readCookie("XSRF-TOKEN"),
      "X-Correlation-ID": correlationId,
    },
    signal: opts.signal,
  });

  if (!res.ok) {
    // Buffer body for a clearer error (quota exceeded, auth failure, etc.)
    let body = "";
    try {
      body = await res.text();
    } catch {
      // ignore
    }
    const err = new Error(`generate-ai failed: ${res.status} ${body}`);
    (err as unknown as { status: number }).status = res.status;
    (err as unknown as { body: string }).body = body;
    throw err;
  }

  if (!res.body) {
    throw new Error("generate-ai response has no body");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line ("\n\n").
    let sepIndex: number;
    while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, sepIndex);
      buffer = buffer.slice(sepIndex + 2);
      const parsed = parseFrame(frame);
      if (parsed) opts.onEvent(parsed);
    }
  }

  // Flush any final frame without trailing blank line
  if (buffer.trim().length > 0) {
    const parsed = parseFrame(buffer);
    if (parsed) opts.onEvent(parsed);
  }
}

function readCookie(name: string): string {
  if (typeof document === "undefined") return "";
  const prefix = `${name}=`;
  const cookie = document.cookie.split("; ").find((entry) => entry.startsWith(prefix));
  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : "";
}

function parseFrame(frame: string): SseEvent | null {
  let eventName = "message";
  const dataLines: string[] = [];

  for (const line of frame.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const valueRaw = colon === -1 ? "" : line.slice(colon + 1);
    const value = valueRaw.startsWith(" ") ? valueRaw.slice(1) : valueRaw;
    if (field === "event") eventName = value;
    else if (field === "data") dataLines.push(value);
  }

  if (dataLines.length === 0) return null;

  const dataStr = dataLines.join("\n");
  let data: unknown;
  try {
    data = JSON.parse(dataStr);
  } catch {
    data = dataStr;
  }
  return { event: eventName, data };
}
