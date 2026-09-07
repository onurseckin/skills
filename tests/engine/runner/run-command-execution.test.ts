import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import {
  executePreparedCommand,
  runCommand,
  setExecutionLockDependenciesForTesting,
} from "../../../olt/scripts/src/engine/runner/models/execution/run-command.ts";
import { createAgentMetadata } from "../../../olt/scripts/src/runtime/metadata.ts";
import {
  disableInMemoryAgentMetadata,
  enableInMemoryAgentMetadata,
  setInMemoryAgentMetadata,
} from "../../../olt/scripts/src/runtime/session.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import type { InternalCommandRunner } from "../../../olt/scripts/src/engine/runner/models/execution/internal-command-runner.ts";
import type {
  CommandResult,
  PreparedCommand,
} from "../../../olt/scripts/src/engine/runner/types/types.ts";
import { generateCanonicalDefaultPolicy } from "../../../olt/scripts/src/policy/generator/index.ts";
import {
  VirtualMemoryFS,
  createVirtualFSSession,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("engine/runner/models/execution/run-command.ts - Execution Pipeline", () => {
  let tempDir: string;
  let runRoot: string;
  let restoreDeps: (() => void) | undefined;
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession | null = null;

  beforeEach(() => {
    if (session) session.cleanup();
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
    enableInMemoryAgentMetadata();
    tempDir = "/virtual/run-cmd-exec";
    runRoot = join(tempDir, ".olt", "runs", "test-run");
    vfs.mkdirSync(tempDir, { recursive: true });
    vfs.mkdirSync(join(runRoot, "runtime"), { recursive: true });
    vfs.mkdirSync(join(tempDir, ".olt", ".locks"), { recursive: true });
    vfs.writeFileSync(
      join(tempDir, ".olt", "policy.json"),
      JSON.stringify(generateCanonicalDefaultPolicy(tempDir, "bun")),
    );
  });

  afterEach(() => {
    if (restoreDeps) {
      restoreDeps();
      restoreDeps = undefined;
    }
    disableInMemoryAgentMetadata();
    if (session) {
      session.cleanup();
      session = null;
    }
  });

  describe("executePreparedCommand and runCommand", () => {
    it("executes prepared command with mutex locking and releases cleanly", async () => {
      const mockResult: CommandResult = {
        exitCode: 0,
        stdout: "success output",
        stderr: "",
        durationMs: 10,
        commandRecord: {} as CommandResult["commandRecord"],
      };

      const mockRunner: InternalCommandRunner = {
        prepareCommand: async (input) => ({
          commandRecord: {} as PreparedCommand["commandRecord"],
          options: {
            actor: input.actor,
            argv: input.argv,
            cwd: tempDir,
            repositoryRoot: tempDir,
            runRoot,
          },
        }),
        executePreparedCommand: async () => mockResult,
      };

      const prepared: PreparedCommand = {
        commandRecord: {} as PreparedCommand["commandRecord"],
        options: {
          actor: "worker-1",
          argv: ["bun", "test"],
          cwd: tempDir,
          repositoryRoot: tempDir,
          runRoot,
        },
      };

      const result = await executePreparedCommand(prepared, mockRunner);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("success output");
    });

    it("propagates runner execution error while executing cleanup", async () => {
      const mockRunner: InternalCommandRunner = {
        prepareCommand: async (input) => ({
          commandRecord: {} as PreparedCommand["commandRecord"],
          options: {
            actor: input.actor,
            argv: input.argv,
            cwd: tempDir,
            repositoryRoot: tempDir,
            runRoot,
          },
        }),
        executePreparedCommand: async () => {
          throw new Error("Runner subprocess failure");
        },
      };

      const prepared: PreparedCommand = {
        commandRecord: {} as PreparedCommand["commandRecord"],
        options: {
          actor: "worker-1",
          argv: ["bun", "test"],
          cwd: tempDir,
          repositoryRoot: tempDir,
          runRoot,
        },
      };

      await expect(executePreparedCommand(prepared, mockRunner)).rejects.toThrow(
        "Runner subprocess failure",
      );
    });

    it("throws cleanup failure when runner succeeds but cleanup fails", async () => {
      const mockResult: CommandResult = {
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        durationMs: 1,
        commandRecord: {} as CommandResult["commandRecord"],
      };

      const mockRunner: InternalCommandRunner = {
        prepareCommand: async (input) => ({
          commandRecord: {} as PreparedCommand["commandRecord"],
          options: {
            actor: input.actor,
            argv: input.argv,
            cwd: tempDir,
            repositoryRoot: tempDir,
            runRoot,
          },
        }),
        executePreparedCommand: async () => mockResult,
      };

      restoreDeps = setExecutionLockDependenciesForTesting({
        releaseFlock: () => {
          throw new Error("Cleanup release error");
        },
      });

      const prepared: PreparedCommand = {
        commandRecord: {} as PreparedCommand["commandRecord"],
        options: {
          actor: "worker-1",
          argv: ["bun", "test"],
          cwd: tempDir,
          repositoryRoot: tempDir,
          runRoot,
        },
      };

      await expect(executePreparedCommand(prepared, mockRunner)).rejects.toThrow(HarnessError);
    });

    it("throws primary error when both runner and cleanup fail", async () => {
      const mockRunner: InternalCommandRunner = {
        prepareCommand: async (input) => ({
          commandRecord: {} as PreparedCommand["commandRecord"],
          options: {
            actor: input.actor,
            argv: input.argv,
            cwd: tempDir,
            repositoryRoot: tempDir,
            runRoot,
          },
        }),
        executePreparedCommand: async () => {
          throw new Error("Primary failure");
        },
      };

      restoreDeps = setExecutionLockDependenciesForTesting({
        releaseFlock: () => {
          throw new Error("Cleanup failure");
        },
      });

      const prepared: PreparedCommand = {
        commandRecord: {} as PreparedCommand["commandRecord"],
        options: {
          actor: "worker-1",
          argv: ["bun", "test"],
          cwd: tempDir,
          repositoryRoot: tempDir,
          runRoot,
        },
      };

      await expect(executePreparedCommand(prepared, mockRunner)).rejects.toThrow("Primary failure");
    });

    it("runs complete runCommand pipeline end to end", async () => {
      const meta = createAgentMetadata({
        agent_id: "worker-e2e",
        role: "implementer",
        write_scope: ["."],
        can_execute_shell: true,
      });
      const metaPath = join(runRoot, "runtime", "agent-worker-e2e.json");
      setInMemoryAgentMetadata(metaPath, JSON.stringify(meta, null, 2));
      vfs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

      const mockResult: CommandResult = {
        exitCode: 0,
        stdout: "e2e ok",
        stderr: "",
        durationMs: 5,
        commandRecord: {} as CommandResult["commandRecord"],
      };

      const mockRunner: InternalCommandRunner = {
        prepareCommand: async (input) => ({
          commandRecord: {} as PreparedCommand["commandRecord"],
          options: {
            actor: input.actor,
            argv: input.argv,
            cwd: tempDir,
            repositoryRoot: tempDir,
            runRoot,
          },
        }),
        executePreparedCommand: async () => mockResult,
      };

      const result = await runCommand(
        {
          actor: "worker-e2e",
          argv: ["bun", "test", "tests/engine/runner/runner.test.ts"],
          repositoryRoot: tempDir,
        },
        mockRunner,
      );

      expect(result.stdout).toBe("e2e ok");
    });
  });
});
