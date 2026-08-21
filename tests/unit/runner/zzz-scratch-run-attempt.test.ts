import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCommandSigningCapability } from "../../../orchestrating-long-tasks/scripts/src/runner/attempt-disposition-capability.ts";
import { OWNERSHIP_ENV } from "../../../orchestrating-long-tasks/scripts/src/runner/pipe-ownership.ts";
import { runAttempt } from "../../../orchestrating-long-tasks/scripts/src/runner/run-attempt.ts";
import type {
  BunSpawnApi,
  NormalizedCommandOptions,
} from "../../../orchestrating-long-tasks/scripts/src/runner/types.ts";

function textStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe("scratch", () => {
  test("fake successful spawn", async () => {
    const root = await mkdtemp(join(tmpdir(), "scratch-run-attempt-"));
    try {
      const commandRoot = join(root, "commands", "C-1");
      await mkdir(commandRoot, { recursive: true });
      const ownershipToken = "12345678-1234-4234-8234-123456789abc";
      const options: NormalizedCommandOptions = {
        argv: ["fake"],
        cwd: root,
        repositoryRoot: root,
        commandDir: join(root, "commands"),
        runRoot: root,
        actor: "validator",
        wallTimeoutMs: 5000,
        idleTimeoutMs: 5000,
        graceMs: 10,
        drainTimeoutMs: 200,
        heartbeatIntervalMs: 5000,
        maxOutputBytes: 1024,
        retries: 0,
        idempotent: false,
        environment: { [OWNERSHIP_ENV]: ownershipToken },
      };
      const fakeSpawnApi: BunSpawnApi = {
        spawn: () => ({
          pid: 999_999_999,
          exited: Promise.resolve(0),
          signalCode: null,
          stdout: textStream(["hello\n"]),
          stderr: textStream([]),
        }),
      };
      const result = await runAttempt(
        options,
        1,
        "C-1",
        commandRoot,
        createCommandSigningCapability(),
        fakeSpawnApi,
      );
      console.log("SUCCESS RESULT", JSON.stringify(result, null, 2));
    } catch (error) {
      console.log("ERROR", error);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 10000);
});
