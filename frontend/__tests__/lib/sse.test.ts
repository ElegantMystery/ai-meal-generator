/** @jest-environment node */

import { streamMealPlan, type SseEvent } from "@/lib/sse";

jest.mock("@/lib/api", () => ({
  apiBaseUrl: "http://localhost:8080",
  ensureCsrfToken: jest.fn().mockResolvedValue(undefined),
}));

const encoder = new TextEncoder();

function streamFromTextChunks(
  chunks: string[],
  options: {
    close?: boolean;
    cancel?: UnderlyingSourceCancelCallback;
  } = {},
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      if (options.close ?? true) controller.close();
    },
    cancel: options.cancel,
  });
}

function installResponse(body: ReadableStream<Uint8Array>): void {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, body } as Response);
}

function readStream(
  onEvent: (event: SseEvent) => void,
  options: { signal?: AbortSignal } = {},
): Promise<void> {
  return streamMealPlan({
    store: "TRADER_JOES",
    days: 3,
    servings: 4,
    idempotencyKey: "test-key",
    correlationId: "00000000-0000-4000-8000-000000000001",
    onEvent,
    signal: options.signal,
  });
}

afterEach(() => {
  jest.restoreAllMocks();
  Reflect.deleteProperty(global, "fetch");
});

describe("streamMealPlan SSE parsing", () => {
  test("includes servings in the generation query without changing the SSE request shape", async () => {
    installResponse(streamFromTextChunks([]));

    await readStream(jest.fn());

    const requestedUrl = new URL((global.fetch as jest.Mock).mock.calls[0][0]);
    expect(requestedUrl.searchParams.get("servings")).toBe("4");
    expect((global.fetch as jest.Mock).mock.calls[0][1]).toEqual(
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });

  test("dispatches a chunk-ending CR frame before another byte or EOF arrives", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let nextRead!: () => void;
    const waitingForNextChunk = new Promise<void>((resolve) => { nextRead = resolve; });
    const body = new ReadableStream<Uint8Array>({
      start(streamController) {
        controller = streamController;
        controller.enqueue(encoder.encode('data: {"step":1}\r\r'));
      },
      pull() { nextRead(); },
    }, { highWaterMark: 0 });
    const events: SseEvent[] = [];
    installResponse(body);
    const reading = readStream((event) => events.push(event));

    try {
      await waitingForNextChunk;
      expect(events).toEqual([{ event: "message", data: { step: 1 } }]);
      expect(body.locked).toBe(true);
      // An optional LF belongs to the already-consumed CR, not a new line.
      controller.enqueue(encoder.encode('\ndata: {"step":2}\r\n\r\n'));
    } finally {
      controller.close();
      await reading;
    }
    expect(events).toEqual([
      { event: "message", data: { step: 1 } },
      { event: "message", data: { step: 2 } },
    ]);
  });

  test.each([false, true])("counts both CRLF bytes toward the frame limit (split: %s)", async (split) => {
    const payload = "a".repeat(1024 * 1024 - 10);
    const chunks = (data: string) => split
      ? [`data: "${data}"\r`, "\n\r", "\n"]
      : [`data: "${data}"\r\n\r\n`];
    const events: SseEvent[] = [];
    installResponse(streamFromTextChunks(chunks(payload)));
    await readStream((event) => events.push(event));
    expect(events).toEqual([{ event: "message", data: payload }]);

    installResponse(streamFromTextChunks(chunks(`${payload}a`)));
    const onEvent = jest.fn();
    await expect(readStream(onEvent)).rejects.toThrow("SSE frame exceeds 1 MiB");
    expect(onEvent).not.toHaveBeenCalled();
  });

  test.each([
    [
      "CRLF",
      ["event: pha", "se\r", "", "\ndata: {\"message\":\"ok\"}\r", "\n\r", "\n"],
    ],
    ["LF", ["event: pha", "se\n", "data: {\"message\":\"ok\"}\n", "\n"]],
    ["CR", ["event: pha", "se\r", "data: {\"message\":\"ok\"}\r", "\r"]],
  ])("dispatches a frame with split %s line endings", async (_name, chunks) => {
    const body = streamFromTextChunks(chunks);
    const events: SseEvent[] = [];
    installResponse(body);

    await readStream((event) => events.push(event));

    expect(events).toEqual([{ event: "phase", data: { message: "ok" } }]);
    expect(body.locked).toBe(false);
  });

  test("ignores comment-only frames", async () => {
    const body = streamFromTextChunks([
      ": heartbeat\n\n",
      ": another comment\r\n\r\n",
      "event: phase\ndata: {\"message\":\"ready\"}\n\n",
    ]);
    const events: SseEvent[] = [];
    installResponse(body);

    await readStream((event) => events.push(event));

    expect(events).toEqual([{ event: "phase", data: { message: "ready" } }]);
  });

  test("joins multiline data fields before parsing application JSON", async () => {
    const body = streamFromTextChunks([
      "event: phase\n",
      "data: {\"message\":\n",
      "data: \"planning\"}\n\n",
    ]);
    const events: SseEvent[] = [];
    installResponse(body);

    await readStream((event) => events.push(event));

    expect(events).toEqual([
      { event: "phase", data: { message: "planning" } },
    ]);
  });

  test("decodes a UTF-8 code point split across chunks", async () => {
    const encoded = encoder.encode(
      "event: phase\ndata: {\"message\":\"café 🍲\"}\n\n",
    );
    const emojiStart = encoded.indexOf(0xf0);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.slice(0, emojiStart + 1));
        controller.enqueue(encoded.slice(emojiStart + 1, emojiStart + 3));
        controller.enqueue(encoded.slice(emojiStart + 3));
        controller.close();
      },
    });
    const events: SseEvent[] = [];
    installResponse(body);

    await readStream((event) => events.push(event));

    expect(events).toEqual([
      { event: "phase", data: { message: "café 🍲" } },
    ]);
  });

  test("rejects malformed application JSON with a fixed error", async () => {
    const cancel = jest.fn();
    const body = streamFromTextChunks(
      ["event: phase\ndata: {not-json}\n\n", "unused"],
      { cancel },
    );
    const onEvent = jest.fn();
    installResponse(body);

    await expect(readStream(onEvent)).rejects.toThrow("Invalid SSE event data");

    expect(onEvent).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });

  test("rejects a truncated frame at EOF without dispatching it", async () => {
    const body = streamFromTextChunks([
      "event: phase\ndata: {\"message\":\"partial\"}",
    ]);
    const onEvent = jest.fn();
    installResponse(body);

    await expect(readStream(onEvent)).rejects.toThrow(
      "SSE stream ended with an incomplete frame",
    );

    expect(onEvent).not.toHaveBeenCalled();
    expect(body.locked).toBe(false);
  });

  test("allows a 1 MiB frame and rejects the next UTF-8 byte", async () => {
    const limit = 1024 * 1024;
    const prefix = 'data: "';
    const suffix = '"';
    const exactPayload = "a".repeat(
      limit - encoder.encode(prefix + suffix).byteLength - 1,
    );
    const exactBody = streamFromTextChunks([
      `${prefix}${exactPayload}${suffix}\n\n`,
    ]);
    const events: SseEvent[] = [];
    installResponse(exactBody);

    await readStream((event) => events.push(event));

    expect(events).toEqual([{ event: "message", data: exactPayload }]);
    expect(exactBody.locked).toBe(false);

    const cancel = jest.fn();
    const oversizedBody = streamFromTextChunks(
      [`${prefix}${exactPayload}a${suffix}\n\n`, "unused"],
      { cancel },
    );
    installResponse(oversizedBody);

    await expect(readStream(jest.fn())).rejects.toThrow(
      "SSE frame exceeds 1 MiB",
    );

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(oversizedBody.locked).toBe(false);
  });
});

