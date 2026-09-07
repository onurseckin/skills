import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { join } from "node:path";
import type {
  CommandAttemptRecord,
  RepositoryBinding,
} from "../../../olt/scripts/src/core/contracts/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import * as commandRecordSize from "../../../olt/scripts/src/engine/runner/models/command/command-record-size.ts";
import {
  MAX_COMMAND_ATTEMPTS,
  MAX_COMMAND_ATTEMPT_BYTES,
  MAX_COMMAND_INTENT_BYTES,
  MAX_COMMAND_RECORD_BYTES,
  MAX_EVIDENCE_ERROR_BYTES,
} from "../../../olt/scripts/src/engine/runner/models/command/command-record-size.ts";
import { createInternalCommandRunner } from "../../../olt/scripts/src/engine/runner/models/execution/internal-command-runner.ts";
import type { AttemptResult } from "../../../olt/scripts/src/engine/runner/types/types.ts";
import type { VirtualMemoryFS } from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import { cleanupVirtualRunnerFS, setupVirtualRunnerFS, tempRoot } from "../command/fixture.ts";

let vfs: VirtualMemoryFS;

beforeEach(() => {
  vfs = setupVirtualRunnerFS();
});

afterEach(cleanupVirtualRunnerFS);

const digest = (marker: string): string => marker.repeat(64);

function binding(marker = "a"): RepositoryBinding {
  return {
    schema: "harness.repository-binding",
    version: 1,
    inspection_sha256: digest(marker),
    git_identity_sha256: digest(marker),
    content_sha256: digest(marker),
    file_count: 1,
    total_bytes: 17,
  };
}

function attemptResult(id: string, attempt: number, transient = false): AttemptResult {
  const empty = { path: "empty", bytes: 0, sha256: digest("e") };
  const record: CommandAttemptRecord = {
    id,
    attempt,
    status: transient ? "failed" : "succeeded",
    started_at: "2026-08-14T00:00:00.000Z",
    finished_at: "2026-08-14T00:00:01.000Z",
    exit_code: transient ? 1 : 0,
    signal: null,
    signals_sent: [],
    timeout_kind: null,
    failure_class: transient ? "network_transient" : null,
    activity_path: "empty",
    activity: empty,
    logs: { stdout: empty, stderr: empty },
  };
  return {
    record,
    attempt,
    ...(transient ? { failureClass: "network_transient" as const } : {}),
    stdoutPath: "empty",
    stderrPath: "empty",
    activityPath: "empty",
    outputTail: "",
  };
}

function fixture(label: string) {
  const root = tempRoot(label);
  vfs.mkdirSync(join(root, "bin"), { recursive: true });
  vfs.mkdirSync(join(root, ".olt", "capsules", "commands"), { recursive: true });
  vfs.writeFileSync(join(root, "bin", "verify"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  return {
    root,
    input: {
      argv: ["./bin/verify"],
      cwd: root,
      runRoot: join(root, ".olt", "capsules"),
      commandDir: join(root, ".olt", "capsules", "commands"),
      actor: "validator" as const,
      taskId: "T-observed",
      gateId: "G-observed",
      retries: 1,
      idempotent: true,
      maxOutputBytes: 4096,
      wallTimeoutMs: 5000,
      idleTimeoutMs: 4000,
      graceMs: 3000,
      drainTimeoutMs: 2000,
      heartbeatIntervalMs: 1000,
    },
  };
}

describe("command runtime boundary limits and error handling", () => {
  test("reserves terminal headroom and bounds evidence errors", async () => {
    const { input } = fixture("command-intent-headroom");
    expect(
      MAX_COMMAND_INTENT_BYTES +
        (MAX_COMMAND_ATTEMPTS + 1) * MAX_COMMAND_ATTEMPT_BYTES +
        MAX_EVIDENCE_ERROR_BYTES,
    ).toBeLessThan(MAX_COMMAND_RECORD_BYTES);

    const intentSpy = spyOn(commandRecordSize, "assertCommandIntentSize").mockImplementation(
      (record) => {
        if (record.argv?.[1]?.length > 2000) {
          throw new HarnessError("INVALID_STATE", "command intent exceeds size limit");
        }
      },
    );

    try {
      const runner = createInternalCommandRunner({
        inspectRepository: () => binding(),
        attempt: async () => {
          throw new Error("\0".repeat(MAX_EVIDENCE_ERROR_BYTES));
        },
      });
      await expect(
        runner.prepareCommand({
          ...input,
          argv: ["tool", "x".repeat(3000)],
          gateId: undefined,
          retries: 0,
        }),
      ).rejects.toThrow(/intent.*size|size.*limit/i);
      expect(vfs.readdirSync(input.commandDir)).toEqual([]);

      const prepared = await runner.prepareCommand({
        ...input,
        argv: ["tool", "safe"],
        gateId: undefined,
        retries: 0,
      });
      await expect(runner.executePreparedCommand(prepared)).rejects.toThrow();
      const storedText = vfs.readFileSync(prepared.recordPath, "utf8");
      const stored = JSON.parse(storedText);
      expect(new TextEncoder().encode(stored.evidence_error).byteLength).toBeLessThanOrEqual(
        MAX_EVIDENCE_ERROR_BYTES,
      );
      expect(Buffer.byteLength(storedText)).toBeLessThanOrEqual(MAX_COMMAND_RECORD_BYTES);
    } finally {
      intentSpy.mockRestore();
    }
  });

  test("enforces non-idempotent command policy by disallowing retries on transient failures", async () => {
    const { input } = fixture("command-non-idempotent");
    let attemptsCount = 0;
    const runner = createInternalCommandRunner({
      inspectRepository: () => binding(),
      attempt: async (_options, attempt, id) => {
        attemptsCount++;
        return attemptResult(id, attempt, true);
      },
    });
    const prepared = await runner.prepareCommand({
      ...input,
      retries: 2,
      idempotent: false,
    });
    const result = await runner.executePreparedCommand(prepared);
    expect(attemptsCount).toBe(1);
    expect(result.attempts).toHaveLength(1);
    expect(result.record.status).toBe("failed");
    expect(result.record.retry_exhausted).toBe(false);
  });

  test("handles zero-byte or empty output tails safely", async () => {
    const { input } = fixture("command-empty-output-tail");
    const runner = createInternalCommandRunner({
      inspectRepository: () => binding(),
      attempt: async (_options, attempt, id) => {
        const res = attemptResult(id, attempt, false);
        res.outputTail = "";
        return res;
      },
    });
    const prepared = await runner.prepareCommand({ ...input, retries: 0 });
    const result = await runner.executePreparedCommand(prepared);
    expect(result.record.status).toBe("succeeded");
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]?.outputTail).toBe("");
  });
});
