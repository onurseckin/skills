import { describe, it, expect, mock, spyOn, beforeEach, afterEach } from "bun:test";
import { capturePromptWithTimeout } from "../../../olt/scripts/src/cli/prompt-capture.ts";
import { HarnessError } from "../../../olt/scripts/src/errors/harness-error.ts";
import * as fs from "node:fs";

mock.module("node:fs", () => ({
  existsSync: mock(() => false),
  readFileSync: mock(() => ""),
}));

describe("capturePromptWithTimeout", () => {
  beforeEach(() => {
    mock.restore();
  });

  it("should return inline text immediately if provided", async () => {
    const result = await capturePromptWithTimeout("inline prompt", {});
    expect(result).toBe("inline prompt");
  });

  it("should return file content if promptFile is provided", async () => {
    const existsSyncMock = mock(() => true);
    const readFileSyncMock = mock(() => "file prompt content\n");

    mock.module("node:fs", () => ({
      existsSync: existsSyncMock,
      readFileSync: readFileSyncMock,
    }));

    const result = await capturePromptWithTimeout(undefined, { promptFile: "test.txt" });
    expect(result).toBe("file prompt content");
  });

  it("should throw error if promptFile does not exist", async () => {
    const existsSyncMock = mock(() => false);

    mock.module("node:fs", () => ({
      existsSync: existsSyncMock,
      readFileSync: mock(() => ""),
    }));

    await expect(
      capturePromptWithTimeout(undefined, { promptFile: "missing.txt" }),
    ).rejects.toThrow(HarnessError);
  });
});

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
    process.stdin.on = mock(() => process.stdin) as unknown as typeof process.stdin.on;
    process.stdin.off = mock(() => process.stdin) as unknown as typeof process.stdin.off;
    process.stdin.resume = mock(() => process.stdin) as unknown as typeof process.stdin.resume;
    process.stdin.pause = mock(() => process.stdin) as unknown as typeof process.stdin.pause;

    const promise = capturePromptWithTimeout(undefined, { timeoutMs: 100 });
    // wait for timeout

    await expect(promise).rejects.toThrow(/timed out/);
  });

  it("should resolve if stdin emits data and ends", async () => {
    const handlers: Record<string, Function> = {};
    process.stdin.on = mock((event, handler) => {
      handlers[event as string] = handler as Function;
      return process.stdin;
    }) as unknown as typeof process.stdin.on;
    process.stdin.off = mock(() => process.stdin) as unknown as typeof process.stdin.off;
    process.stdin.resume = mock(() => process.stdin) as unknown as typeof process.stdin.resume;
    process.stdin.pause = mock(() => process.stdin) as unknown as typeof process.stdin.pause;

    const promise = capturePromptWithTimeout(undefined, { timeoutMs: 100 });

    // simulate data
    const handlerData = handlers["data"];
    if (handlerData) {
      handlerData("stdin prompt\n");
    }
    const handlerEnd = handlers["end"];
    if (handlerEnd) {
      handlerEnd();
    }

    const result = await promise;
    expect(result).toBe("stdin prompt");
  });
});
