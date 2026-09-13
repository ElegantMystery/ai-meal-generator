/**
 * Minimal SSE-over-fetch helper.
 *
 * EventSource can't be used here because we need POST + cookie auth.
 * This parses the standard SSE line endings and invokes the callback for each
 * complete application JSON event. An undispatched frame may occupy at most
 * 1 MiB of UTF-8 bytes, including non-empty line endings and excluding the
 * terminating empty line.
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

const MAX_FRAME_BYTES = 1024 * 1024;
const INVALID_EVENT_DATA_ERROR = "Invalid SSE event data";
const INCOMPLETE_FRAME_ERROR = "SSE stream ended with an incomplete frame";
const OVERSIZED_FRAME_ERROR = "SSE frame exceeds 1 MiB";

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
  let aborted = false;
  let abortReason: unknown;
  let cancellation: Promise<void> | undefined;

  const cancel = (reason: unknown): Promise<void> => {
    if (!cancellation) {
      try {
        cancellation = reader.cancel(reason).then(
          () => undefined,
          () => undefined,
        );
      } catch {
        cancellation = Promise.resolve();
      }
    }
    return cancellation;
  };
  const handleAbort = () => {
    aborted = true;
    abortReason =
      opts.signal?.reason ?? new DOMException("The operation was aborted", "AbortError");
    void cancel(abortReason);
  };
  const throwIfAborted = () => {
    if (aborted) throw abortReason;
  };
  const parser = new SseParser(opts.onEvent, throwIfAborted);

  opts.signal?.addEventListener("abort", handleAbort, { once: true });
  if (opts.signal?.aborted) handleAbort();

  let failed = false;
  try {
    throwIfAborted();
    while (true) {
      const { value, done } = await reader.read();
      throwIfAborted();
      if (done) {
        parser.finish();
        break;
      }
      parser.push(value);
      throwIfAborted();
    }
  } catch (error) {
    failed = true;
    await cancel(error);
    try {
      reader.releaseLock();
    } catch {
      // Preserve the stream, callback, or abort error.
    }
    throw error;
  } finally {
    opts.signal?.removeEventListener("abort", handleAbort);
    if (!failed) reader.releaseLock();
  }
}

function readCookie(name: string): string {
  if (typeof document === "undefined") return "";
  const prefix = `${name}=`;
  const cookie = document.cookie.split("; ").find((entry) => entry.startsWith(prefix));
  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : "";
}

class SseParser {
  private readonly decoder = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: true,
  });
  private readonly lineSegments: Uint8Array[] = [];
  private readonly frameLines: string[] = [];
  private lineBytes = 0;
  private frameBytes = 0;
  private pendingCr = false;
  private pendingCrInFrame = false;
  private firstLine = true;

  constructor(
    private readonly onEvent: SseHandler,
    private readonly throwIfAborted: () => void,
  ) {}

  push(chunk: Uint8Array): void {
    if (chunk.byteLength === 0) return;

    let index = 0;
    let segmentStart = 0;

    if (this.pendingCr) {
      this.pendingCr = false;
      if (chunk[0] === 0x0a) {
        // The CR already completed its line. Count an optional LF only when
        // that line was part of the frame, not its terminating empty line.
        if (this.pendingCrInFrame) {
          this.frameBytes += 1;
          if (this.frameBytes > MAX_FRAME_BYTES) {
            throw new Error(OVERSIZED_FRAME_ERROR);
          }
        }
        index = 1;
        segmentStart = 1;
      }
    }

    for (; index < chunk.byteLength; index += 1) {
      const byte = chunk[index];
      if (byte !== 0x0a && byte !== 0x0d) continue;

      this.appendLineBytes(chunk.subarray(segmentStart, index));
      if (byte === 0x0a) {
        this.completeLine(1);
      } else if (index + 1 === chunk.byteLength) {
        this.pendingCrInFrame = this.lineBytes > 0;
        this.completeLine(1);
        this.pendingCr = true;
      } else if (chunk[index + 1] === 0x0a) {
        this.completeLine(2);
        index += 1;
      } else {
        this.completeLine(1);
      }
      segmentStart = index + 1;
    }

    this.appendLineBytes(chunk.subarray(segmentStart));
  }

  finish(): void {
    if (this.lineBytes > 0 || this.frameLines.length > 0) {
      throw new Error(INCOMPLETE_FRAME_ERROR);
    }
  }

  private appendLineBytes(bytes: Uint8Array): void {
    if (bytes.byteLength === 0) return;
    if (this.frameBytes + this.lineBytes + bytes.byteLength > MAX_FRAME_BYTES) {
      throw new Error(OVERSIZED_FRAME_ERROR);
    }
    this.lineSegments.push(bytes.slice());
    this.lineBytes += bytes.byteLength;
  }

  private completeLine(endingBytes: number): void {
    if (this.lineBytes === 0) {
      this.firstLine = false;
      this.dispatchFrame();
      return;
    }
    if (this.frameBytes + this.lineBytes + endingBytes > MAX_FRAME_BYTES) {
      throw new Error(OVERSIZED_FRAME_ERROR);
    }

    const encodedLine = new Uint8Array(this.lineBytes);
    let offset = 0;
    for (const segment of this.lineSegments) {
      encodedLine.set(segment, offset);
      offset += segment.byteLength;
    }

    let line: string;
    try {
      line = this.decoder.decode(encodedLine);
    } catch {
      throw new Error(INVALID_EVENT_DATA_ERROR);
    }
    if (this.firstLine && line.startsWith("\uFEFF")) line = line.slice(1);
    this.firstLine = false;
    this.frameLines.push(line);
    this.frameBytes += this.lineBytes + endingBytes;
    this.lineSegments.length = 0;
    this.lineBytes = 0;
  }

  private dispatchFrame(): void {
    const lines = this.frameLines.splice(0);
    this.frameBytes = 0;
    if (lines.length === 0) return;

    const parsed = parseFrame(lines);
    if (parsed) {
      this.onEvent(parsed);
      this.throwIfAborted();
    }
  }
}

function parseFrame(lines: string[]): SseEvent | null {
  let eventName = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
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
  try {
    return { event: eventName, data: JSON.parse(dataStr) as unknown };
  } catch {
    throw new Error(INVALID_EVENT_DATA_ERROR);
  }
}
