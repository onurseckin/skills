import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { executeShieldedCommand } from "../../../olt/scripts/src/authority/rbac/index.ts";
import { cleanupVirtualAuthorityFS, setupVirtualAuthorityFS } from "../fixture.ts";

interface MockChildProcess extends EventEmitter {
  stdout: Readable;
  stderr: Readable;
  stdin: null;
  pid: number;
  kill: () => boolean;
}

function createMockProcess(command: string, args: readonly string[]): MockChildProcess {
  const emitter = new EventEmitter() as MockChildProcess;
  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });
  emitter.stdout = stdout;
  emitter.stderr = stderr;
  emitter.stdin = null;
  emitter.pid = 12345;
  emitter.kill = () => true;

  queueMicrotask(() => {
    if (command === "non_existent_binary_xyz_123456789") {
      emitter.emit("error", new Error("spawn non_existent_binary_xyz_123456789 ENOENT"));
      return;
    }
    const fullCmd = [command, ...args].join(" ");
    if (fullCmd.includes("shielded-execution-pass")) {
      stdout.push("shielded-execution-pass\n");
      stdout.push(null);
      stderr.push(null);
      emitter.emit("close", 0);
    } else if (fullCmd.includes("validator-read-pass")) {
      stdout.push("validator-read-pass\n");
      stdout.push(null);
      stderr.push(null);
      emitter.emit("close", 0);
    } else if (fullCmd.includes("process.exit(42)")) {
      stdout.push(null);
      stderr.push(null);
      emitter.emit("close", 42);
    } else if (fullCmd.includes("critical stderr test output")) {
      stdout.push(null);
      stderr.push("critical stderr test output\n");
      stderr.push(null);
      emitter.emit("close", 0);
    } else if (command === "echo") {
      stdout.push(`${args.join(" ")}\n`);
      stdout.push(null);
      stderr.push(null);
      emitter.emit("close", 0);
    } else {
      stdout.push(null);
      stderr.push(null);
      emitter.emit("close", 0);
    }
  });

  return emitter;
}

describe("Authority RBAC - Command Authorizer Execution Shield", () => {
  let spawnSpy: { mockRestore: () => void } | undefined;

  beforeEach(() => {
    setupVirtualAuthorityFS();
    spawnSpy = spyOn(childProcess, "spawn").mockImplementation(
      (cmd: string, args?: readonly string[]) =>
        createMockProcess(cmd, args ?? []) as unknown as childProcess.ChildProcess,
    );
  });

  afterEach(() => {
    if (spawnSpy) {
      spawnSpy.mockRestore();
      spawnSpy = undefined;
    }
    cleanupVirtualAuthorityFS();
  });

  test("denies file mutation commands for supervisor/validator without execution", async () => {
    const result = await executeShieldedCommand("validator-1", ["rm", "-rf", "src/core"], {
      actorRole: "validator",
    });
    expect(result.success).toBe(false);
    expect(result.authorized).toBe(false);
    expect(result.reason).toBe("SUPERVISOR_ZERO_CODE_EDITS");
    expect(result.exitCode).toBe(1);
  });

  test("denies whole-suite test execution under shielded shell", async () => {
    const result = await executeShieldedCommand("implementer-1", ["bun", "test"], {
      actorRole: "implementer",
    });
    expect(result.success).toBe(false);
    expect(result.authorized).toBe(false);
    expect(result.reason).toBe("WHOLE_SUITE_TEST_RUN_DENIED");
  });

  test("executes authorized file-scoped command successfully", async () => {
    const result = await executeShieldedCommand(
      "implementer-1",
      ["bun", "-e", "console.log('shielded-execution-pass')"],
      { actorRole: "implementer" },
    );
    expect(result.authorized).toBe(true);
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("shielded-execution-pass");
  });

  test("allows permitted CLI command execution for validator under shielded shell", async () => {
    const result = await executeShieldedCommand(
      "validator_task-1_sub",
      ["node", "-e", "console.log('validator-read-pass')"],
      { actorRole: "validator" },
    );
    expect(result.authorized).toBe(true);
    expect(result.success).toBe(true);
    expect(result.stdout).toContain("validator-read-pass");
  });

  test("captures error and exit code on command failure", async () => {
    const result = await executeShieldedCommand("worker-1", ["bun", "-e", "process.exit(42)"], {
      actorRole: "worker",
    });
    expect(result.authorized).toBe(true);
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(42);
  });

  test("captures stderr output during command execution", async () => {
    const result = await executeShieldedCommand(
      "implementer-1",
      ["bun", "-e", "console.error('critical stderr test output'); process.exit(0);"],
      { actorRole: "implementer" },
    );
    expect(result.authorized).toBe(true);
    expect(result.success).toBe(true);
    expect(result.stderr).toContain("critical stderr test output");
  });

  test("handles process error event when binary cannot be spawned", async () => {
    const result = await executeShieldedCommand(
      "implementer-1",
      ["non_existent_binary_xyz_123456789"],
      { actorRole: "implementer" },
    );
    expect(result.authorized).toBe(true);
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  test("infers actor role from various actorId patterns and falls back to implementer", async () => {
    const resFallback = await executeShieldedCommand("custom-agent-name", ["echo", "hi"], {
      env: { FOO: "BAR" },
      cwd: "/virtual/repo",
    });
    expect(resFallback.authorized).toBe(true);

    const resCoord = await executeShieldedCommand("coordinator-alpha", ["rm", "file.txt"]);
    expect(resCoord.authorized).toBe(false);
    expect(resCoord.reason).toBe("ROLE_BOUNDARY_DEVIATION");

    const resOrch = await executeShieldedCommand("orch_sub_orchestrator", [
      "bun",
      "test",
      "foo.test.ts",
    ]);
    expect(resOrch.authorized).toBe(false);
    expect(resOrch.reason).toBe("SUPERVISOR_ZERO_TEST_RUNS");

    const resMind = await executeShieldedCommand("mind-lead", ["touch", "foo.ts"]);
    expect(resMind.authorized).toBe(false);

    const resCritic = await executeShieldedCommand("sub-critic-1", ["bun", "test", "foo.test.ts"]);
    expect(resCritic.authorized).toBe(false);

    const resWorker = await executeShieldedCommand("worker_node_1", ["echo", "ok"]);
    expect(resWorker.authorized).toBe(true);
  });
});
