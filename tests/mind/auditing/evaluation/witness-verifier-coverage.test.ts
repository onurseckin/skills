import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { join, resolve } from "node:path";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import * as typesModule from "../../../../olt/scripts/src/mind/auditing/witness/types.ts";
import type { WitnessResolution } from "../../../../olt/scripts/src/mind/auditing/witness/types.ts";
import {
  readCommandOutput,
  verifyDefectWitness,
} from "../../../../olt/scripts/src/mind/auditing/witness/verifier.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("Mind Witness Verifier Test Suite", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;
  const spies: Array<{ mockRestore: () => void }> = [];

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    for (const spy of spies) spy.mockRestore();
    spies.length = 0;
    session.cleanup();
  });

  describe("readCommandOutput", () => {
    it("reads standard stdout.log and stderr.log files", () => {
      const root = resolve("/capsule/run-1");
      const stdoutPath = join(root, "commands", "cmd-1", "stdout.log");
      const stderrPath = join(root, "commands", "cmd-1", "stderr.log");

      vfs.mkdirSync(join(root, "commands", "cmd-1"), { recursive: true });
      vfs.writeFileSync(stdoutPath, "Standard Output Line");
      vfs.writeFileSync(stderrPath, "Standard Error Line");

      const resolution: WitnessResolution = {
        commandId: "cmd-1",
        capsuleRoot: root,
        recordPath: join(root, "commands", "cmd-1.json"),
        commandRecord: { command_id: "cmd-1" },
      };

      const res = readCommandOutput(resolution);
      expect(res.stdout).toBe("Standard Output Line");
      expect(res.stderr).toBe("Standard Error Line");
      expect(res.output).toBe("Standard Output Line\nStandard Error Line");
    });

    it("reads custom log paths from commandRecord (relative and absolute)", () => {
      const root = resolve("/capsule/run-2");
      const relOut = join(root, "custom-logs/out.txt");
      const absErr = "/absolute/logs/err.txt";

      vfs.mkdirSync(join(root, "custom-logs"), { recursive: true });
      vfs.mkdirSync("/absolute/logs", { recursive: true });
      vfs.writeFileSync(relOut, "Custom Stdout");
      vfs.writeFileSync(absErr, "Custom Stderr");

      const resolution: WitnessResolution = {
        commandId: "cmd-2",
        capsuleRoot: root,
        recordPath: join(root, "commands", "cmd-2.json"),
        commandRecord: {
          command_id: "cmd-2",
          logs: {
            stdout: { path: "custom-logs/out.txt" },
            stderr: { path: absErr },
          },
        },
      };

      const res = readCommandOutput(resolution);
      expect(res.stdout).toBe("Custom Stdout");
      expect(res.stderr).toBe("Custom Stderr");
      expect(res.output).toBe("Custom Stdout\nCustom Stderr");
    });

    it("falls back to attempt logs and breaks once output is found", () => {
      const root = resolve("/capsule/run-3");
      const attempt1Out = join(root, "attempt1/out.log");
      const attempt1Err = "/abs/attempt1/err.log";

      vfs.mkdirSync(join(root, "attempt1"), { recursive: true });
      vfs.mkdirSync("/abs/attempt1", { recursive: true });
      vfs.writeFileSync(attempt1Out, "Attempt 1 Stdout");
      vfs.writeFileSync(attempt1Err, "Attempt 1 Stderr");

      const resolution: WitnessResolution = {
        commandId: "cmd-3",
        capsuleRoot: root,
        recordPath: join(root, "commands", "cmd-3.json"),
        commandRecord: {
          command_id: "cmd-3",
          attempts: [
            { logs: { stdout: { path: "attempt1/out.log" }, stderr: { path: attempt1Err } } },
            { logs: { stdout: { path: "attempt2/out.log" } } },
          ],
        },
      };

      const res = readCommandOutput(resolution);
      expect(res.stdout).toBe("Attempt 1 Stdout");
      expect(res.stderr).toBe("Attempt 1 Stderr");
    });

    it("gracefully catches read errors and handles empty output", () => {
      const root = resolve("/capsule/run-4");
      const stdoutPath = join(root, "commands", "cmd-4", "stdout.log");

      vfs.mkdirSync(join(root, "commands", "cmd-4"), { recursive: true });
      vfs.writeFileSync(stdoutPath, "error content");

      spies.push(
        spyOn(vfs, "readFileSync").mockImplementation(() => {
          throw new Error("EIO disk error");
        }),
      );

      const resolution: WitnessResolution = {
        commandId: "cmd-4",
        capsuleRoot: root,
        recordPath: join(root, "commands", "cmd-4.json"),
        commandRecord: {
          command_id: "cmd-4",
          logs: { stdout: { path: "bad/out.log" }, stderr: { path: "bad/err.log" } },
          attempts: [{ logs: { stdout: { path: "bad/att.log" } } }],
        },
      };

      const res = readCommandOutput(resolution);
      expect(res.stdout).toBe("");
      expect(res.stderr).toBe("");
      expect(res.output).toBe("");
    });
  });

  describe("verifyDefectWitness", () => {
    it("successfully verifies failed command with non-zero exit_code and matching defect substring", () => {
      const root = resolve("/capsule/run-verified");
      vfs.mkdirSync(join(root, "commands", "cmd-fail-1"), { recursive: true });
      vfs.writeFileSync(
        join(root, "commands", "cmd-fail-1", "stdout.log"),
        "Error: NullReferenceException at Service.ts:42",
      );

      spies.push(
        spyOn(typesModule, "resolveWitnessCommand").mockReturnValue({
          commandId: "cmd-fail-1",
          capsuleRoot: root,
          recordPath: join(root, "commands/cmd-fail-1.json"),
          commandRecord: {
            command_id: "cmd-fail-1",
            exit_code: 1,
            status: "failed",
          },
        }),
      );

      const result = verifyDefectWitness("cmd-fail-1", root, "nullreferenceexception");
      expect(result.commandId).toBe("cmd-fail-1");
      expect(result.exitCode).toBe(1);
      expect(result.status).toBe("failed");
      expect(result.evidenceClass).toBe("harness_observed");
      expect(result.output).toContain("NullReferenceException");
    });

    it("derives exit code from attempts array when top-level exit_code is missing", () => {
      const root = resolve("/capsule/run-attempt");
      spies.push(
        spyOn(typesModule, "resolveWitnessCommand").mockReturnValue({
          commandId: "cmd-att-1",
          capsuleRoot: root,
          recordPath: join(root, "commands/cmd-att-1.json"),
          commandRecord: {
            command_id: "cmd-att-1",
            status: "timed_out",
            attempts: [{ exit_code: 124 }],
          },
        }),
      );

      const result = verifyDefectWitness("cmd-att-1", root);
      expect(result.exitCode).toBe(124);
      expect(result.status).toBe("timed_out");
    });

    it("defaults effective exit code to 1 when exit_code is omitted and status is not succeeded", () => {
      const root = resolve("/capsule/run-no-code");
      spies.push(
        spyOn(typesModule, "resolveWitnessCommand").mockReturnValue({
          commandId: "cmd-no-code",
          capsuleRoot: root,
          recordPath: join(root, "commands/cmd-no-code.json"),
          commandRecord: { command_id: "cmd-no-code" },
        }),
      );

      const result = verifyDefectWitness("cmd-no-code", root);
      expect(result.exitCode).toBe(1);
      expect(result.status).toBe("failed");
    });

    it("throws HarnessError when command exited with 0 or succeeded without exit code", () => {
      const root = resolve("/capsule/run-success");
      spies.push(
        spyOn(typesModule, "resolveWitnessCommand").mockImplementation((id) => ({
          commandId: id,
          capsuleRoot: root,
          recordPath: join(root, "commands", `${id}.json`),
          commandRecord:
            id === "cmd-zero"
              ? { command_id: "cmd-zero", exit_code: 0 }
              : { command_id: "cmd-succ", status: "succeeded" },
        })),
      );

      expect(() => verifyDefectWitness("cmd-zero", root)).toThrow(HarnessError);
      expect(() => verifyDefectWitness("cmd-succ", root)).toThrow(HarnessError);
    });

    it("throws HarnessError when expected defect substring is missing from command output", () => {
      const root = resolve("/capsule/run-mismatch");
      vfs.mkdirSync(join(root, "commands", "cmd-mismatch"), { recursive: true });
      vfs.writeFileSync(
        join(root, "commands", "cmd-mismatch", "stdout.log"),
        "Unrelated SyntaxError",
      );

      spies.push(
        spyOn(typesModule, "resolveWitnessCommand").mockReturnValue({
          commandId: "cmd-mismatch",
          capsuleRoot: root,
          recordPath: join(root, "commands/cmd-mismatch.json"),
          commandRecord: { command_id: "cmd-mismatch", exit_code: 1, status: "failed" },
        }),
      );

      expect(() => verifyDefectWitness("cmd-mismatch", root, "TypeError: expected")).toThrow(
        HarnessError,
      );
    });
  });
});
