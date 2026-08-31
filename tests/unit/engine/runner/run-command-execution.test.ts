import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync, mkdtempSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  prepareCommand,
  executePreparedCommand,
  runCommand,
  isBroadScopeTest,
  acquireMutexLock,
  setExecutionLockDependenciesForTesting,
  readOwnDataString,
  isTrustedEnoent,
} from "../../../../olt/scripts/src/engine/runner/models/execution/run-command.ts";
import { activeExecutionRootInodes } from "../../../../olt/scripts/src/engine/runner/models/execution/run-command-lock-deps.ts";
import { resolveScratchDir } from "../../../../olt/scripts/src/core/shared/paths.ts";
import { createAgentMetadata } from "../../../../olt/scripts/src/runtime/metadata.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import type { InternalCommandRunner } from "../../../../olt/scripts/src/engine/runner/models/execution/internal-command-runner.ts";
import type {
  CommandOptions,
  CommandResult,
  PreparedCommand,
} from "../../../../olt/scripts/src/engine/runner/types/types.ts";
import type { Stats } from "node:fs";

describe("engine/runner/models/execution/run-command.ts & run-command-lock.ts", () => {
  let tempDir: string;
  let runRoot: string;
  let restoreDeps: (() => void) | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "run-command-test-"));
    runRoot = join(tempDir, ".olt", "runs", "test-run");
    mkdirSync(join(runRoot, "runtime"), { recursive: true });
    mkdirSync(join(tempDir, ".olt", ".locks"), { recursive: true });
  });

  afterEach(() => {
    if (restoreDeps) {
      restoreDeps();
      restoreDeps = undefined;
    }
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("readOwnDataString & isTrustedEnoent", () => {
    it("handles primitives, objects, and missing properties correctly", () => {
      expect(readOwnDataString(null, "code")).toBeNull();
      expect(readOwnDataString(undefined, "code")).toBeNull();
      expect(readOwnDataString("string", "code")).toBeNull();
      expect(readOwnDataString(123, "code")).toBeNull();
      expect(readOwnDataString({}, "code")).toBeNull();
      expect(readOwnDataString({ code: 123 }, "code")).toBeNull();
      expect(readOwnDataString({ code: "ENOENT" }, "code")).toBe("ENOENT");

      const throwingProxy = new Proxy(
        {},
        {
          getOwnPropertyDescriptor() {
            throw new Error("Proxy descriptor failure");
          },
        },
      );
      expect(readOwnDataString(throwingProxy, "code")).toBeNull();

      const enoentErr = new Error("File not found");
      Object.defineProperty(enoentErr, "code", { value: "ENOENT" });
      expect(isTrustedEnoent(enoentErr)).toBe(true);

      const epermErr = new Error("Permission denied");
      Object.defineProperty(epermErr, "code", { value: "EPERM" });
      expect(isTrustedEnoent(epermErr)).toBe(false);
      expect(isTrustedEnoent("ENOENT")).toBe(false);
      expect(isTrustedEnoent(null)).toBe(false);
    });
  });

  describe("isBroadScopeTest", () => {
    it("returns false for empty argv or unsupported executables", () => {
      expect(isBroadScopeTest([])).toBe(false);
      expect(isBroadScopeTest(["echo", "hello"])).toBe(false);
      expect(isBroadScopeTest(["git", "status"])).toBe(false);
    });

    it("returns false when command is not test or build and not pytest/vitest", () => {
      expect(isBroadScopeTest(["bun", "run"])).toBe(false);
      expect(isBroadScopeTest(["npm", "install"])).toBe(false);
    });

    it("returns true for broad-scope test commands without file path operands", () => {
      expect(isBroadScopeTest(["pytest"])).toBe(true);
      expect(isBroadScopeTest(["vitest"])).toBe(true);
      expect(isBroadScopeTest(["bun", "test"])).toBe(true);
      expect(isBroadScopeTest(["npm", "test"])).toBe(true);
      expect(isBroadScopeTest(["cargo", "test"])).toBe(true);
      expect(isBroadScopeTest(["pnpm", "build"])).toBe(true);
      expect(isBroadScopeTest(["yarn", "test", "--coverage"])).toBe(true);
      expect(isBroadScopeTest(["bun", "test", "--filter", "unit"])).toBe(true);
    });

    it("returns false when a specific file path operand is supplied", () => {
      expect(isBroadScopeTest(["bun", "test", "tests/unit/test.ts"])).toBe(false);
      expect(isBroadScopeTest(["pytest", "tests/test_app.py"])).toBe(false);
      expect(isBroadScopeTest(["vitest", "./src/index.test.ts"])).toBe(false);
      expect(isBroadScopeTest(["npm", "test", "src/foo.js"])).toBe(false);
    });
  });

  describe("prepareCommand", () => {
    function setupAgentMetadata(agentId: string, role: string, canExecuteShell = true) {
      const meta = createAgentMetadata({
        agent_id: agentId,
        role,
        write_scope: ["."],
        can_execute_shell: canExecuteShell,
      });
      writeFileSync(
        join(runRoot, "runtime", `agent-${agentId}.json`),
        JSON.stringify(meta, null, 2),
      );
    }

    it("throws error if agent metadata is not found", async () => {
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
        executePreparedCommand: async () => ({
          exitCode: 0,
          stdout: "",
          stderr: "",
          durationMs: 0,
          commandRecord: {} as CommandResult["commandRecord"],
        }),
      };

      const opts: CommandOptions = {
        actor: "ghost-agent",
        argv: ["bun", "test"],
        repositoryRoot: tempDir,
      };

      await expect(prepareCommand(opts, mockRunner)).rejects.toThrow(
        "[ROLE_BOUNDARY_VIOLATION] Cannot find AgentMetadata for actor: ghost-agent",
      );
    });

    it("throws error if agent command authorization fails", async () => {
      setupAgentMetadata("restricted-worker", "critic");

      const mockRunner: InternalCommandRunner = {
        prepareCommand: async (input) => ({
          commandRecord: {} as PreparedCommand["commandRecord"],
          options: {
            actor: input.actor,
            argv: ["git", "commit", "-m", "illegal"],
            cwd: tempDir,
            repositoryRoot: tempDir,
            runRoot,
          },
        }),
        executePreparedCommand: async () => ({
          exitCode: 0,
          stdout: "",
          stderr: "",
          durationMs: 0,
          commandRecord: {} as CommandResult["commandRecord"],
        }),
      };

      const opts: CommandOptions = {
        actor: "restricted-worker",
        argv: ["git", "commit", "-m", "illegal"],
        repositoryRoot: tempDir,
      };

      await expect(prepareCommand(opts, mockRunner)).rejects.toThrow();
    });

    it("prepares valid non-gate command and writes signed receipt", async () => {
      setupAgentMetadata("worker-1", "implementer");

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
        executePreparedCommand: async () => ({
          exitCode: 0,
          stdout: "",
          stderr: "",
          durationMs: 0,
          commandRecord: {} as CommandResult["commandRecord"],
        }),
      };

      const opts: CommandOptions = {
        actor: "worker-1",
        argv: ["bun", "test", "tests/unit/sample.test.ts"],
        repositoryRoot: tempDir,
      };

      const prepared = await prepareCommand(opts, mockRunner);
      expect(prepared.options.actor).toBe("worker-1");
      expect(prepared.options.argv).toEqual(["bun", "test", "tests/unit/sample.test.ts"]);

      const scratchDir = resolveScratchDir(tempDir);
      const evidenceDir = join(scratchDir, "evidence");
      expect(existsSync(evidenceDir)).toBe(true);
    });

    it("skips signed receipt when gateId is present", async () => {
      setupAgentMetadata("gate-worker", "implementer");

      const mockRunner: InternalCommandRunner = {
        prepareCommand: async (input) => ({
          commandRecord: {} as PreparedCommand["commandRecord"],
          options: {
            actor: input.actor,
            argv: input.argv,
            cwd: tempDir,
            repositoryRoot: tempDir,
            runRoot,
            gateId: "gate-run-test",
          },
        }),
        executePreparedCommand: async () => ({
          exitCode: 0,
          stdout: "",
          stderr: "",
          durationMs: 0,
          commandRecord: {} as CommandResult["commandRecord"],
        }),
      };

      const opts: CommandOptions = {
        actor: "gate-worker",
        argv: ["bun", "test", "tests/unit/sample.test.ts"],
        repositoryRoot: tempDir,
        gateId: "gate-run-test",
      };

      const prepared = await prepareCommand(opts, mockRunner);
      expect(prepared.options.gateId).toBe("gate-run-test");
    });
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
      writeFileSync(
        join(runRoot, "runtime", "agent-worker-e2e.json"),
        JSON.stringify(meta, null, 2),
      );

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
          argv: ["bun", "test", "tests/unit/test.ts"], // non-broad scope test
          repositoryRoot: tempDir,
        },
        mockRunner,
      );

      expect(result.stdout).toBe("e2e ok");
    });
  });

  describe("acquireMutexLock edge cases and error handling", () => {
    it("returns noop callback for non-broad scope commands", () => {
      const cleanup = acquireMutexLock(tempDir, ["echo", "test"]);
      expect(typeof cleanup).toBe("function");
      cleanup(); // noop
    });

    it("throws LOCK_TIMEOUT when lock is already active in current process", () => {
      const cleanup1 = acquireMutexLock(tempDir, ["bun", "test"]);
      expect(() => acquireMutexLock(tempDir, ["bun", "test"])).toThrow(HarnessError);
      cleanup1();
    });

    it("throws LOCK_TIMEOUT when repository execution authority is already active in process", () => {
      const realRootStat = statSync(tempDir);
      const rootInode = `${realRootStat.dev}:${realRootStat.ino}`;
      activeExecutionRootInodes.add(rootInode);

      try {
        expect(() => acquireMutexLock(tempDir, ["bun", "test"])).toThrow(HarnessError);
      } finally {
        activeExecutionRootInodes.delete(rootInode);
      }
    });

    it("handles double-release cleanly without error", () => {
      const cleanup = acquireMutexLock(tempDir, ["bun", "test"]);
      cleanup();
      expect(() => cleanup()).not.toThrow();
    });

    it("throws and cleans up when root directory tryExclusiveFlock returns false", () => {
      restoreDeps = setExecutionLockDependenciesForTesting({
        tryExclusiveFlock: () => false,
      });

      expect(() => acquireMutexLock(tempDir, ["bun", "test"])).toThrow(HarnessError);
    });

    it("throws and cleans up when lock file tryExclusiveFlock returns false", () => {
      let callCount = 0;
      restoreDeps = setExecutionLockDependenciesForTesting({
        tryExclusiveFlock: () => {
          callCount++;
          // First call is root directory flock (succeed), second is lock file flock (fail)
          return callCount === 1;
        },
      });

      expect(() => acquireMutexLock(tempDir, ["bun", "test"])).toThrow(HarnessError);
    });

    it("throws when repository root is not a real directory", () => {
      restoreDeps = setExecutionLockDependenciesForTesting({
        lstat: () =>
          ({
            isDirectory: () => false,
            isFile: () => true,
            isSymbolicLink: () => false,
            dev: 1,
            ino: 1,
          }) as unknown as Stats,
      });

      expect(() => acquireMutexLock(tempDir, ["bun", "test"])).toThrow(HarnessError);
    });

    it("throws when opened repository root fstat reports non-directory", () => {
      restoreDeps = setExecutionLockDependenciesForTesting({
        fstat: () =>
          ({
            isDirectory: () => false,
            isFile: () => true,
            isSymbolicLink: () => false,
            dev: 1,
            ino: 1,
          }) as unknown as Stats,
      });

      expect(() => acquireMutexLock(tempDir, ["bun", "test"])).toThrow(HarnessError);
    });

    it("throws when directory identity shifts between checks (symlink race simulation)", () => {
      let fstatCount = 0;
      restoreDeps = setExecutionLockDependenciesForTesting({
        fstat: () => {
          fstatCount++;
          return {
            isDirectory: () => true,
            isFile: () => false,
            isSymbolicLink: () => false,
            dev: 999,
            ino: fstatCount, // changing inode
          } as unknown as Stats;
        },
      });

      expect(() => acquireMutexLock(tempDir, ["bun", "test"])).toThrow(HarnessError);
    });

    it("throws when repositoryAfter identity differs from opened repository root", () => {
      let lstatCount = 0;
      restoreDeps = setExecutionLockDependenciesForTesting({
        lstat: () => {
          lstatCount++;
          return {
            isDirectory: () => true,
            isFile: () => false,
            isSymbolicLink: () => false,
            dev: 1,
            ino: lstatCount === 2 ? 9999 : 1,
          } as unknown as Stats;
        },
        fstat: () =>
          ({
            isDirectory: () => true,
            isFile: () => false,
            isSymbolicLink: () => false,
            dev: 1,
            ino: 1,
          }) as unknown as Stats,
      });

      expect(() => acquireMutexLock(tempDir, ["bun", "test"])).toThrow(HarnessError);
    });

    it("throws and translates error when lock release fails on descriptor or root", () => {
      let releaseCount = 0;
      restoreDeps = setExecutionLockDependenciesForTesting({
        releaseFlock: () => {
          releaseCount++;
          if (releaseCount === 2) {
            throw new Error("Root flock release failure simulation");
          }
        },
      });

      const cleanup = acquireMutexLock(tempDir, ["bun", "test"]);
      expect(() => cleanup()).toThrow(HarnessError);
    });

    it("throws when root close fails during release", () => {
      let closeCount = 0;
      restoreDeps = setExecutionLockDependenciesForTesting({
        close: () => {
          closeCount++;
          if (closeCount === 2) {
            throw new Error("Root close failure simulation");
          }
        },
      });

      const cleanup = acquireMutexLock(tempDir, ["bun", "test"]);
      expect(() => cleanup()).toThrow(HarnessError);
    });

    it("throws when mkdirLockDirectory fails", () => {
      restoreDeps = setExecutionLockDependenciesForTesting({
        mkdirLockDirectory: () => {
          throw new Error("mkdir failure");
        },
      });

      expect(() => acquireMutexLock(tempDir, ["bun", "test"])).toThrow(HarnessError);
    });

    it("throws when opened lock file is not a regular file", () => {
      const realRootStat = statSync(tempDir);
      let fstatCount = 0;
      restoreDeps = setExecutionLockDependenciesForTesting({
        fstat: () => {
          fstatCount++;
          if (fstatCount === 1) {
            return realRootStat;
          }
          return {
            isDirectory: () => false,
            isFile: () => false, // not a file
            isSymbolicLink: () => false,
            dev: realRootStat.dev,
            ino: 9999,
          } as unknown as Stats;
        },
      });

      expect(() => acquireMutexLock(tempDir, ["bun", "test"])).toThrow(HarnessError);
    });

    it("throws when lock directory identity changes while opening lock file", () => {
      const lockDir = resolve(join(tempDir, ".olt", ".locks"));
      const realLockDirStat = statSync(lockDir);
      let lockDirLstatCount = 0;
      restoreDeps = setExecutionLockDependenciesForTesting({
        lstat: (path) => {
          if (resolve(path) === lockDir) {
            lockDirLstatCount++;
            if (lockDirLstatCount === 2) {
              const modified = Object.assign(
                Object.create(Object.getPrototypeOf(realLockDirStat)),
                realLockDirStat,
                { ino: realLockDirStat.ino + 999 },
              ) as Stats;
              return modified;
            }
          }
          return statSync(path);
        },
      });

      expect(() => acquireMutexLock(tempDir, ["bun", "test"])).toThrow(HarnessError);
    });

    it("throws when close fails on lock descriptor during release", () => {
      restoreDeps = setExecutionLockDependenciesForTesting({
        close: () => {
          throw new Error("Close failure simulation");
        },
      });

      const cleanup = acquireMutexLock(tempDir, ["bun", "test"]);
      expect(() => cleanup()).toThrow(HarnessError);
    });
  });
});
