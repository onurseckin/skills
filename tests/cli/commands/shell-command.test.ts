import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { SpawnSyncReturns } from "node:child_process";
import { join } from "node:path";
import {
  createVirtualFSSession,
  mockSubprocess,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import {
  persistStandaloneReceipt,
  setShellCommandDependenciesForTesting,
  shellCommand,
} from "../../../olt/scripts/src/cli/commands/shell.ts";
import type { runExecCommand } from "../../../olt/scripts/src/cli/commands/run-ops.ts";
import { createAgentMetadata, writeAgentMetadata } from "../../../olt/scripts/src/runtime/index.ts";
import {
  disableInMemoryAgentMetadata,
  enableInMemoryAgentMetadata,
} from "../../../olt/scripts/src/runtime/session.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/index.ts";
import { cleanupVirtualCliFS, setupVirtualCliFS } from "./fixtures/full-lifecycle-fixture.ts";

let spawnSyncSpy: { mockRestore: () => void } | undefined;
let vfs: VirtualMemoryFS;

type WriteSyncFn = NonNullable<
  Parameters<typeof setShellCommandDependenciesForTesting>[0]["writeSync"]
>;

function registerStandaloneActor(actor: string, role: string): void {
  writeAgentMetadata(
    createAgentMetadata({
      agent_id: actor,
      role,
      can_execute_shell: role === "implementer",
    }),
  );
}

describe("shell command coverage: persistStandaloneReceipt and dependencies", () => {
  beforeEach(() => {
    vfs = setupVirtualCliFS();
    enableInMemoryAgentMetadata();
  });
  afterEach(() => {
    if (spawnSyncSpy) {
      spawnSyncSpy.mockRestore();
      spawnSyncSpy = undefined;
    }
    disableInMemoryAgentMetadata();
    cleanupVirtualCliFS();
  });

  test("persistStandaloneReceipt handles happy path and fsync failure recovery", () => {
    const evidenceDir = "/virtual/shell-receipt/evidence";
    vfs.mkdirSync(evidenceDir, { recursive: true });
    const receiptPath = join(evidenceDir, "cmd-test.json");
    const body = JSON.stringify({ ok: true });
    persistStandaloneReceipt(evidenceDir, receiptPath, body);
    expect(vfs.readFileSync(receiptPath, "utf8")).toBe(body);
  });

  test("persistStandaloneReceipt error paths: zero write progress, post-rename failure, unlink error", () => {
    const evidenceDir = "/virtual/shell-errs/evidence";
    vfs.mkdirSync(evidenceDir, { recursive: true });
    const receiptPath = join(evidenceDir, "cmd-err.json");

    const mockZeroWrite: WriteSyncFn = () => 0;
    let restore = setShellCommandDependenciesForTesting({ writeSync: mockZeroWrite });
    try {
      expect(() => persistStandaloneReceipt(evidenceDir, receiptPath, "data")).toThrow(
        /no forward write progress/,
      );
    } finally {
      restore();
    }

    const mockThrowWrite: WriteSyncFn = () => {
      throw new Error("disk error");
    };
    restore = setShellCommandDependenciesForTesting({
      writeSync: mockThrowWrite,
      unlinkSync: () => {
        throw new Error("unlink failed");
      },
    });
    try {
      expect(() => persistStandaloneReceipt(evidenceDir, receiptPath, "data")).toThrow(
        /cleanup failed/,
      );
    } finally {
      restore();
    }

    const mockRawStringThrow: WriteSyncFn = () => {
      throw "raw string write failure";
    };
    restore = setShellCommandDependenciesForTesting({ writeSync: mockRawStringThrow });
    try {
      expect(() => persistStandaloneReceipt(evidenceDir, receiptPath, "data")).toThrow(
        /raw string write failure/,
      );
    } finally {
      restore();
    }

    const mockBufferWrite: WriteSyncFn = (_fd, buf) =>
      typeof buf === "string" ? Buffer.byteLength(buf) : buf.byteLength;

    restore = setShellCommandDependenciesForTesting({
      openSync: (_p, flags) => (flags === "r" ? 99 : 42),
      writeSync: mockBufferWrite,
      fsyncSync: (fd) => {
        if (fd === 99) throw new Error("dir sync failed");
      },
      closeSync: () => {},
      renameSync: () => {},
      existsSync: () => true,
    });
    try {
      expect(() => persistStandaloneReceipt(evidenceDir, receiptPath, "data")).toThrow(
        /outcome uncertain/,
      );
    } finally {
      restore();
    }

    restore = setShellCommandDependenciesForTesting({
      writeSync: mockBufferWrite,
      fsyncSync: () => {},
      closeSync: () => {},
      renameSync: () => {},
      existsSync: () => false,
    });
    try {
      expect(() => persistStandaloneReceipt(evidenceDir, receiptPath, "data")).toThrow(
        /produce its final evidence path/,
      );
    } finally {
      restore();
    }
  });
});

describe("shell command coverage: argument validation and capsule execution", () => {
  beforeEach(() => {
    vfs = setupVirtualCliFS();
    enableInMemoryAgentMetadata();
  });
  afterEach(() => {
    if (spawnSyncSpy) {
      spawnSyncSpy.mockRestore();
      spawnSyncSpy = undefined;
    }
    disableInMemoryAgentMetadata();
    cleanupVirtualCliFS();
  });

  test("validates empty remainder and invalid gate flags", async () => {
    await expect(shellCommand({ actor: "imp-1" })).rejects.toThrow(
      "requires an executable command",
    );
    await expect(shellCommand({ actor: "imp-1" }, {})).rejects.toThrow(
      "requires an executable command",
    );
    await expect(shellCommand({ actor: "imp-1" }, {}, [])).rejects.toThrow(
      "requires an executable command",
    );
    await expect(shellCommand({ actor: "imp-1", gate: "G-1" }, {}, ["echo", "hi"])).rejects.toThrow(
      "--gate requires",
    );
  });

  test("capsule mode handles missing metadata, role mismatch, log defects, and duration calculation", async () => {
    const root = "/virtual/capsule-shell-root";
    vfs.mkdirSync(root, { recursive: true });
    const runRoot = initRun(root, "run-shell", new TextEncoder().encode("prompt"), "file", true);
    writeAgentMetadata(
      createAgentMetadata({
        agent_id: "actor-capsule",
        role: "implementer",
        can_execute_shell: true,
      }),
      runRoot,
    );
    await expect(
      shellCommand({ actor: "actor-capsule", role: "validator", run: runRoot }, {}, ["echo", "1"]),
    ).rejects.toThrow(/ROLE_ASSERTION_MISMATCH/);

    const dummyEvidence = join(runRoot, "evidence.json");
    vfs.writeFileSync(dummyEvidence, JSON.stringify({ ok: true }));

    const mockExecSuccess: typeof runExecCommand = async () => ({
      markdown: "### executed",
      evidence_path: dummyEvidence,
      evidence: {},
      command: {
        id: "cmd-1",
        status: "succeeded",
        exit_code: 0,
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        logs: {
          stdout: { sha256: "abc", bytes: 10, path: "stdout.log" },
          stderr: { sha256: "def", bytes: 0, path: "stderr.log" },
        },
      },
    });

    let restore = setShellCommandDependenciesForTesting({
      runExecCommand: mockExecSuccess,
      existsSync: () => true,
    });
    try {
      const res = await shellCommand(
        { actor: "actor-capsule", role: "implementer", run: runRoot },
        {},
        ["echo", "hello"],
      );
      expect(res.exit_code).toBe(0);
    } finally {
      restore();
    }

    const mockExecMissing: typeof runExecCommand = async () => ({
      markdown: "### executed",
      evidence_path: "/missing.json",
      command: {
        id: "cmd-3",
        exit_code: 0,
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        logs: { stdout: { sha256: "1" } },
      },
    });

    restore = setShellCommandDependenciesForTesting({
      runExecCommand: mockExecMissing,
      existsSync: () => false,
    });
    try {
      await expect(
        shellCommand({ actor: "actor-capsule", run: runRoot }, {}, ["echo", "test"]),
      ).rejects.toThrow(/no durable canonical/);
    } finally {
      restore();
    }
  });

  test("standalone rejects unauth roles and executes direct process with receipts", async () => {
    await expect(shellCommand({ actor: "unreg" }, {}, ["git", "status"])).rejects.toThrow(
      /MISSING_AGENT_METADATA/,
    );
    registerStandaloneActor("val-1", "validator");
    await expect(shellCommand({ actor: "val-1" }, {}, ["git", "status"])).rejects.toThrow(
      "[SHELL_COMMAND_FORBIDDEN] Role 'validator' is locked to 0 command execution by its diagnostic profile.",
    );

    registerStandaloneActor("imp-worker", "implementer");
    await expect(
      shellCommand({ actor: "imp-worker", role: "implementer" }, {}, ["sh", "-c", "echo 1"]),
    ).rejects.toThrow(/UNSHIELDED_COMMAND_DEFECT/);

    spawnSyncSpy = mockSubprocess((cmd: string, args: readonly string[]) => {
      if (cmd === "git" && args[0] === "status") {
        return {
          pid: 10001,
          output: ["", "On branch main\nnothing to commit, working tree clean\n", ""],
          stdout: "On branch main\nnothing to commit, working tree clean\n",
          stderr: "",
          status: 0,
          signal: null,
          error: undefined,
        } as SpawnSyncReturns<string>;
      }
      return {
        pid: 10002,
        output: ["", "", ""],
        stdout: "",
        stderr: "",
        status: 0,
        signal: null,
        error: undefined,
      } as SpawnSyncReturns<string>;
    });

    const result = await shellCommand(
      { actor: "imp-worker", role: "implementer", wave: 1, task: "T1" },
      {},
      ["git", "status"],
    );
    expect(result.command === "git status" && !!result.receipt_sha256).toBe(true);
  });
});
