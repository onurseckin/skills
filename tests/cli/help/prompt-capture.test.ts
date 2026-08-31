import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { capturePromptWithTimeout } from "../../../olt/scripts/src/cli/prompt-capture.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("capturePromptWithTimeout", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "prompt-cap-"));
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("should return inline text immediately if provided", async () => {
    const result = await capturePromptWithTimeout("inline prompt", {});
    expect(result).toBe("inline prompt");
  });

  it("should return file content if promptFile is provided", async () => {
    const filePath = join(tempDir, "test.txt");
    await writeFile(filePath, "file prompt content\n");
    const result = await capturePromptWithTimeout(undefined, { promptFile: filePath });
    expect(result).toBe("file prompt content");
  });

  it("should throw error if promptFile does not exist", async () => {
    const missingPath = join(tempDir, "missing.txt");
    await expect(capturePromptWithTimeout(undefined, { promptFile: missingPath })).rejects.toThrow(
      HarnessError,
    );
  });
});

type StreamHandler = (...args: unknown[]) => void;

describe("capturePromptWithTimeout - stdin", () => {
  let originalStdinOn: typeof process.stdin.on;
  let originalStdinOff: typeof process.stdin.off;
  let originalStdinResume: typeof process.stdin.resume;
  let originalStdinPause: typeof process.stdin.pause;

  beforeEach(() => {
    originalStdinOn = process.stdin.on;
    originalStdinOff = process.stdin.off;
    originalStdinResume = process.stdin.resume;
    originalStdinPause = process.stdin.pause;
  });

  afterEach(() => {
    process.stdin.on = originalStdinOn;
    process.stdin.off = originalStdinOff;
    process.stdin.resume = originalStdinResume;
    process.stdin.pause = originalStdinPause;
  });

  it("should timeout if stdin does not emit anything within timeoutMs", async () => {
    process.stdin.on = (() => process.stdin) as unknown as typeof process.stdin.on;
    process.stdin.off = (() => process.stdin) as unknown as typeof process.stdin.off;
    process.stdin.resume = (() => process.stdin) as unknown as typeof process.stdin.resume;
    process.stdin.pause = (() => process.stdin) as unknown as typeof process.stdin.pause;

    const promise = capturePromptWithTimeout(undefined, { timeoutMs: 50 });

    await expect(promise).rejects.toThrow(/timed out/);
  });

  it("should resolve if stdin emits data and ends", async () => {
    const handlers: Record<string, StreamHandler> = {};
    process.stdin.on = ((event: string, handler: StreamHandler) => {
      handlers[event] = handler;
      return process.stdin;
    }) as unknown as typeof process.stdin.on;
    process.stdin.off = (() => process.stdin) as unknown as typeof process.stdin.off;
    process.stdin.resume = (() => process.stdin) as unknown as typeof process.stdin.resume;
    process.stdin.pause = (() => process.stdin) as unknown as typeof process.stdin.pause;

    const promise = capturePromptWithTimeout(undefined, { timeoutMs: 100 });

    const handlerData = handlers["data"];
    if (handlerData) {
      handlerData(Buffer.from("stdin prompt\n"));
    }
    const handlerEnd = handlers["end"];
    if (handlerEnd) {
      handlerEnd();
    }

    const result = await promise;
    expect(result).toBe("stdin prompt");
  });

  it("should reject if stdin ends with empty prompt", async () => {
    const handlers: Record<string, StreamHandler> = {};
    process.stdin.on = ((event: string, handler: StreamHandler) => {
      handlers[event] = handler;
      return process.stdin;
    }) as unknown as typeof process.stdin.on;
    process.stdin.off = (() => process.stdin) as unknown as typeof process.stdin.off;
    process.stdin.resume = (() => process.stdin) as unknown as typeof process.stdin.resume;
    process.stdin.pause = (() => process.stdin) as unknown as typeof process.stdin.pause;

    const promise = capturePromptWithTimeout(undefined, { timeoutMs: 100 });

    const handlerData = handlers["data"];
    if (handlerData) {
      handlerData("   \n");
    }
    const handlerEnd = handlers["end"];
    if (handlerEnd) {
      handlerEnd();
    }

    await expect(promise).rejects.toThrow("received empty prompt from stdin");
  });

  it("should reject if stdin emits an error event", async () => {
    const handlers: Record<string, StreamHandler> = {};
    process.stdin.on = ((event: string, handler: StreamHandler) => {
      handlers[event] = handler;
      return process.stdin;
    }) as unknown as typeof process.stdin.on;
    process.stdin.off = (() => process.stdin) as unknown as typeof process.stdin.off;
    process.stdin.resume = (() => process.stdin) as unknown as typeof process.stdin.resume;
    process.stdin.pause = (() => process.stdin) as unknown as typeof process.stdin.pause;

    const promise = capturePromptWithTimeout(undefined, { timeoutMs: 100 });

    const handlerError = handlers["error"];
    if (handlerError) {
      handlerError(new Error("pipe broken"));
    }

    await expect(promise).rejects.toThrow("failed reading stdin: pipe broken");
  });
});
