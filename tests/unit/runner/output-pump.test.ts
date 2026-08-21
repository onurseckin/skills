import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import { pumpOutput } from "../../../orchestrating-long-tasks/scripts/src/runner/output-pump.ts";
import { OutputBudget } from "../../../orchestrating-long-tasks/scripts/src/runner/output-budget.ts";

function chunkStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

interface RecordingFile {
  handle: FileHandle;
  written: Buffer;
  synced: boolean;
}

function recordingFile(): RecordingFile {
  const chunks: Buffer[] = [];
  const state: RecordingFile = {
    handle: undefined as unknown as FileHandle,
    written: Buffer.alloc(0),
    synced: false,
  };
  state.handle = {
    write: async (buffer: Uint8Array, offset: number, length: number) => {
      const slice = Buffer.from(buffer).subarray(offset, offset + length);
      chunks.push(Buffer.from(slice));
      state.written = Buffer.concat(chunks);
      return { bytesWritten: slice.byteLength };
    },
    sync: async () => {
      state.synced = true;
    },
  } as unknown as FileHandle;
  return state;
}

describe("pumpOutput", () => {
  test("writes every chunk, tracks activity callbacks, and returns a digest summary", async () => {
    const file = recordingFile();
    const events: Array<{ text: string; bytes: number }> = [];
    const result = await pumpOutput(
      chunkStream(["hello ", "world"]),
      file.handle,
      "attempt-1/stdout.log",
      (text, bytes) => {
        events.push({ text, bytes });
      },
    );
    expect(file.written.toString("utf8")).toBe("hello world");
    expect(file.synced).toBe(true);
    expect(result).toEqual({
      path: "attempt-1/stdout.log",
      bytes: 11,
      sha256: createHash("sha256").update("hello world").digest("hex"),
    });
    expect(events).toEqual([
      { text: "hello ", bytes: 6 },
      { text: "world", bytes: 5 },
    ]);
  });

  test("supports an async activity callback", async () => {
    const file = recordingFile();
    const seen: string[] = [];
    await pumpOutput(chunkStream(["a", "b"]), file.handle, "path", async (text) => {
      await Promise.resolve();
      seen.push(text);
    });
    expect(seen).toEqual(["a", "b"]);
  });

  test("returns an empty summary for a stream that closes with no data", async () => {
    const file = recordingFile();
    const result = await pumpOutput(chunkStream([]), file.handle, "empty.log", () => undefined);
    expect(result).toEqual({
      path: "empty.log",
      bytes: 0,
      sha256: createHash("sha256").update("").digest("hex"),
    });
    expect(file.synced).toBe(true);
  });

  test("claims bytes against a supplied output budget", async () => {
    const file = recordingFile();
    const budget = new OutputBudget(3);
    await expect(
      pumpOutput(chunkStream(["hello"]), file.handle, "path", () => undefined, { budget }),
    ).rejects.toThrow("combined command output quota exceeded");
  });

  test("rejects immediately when the signal is already aborted before the first read", async () => {
    const file = recordingFile();
    const controller = new AbortController();
    controller.abort();
    await expect(
      pumpOutput(chunkStream(["hello"]), file.handle, "path", () => undefined, {
        signal: controller.signal,
      }),
    ).rejects.toThrow("command output collection aborted");
  });

  test("rejects on the next loop turn once the signal aborts between chunks", async () => {
    const file = recordingFile();
    const controller = new AbortController();
    const seen: string[] = [];
    const pending = pumpOutput(
      chunkStream(["first", "second"]),
      file.handle,
      "path",
      (text) => {
        seen.push(text);
        if (text === "first") controller.abort();
      },
      { signal: controller.signal },
    );
    await expect(pending).rejects.toThrow("command output collection aborted");
    // The second chunk is never reached because the abort check runs before the next read.
    expect(seen).toEqual(["first"]);
  });
});