describe("streamMealPlan reader cleanup", () => {
  test("cancels and unlocks the reader when the callback throws", async () => {
    const callbackError = new Error("callback failed");
    const cancel = jest.fn();
    const body = streamFromTextChunks(
      ["data: {\"step\":1}\n\n", "data: {\"step\":2}\n\n"],
      { cancel },
    );
    installResponse(body);

    await expect(
      readStream(() => {
        throw callbackError;
      }),
    ).rejects.toBe(callbackError);

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });

  test("preserves the callback error when cancellation cleanup fails", async () => {
    const callbackError = new Error("callback failed");
    const cancel = jest.fn().mockRejectedValue(new Error("cleanup failed"));
    const body = streamFromTextChunks(
      ["data: {\"step\":1}\n\n", "data: {\"step\":2}\n\n"],
      { cancel },
    );
    installResponse(body);

    await expect(
      readStream(() => {
        throw callbackError;
      }),
    ).rejects.toBe(callbackError);

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });

  test("stops dispatching frames from the current chunk when aborted", async () => {
    const controller = new AbortController();
    const abortError = new DOMException("Stopped", "AbortError");
    const cancel = jest.fn();
    const body = streamFromTextChunks(
      [
        "data: {\"step\":1}\n\ndata: {\"step\":2}\n\n",
        "data: {\"step\":3}\n\n",
      ],
      { cancel },
    );
    const events: SseEvent[] = [];
    installResponse(body);

    await expect(
      readStream(
        (event) => {
          events.push(event);
          if (events.length === 1) controller.abort(abortError);
        },
        { signal: controller.signal },
      ),
    ).rejects.toBe(abortError);

    expect(events).toEqual([{ event: "message", data: { step: 1 } }]);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });
});
