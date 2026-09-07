/**
 * @file test-runner.test.ts
 * Unit tests for test-runner script with 100% in-memory virtual filesystem mocking.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as childProcess from "node:child_process";
import { join } from "node:path";
import { createSpawnMock } from "../../testing/runner/index.ts";
import {
  createVirtualFSSession,
  type VirtualFSSession,
  VirtualMemoryFS,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("test-runner script (in-memory virtual)", () => {
  const runnerScript = join(process.cwd(), "scripts/testing/test-runner.ts");
  let vfsSession: VirtualFSSession;
  let exitSpy: ReturnType<typeof spyOn>;
  let logSpy: ReturnType<typeof spyOn>;
  let recordedExitCode: number | undefined;

  beforeEach(() => {
    vfsSession = createVirtualFSSession(new VirtualMemoryFS());
    recordedExitCode = undefined;
    exitSpy = spyOn(process, "exit").mockImplementation((code) => {
      recordedExitCode = typeof code === "number" ? code : 0;
      return undefined as never;
    });
    logSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    logSpy.mockRestore();
    vfsSession.cleanup();
  });

  test("runs in-process to cover test-runner module evaluation with mocked spawn", async () => {
    const origArgv = [...process.argv];
    process.argv = ["bun", runnerScript, "tests/scripts/testing/test-runner.test.ts"];

    const spawnSpy = spyOn(childProcess, "spawn").mockImplementation(createSpawnMock());

    try {
      const { main: runMain } = await import("../../../scripts/testing/test-runner.ts");
      await runMain();
      await new Promise((resolve) => setTimeout(resolve, 25));
    } finally {
      process.argv = origArgv;
      spawnSpy.mockRestore();
    }

    expect(recordedExitCode).toBe(0);
  });
});
