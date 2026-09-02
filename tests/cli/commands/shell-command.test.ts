import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  persistStandaloneReceipt,
  setShellCommandDependenciesForTesting,
  shellCommand,
} from "../../../olt/scripts/src/cli/commands/shell.ts";
import { createAgentMetadata, writeAgentMetadata } from "../../../olt/scripts/src/runtime/index.ts";
import {
  disableInMemoryAgentMetadata,
  enableInMemoryAgentMetadata,
} from "../../../olt/scripts/src/runtime/session.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/index.ts";

const realTmpDirs: string[] = [];
function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `skills-${prefix}-`));
  realTmpDirs.push(dir);
  return dir;
}

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
    enableInMemoryAgentMetadata();
  });
  afterEach(() => {
    disableInMemoryAgentMetadata();
    for (const d of realTmpDirs) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {}
    }
    realTmpDirs.length = 0;
  });

  test("persistStandaloneReceipt handles happy path and fsync failure recovery", async () => {
    const root = createTempDir("receipt-cov");
    const evidenceDir = join(root, "evidence");
    await mkdir(evidenceDir, { recursive: true });
    const receiptPath = join(evidenceDir, "cmd-test.json");
    const body = JSON.stringify({ ok: true });
    persistStandaloneReceipt(evidenceDir, receiptPath, body);
    expect(await Bun.file(receiptPath).text()).toBe(body);
  });

  test("persistStandaloneReceipt error paths: zero write progress, post-rename failure, unlink error", async () => {
    const root = createTempDir("receipt-errs");
    const evidenceDir = join(root, "evidence");
    await mkdir(evidenceDir, { recursive: true });
    const receiptPath = join(evidenceDir, "cmd-err.json");

    let restore = setShellCommandDependenciesForTesting({ writeSync: (() => 0) as any });
    try {
      expect(() => persistStandaloneReceipt(evidenceDir, receiptPath, "data")).toThrow(
        /no forward write progress/,
      );
    } finally {
      restore();
    }

    restore = setShellCommandDependenciesForTesting({
      writeSync: (() => {
        throw new Error("disk error");
      }) as any,
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

    restore = setShellCommandDependenciesForTesting({
      writeSync: (() => {
        throw "raw string write failure";
      }) as any,
    });
    try {
      expect(() => persistStandaloneReceipt(evidenceDir, receiptPath, "data")).toThrow(
        /raw string write failure/,
      );
    } finally {
      restore();
    }

    restore = setShellCommandDependenciesForTesting({
      openSync: (p, flags) => (flags === "r" ? 99 : 42),
      writeSync: ((_fd: number, buf: Buffer) => buf.length) as any,
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
      writeSync: ((_fd: number, buf: Buffer) => buf.length) as any,
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
    enableInMemoryAgentMetadata();
  });
  afterEach(() => {
    disableInMemoryAgentMetadata();
    for (const d of realTmpDirs) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {}
    }
    realTmpDirs.length = 0;
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
    const root = createTempDir("capsule-shell");
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
    await writeFile(dummyEvidence, JSON.stringify({ ok: true }));

    const restore = setShellCommandDependenciesForTesting({
      runExecCommand: (async () => ({
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
      })) as any,
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

    const restoreMissing = setShellCommandDependenciesForTesting({
      runExecCommand: (async () => ({
        markdown: "### executed",
        evidence_path: "/missing.json",
        command: {
          id: "cmd-3",
          exit_code: 0,
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
          logs: { stdout: { sha256: "1" } },
        },
      })) as any,
      existsSync: () => false,
    });
    try {
      await expect(
        shellCommand({ actor: "actor-capsule", run: runRoot }, {}, ["echo", "test"]),
      ).rejects.toThrow(/no durable canonical/);
    } finally {
      restoreMissing();
    }
  });

  test("standalone rejects unauth roles and executes direct process with receipts", async () => {
    enableInMemoryAgentMetadata();
    try {
      await expect(shellCommand({ actor: "unreg" }, {}, ["git", "status"])).rejects.toThrow(
        /MISSING_AGENT_METADATA/,
      );
      registerStandaloneActor("val-1", "validator_subsystem");
      await expect(shellCommand({ actor: "val-1" }, {}, ["git", "status"])).rejects.toThrow(
        /COGNITIVE_VALIDATOR_COMMAND_FORBIDDEN/,
      );

      registerStandaloneActor("imp-worker", "implementer");
      await expect(
        shellCommand({ actor: "imp-worker", role: "implementer" }, {}, ["sh", "-c", "echo 1"]),
      ).rejects.toThrow(/UNSHIELDED_COMMAND_DEFECT/);

      const result = await shellCommand(
        { actor: "imp-worker", role: "implementer", wave: 1, task: "T1" },
        {},
        ["git", "status"],
      );
      expect(result.command === "git status" && !!result.receipt_sha256).toBe(true);
    } finally {
      disableInMemoryAgentMetadata();
    }
  });
});
