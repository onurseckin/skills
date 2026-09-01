import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  MAIN_THREAD_ADVISORY,
  identifyExecutionContext,
  recordDefect,
  type DefectRecord,
} from "../../../olt/scripts/src/authority/thread/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { cleanupVirtualAuthorityFS, getVirtualAuthorityFS, setupVirtualAuthorityFS } from "../fixture.ts";

function defectFixture(cwd: string, id: string): DefectRecord {
  return {
    id,
    type: "main_thread_direct_execution" as const,
    severity: "critical" as const,
    timestamp: new Date().toISOString(),
    pid: 1234,
    ppid: 1,
    agent_id: "main-user",
    observation: "Direct file modification on main thread",
    remediation: "Dispatch Tier 2 coordinator",
    context: {
      cwd,
      indicators: { TEST: "1" },
    },
  };
}

function expectIntegrityDefectWriteFailure(action: () => void, defectId: string): void {
  try {
    action();
    expect.unreachable("expected defect write to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(HarnessError);
    if (error instanceof HarnessError) {
      expect(error.code).toBe("INTEGRITY");
      expect(error.message).toContain(defectId);
      expect(error.message).toContain("defects.jsonl");
    }
  }
}

describe("Thread Identifier - Defect Logging, Main Thread Restraints, & Security", () => {
  beforeEach(() => {
    setupVirtualAuthorityFS();
  });
  afterEach(() => {
    cleanupVirtualAuthorityFS();
  });

  test("recordDefect persists defect log into runRoot or capsules dir", () => {
    const vfs = getVirtualAuthorityFS();
    const sandbox = "/virtual/thread-lifecycle/persist";
    vfs.mkdirSync(sandbox, { recursive: true });
    const defectRecord = defectFixture(sandbox, "defect-test-123");
    recordDefect(defectRecord, { runRoot: sandbox });
    recordDefect(defectRecord, { runRoot: sandbox });
    const defectsFile = join(sandbox, "defects.jsonl");
    expect(vfs.existsSync(defectsFile)).toBe(true);
    const content = vfs.readFileSync(defectsFile, "utf8");
    expect(content.split("\n").filter(Boolean)).toHaveLength(2);
    expect(content).toContain("defect-test-123");
    expect(content).toContain("main_thread_direct_execution");
  });

  test("recordDefect fails closed when the resolved ledger is a directory", () => {
    const vfs = getVirtualAuthorityFS();
    const sandbox = "/virtual/thread-lifecycle/dir-fail";
    vfs.mkdirSync(sandbox, { recursive: true });
    const ledger = join(sandbox, "defects.jsonl");
    vfs.mkdirSync(ledger, { recursive: true });
    const defectRecord = defectFixture(sandbox, "defect-directory-123");
    expectIntegrityDefectWriteFailure(
      () => recordDefect(defectRecord, { runRoot: sandbox }),
      defectRecord.id,
    );
  });

  test("recordDefect rejects final symlinks without changing an external ledger", async () => {
    if (process.platform === "win32") return;
    const vfs = getVirtualAuthorityFS();
    const sandbox = "/virtual/thread-lifecycle/symlink-reject";
    vfs.mkdirSync(sandbox, { recursive: true });
    const external = join(sandbox, "external-defects.jsonl");
    const ledger = join(sandbox, "defects.jsonl");
    vfs.writeFileSync(external, "external\n");
    const { symlinkSync } = await import("node:fs");
    symlinkSync(external, ledger);
    const defectRecord = defectFixture(sandbox, "defect-symlink-123");

    expectIntegrityDefectWriteFailure(
      () => recordDefect(defectRecord, { runRoot: sandbox }),
      defectRecord.id,
    );
    expect(vfs.readFileSync(external, "utf8")).toBe("external\n");
  });

  test("recordDefect wraps cyclic and BigInt serialization failures as INTEGRITY", () => {
    const vfs = getVirtualAuthorityFS();
    const sandbox = "/virtual/thread-lifecycle/serial-fail";
    vfs.mkdirSync(sandbox, { recursive: true });
    const cyclic = defectFixture(sandbox, "defect-cyclic-123") as DefectRecord & { loop?: unknown };
    cyclic.loop = cyclic;
    expectIntegrityDefectWriteFailure(() => recordDefect(cyclic, { runRoot: sandbox }), cyclic.id);

    const bigint = defectFixture(sandbox, "defect-bigint-123") as DefectRecord & {
      sequence?: unknown;
    };
    bigint.sequence = 1n;
    expectIntegrityDefectWriteFailure(() => recordDefect(bigint, { runRoot: sandbox }), bigint.id);
  });

  test("identifyExecutionContext records defect when mutating action is run on main thread in non-test mode", () => {
    const vfs = getVirtualAuthorityFS();
    const originalNodeEnv = process.env.NODE_ENV;
    const originalBunTest = process.env.BUN_TEST;
    const originalTest = process.env.TEST;
    const testScratch = "/virtual/thread-lifecycle/mutating-action";
    vfs.mkdirSync(testScratch, { recursive: true });

    try {
      process.env.NODE_ENV = "production";
      delete process.env.BUN_TEST;
      delete process.env.TEST;

      const contextWithDefect = identifyExecutionContext({
        isInteractiveMainThread: true,
        runRoot: testScratch,
        agentId: "mind-0",
        argv: ["bun", "harness.ts", "task:submit"],
      });

      expect(contextWithDefect.defect).not.toBeNull();
      expect(contextWithDefect.defect?.type).toBe("main_thread_direct_execution");
      expect(contextWithDefect.defect?.severity).toBe("critical");
      expect(contextWithDefect.defect?.context.matched_action).toBe("task:submit");
    } finally {
      if (originalNodeEnv !== undefined) {
        process.env.NODE_ENV = originalNodeEnv;
      } else {
        delete process.env.NODE_ENV;
      }
      if (originalBunTest !== undefined) {
        process.env.BUN_TEST = originalBunTest;
      } else {
        delete process.env.BUN_TEST;
      }
      if (originalTest !== undefined) {
        process.env.TEST = originalTest;
      } else {
        delete process.env.TEST;
      }
    }
  });

  test("identifyExecutionContext keeps passive exact argv on the main thread advisory-only", () => {
    const context = identifyExecutionContext({
      isInteractiveMainThread: true,
      argv: ["bun", "harness.ts", "whoami"],
    });

    expect(context.compliance_state).toBe("restrained");
    expect(context.advisory).toBe(MAIN_THREAD_ADVISORY);
    expect(context.defect).toBeNull();
  });
});
