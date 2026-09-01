import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import {
  isBroadScopeTest,
  readOwnDataString,
  isTrustedEnoent,
  prepareCommand,
} from "../../../olt/scripts/src/engine/runner/models/execution/run-command.ts";
import { resolveScratchDir } from "../../../olt/scripts/src/core/shared/paths.ts";
import { createAgentMetadata } from "../../../olt/scripts/src/runtime/metadata.ts";
import {
  disableInMemoryAgentMetadata,
  enableInMemoryAgentMetadata,
  setInMemoryAgentMetadata,
} from "../../../olt/scripts/src/runtime/session.ts";
import type { InternalCommandRunner } from "../../../olt/scripts/src/engine/runner/models/execution/internal-command-runner.ts";
import type {
  CommandOptions,
  CommandResult,
  PreparedCommand,
} from "../../../olt/scripts/src/engine/runner/types/types.ts";
import { cleanupVirtualEngineFS, getVirtualEngineFS, setupVirtualEngineFS } from "../fixture.ts";

describe("engine/runner/models/execution/run-command.ts - Preparation & Broad Scope Checks", () => {
  let tempDir: string;
  let runRoot: string;

  beforeEach(() => {
    setupVirtualEngineFS();
    enableInMemoryAgentMetadata();
    tempDir = "/virtual/run-cmd-prep";
    runRoot = join(tempDir, ".olt", "runs", "test-run");
    const vfs = getVirtualEngineFS();
    vfs.mkdirSync(tempDir, { recursive: true });
    vfs.mkdirSync(join(runRoot, "runtime"), { recursive: true });
    vfs.mkdirSync(join(tempDir, ".olt", ".locks"), { recursive: true });
  });

  afterEach(() => {
    disableInMemoryAgentMetadata();
    cleanupVirtualEngineFS();
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
      expect(isBroadScopeTest(["bun", "test", "tests/engine/runner/runner.test.ts"])).toBe(false);
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
      const metaPath = join(runRoot, "runtime", `agent-${agentId}.json`);
      setInMemoryAgentMetadata(metaPath, JSON.stringify(meta, null, 2));
      getVirtualEngineFS().writeFileSync(metaPath, JSON.stringify(meta, null, 2));
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
        argv: ["bun", "test", "tests/engine/runner/runner.test.ts"],
        repositoryRoot: tempDir,
      };

      const prepared = await prepareCommand(opts, mockRunner);
      expect(prepared.options.actor).toBe("worker-1");
      expect(prepared.options.argv).toEqual(["bun", "test", "tests/engine/runner/runner.test.ts"]);

      const scratchDir = resolveScratchDir(tempDir);
      const evidenceDir = join(scratchDir, "evidence");
      expect(getVirtualEngineFS().existsSync(evidenceDir)).toBe(true);
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
        argv: ["bun", "test", "tests/engine/runner/runner.test.ts"],
        repositoryRoot: tempDir,
        gateId: "gate-run-test",
      };

      const prepared = await prepareCommand(opts, mockRunner);
      expect(prepared.options.gateId).toBe("gate-run-test");
    });
  });
});
