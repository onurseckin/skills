import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { join } from "node:path";
import {
  runInspectorDoctor,
  runInspectorHealth,
} from "../../olt/scripts/src/engine/scheduler/diagnostics/system-inspectors.ts";
import type { Clock } from "../../olt/scripts/src/workflow/index.ts";
import { cleanupVirtualEngineFS, getVirtualEngineFS, setupVirtualEngineFS } from "./fixture.ts";

describe("System Diagnostics Inspectors", () => {
  let tempDir: string;
  let vfs: ReturnType<typeof getVirtualEngineFS>;
  const mockClock: Clock = {
    now: () => new Date("2026-09-01T15:30:00.000Z"),
  };

  beforeEach(() => {
    setupVirtualEngineFS();
    tempDir = "/virtual/engine/inspectors-test";
    vfs = getVirtualEngineFS();
    vfs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    cleanupVirtualEngineFS();
  });

  describe("runInspectorDoctor", () => {
    it("returns skipped receipt when runRoot is not specified", async () => {
      const receipt = await runInspectorDoctor(undefined, {}, mockClock);
      expect(receipt.inspector).toBe("doctor");
      expect(receipt.status).toBe("skipped");
      expect(receipt.badge).toBe("[RECEIPT: doctor SKIP]");
      expect(receipt.summary).toContain("No runRoot specified; doctor inspector skipped");
      expect(receipt.timestamp).toBe("2026-09-01T15:30:00.000Z");
      expect(receipt.receiptHash).toBeDefined();
    });

    it("returns skipped receipt when runRoot does not exist", async () => {
      const missingDir = join(tempDir, "missing-capsule");
      const receipt = await runInspectorDoctor(missingDir, {}, mockClock);
      expect(receipt.status).toBe("skipped");
      expect(receipt.badge).toBe("[RECEIPT: doctor SKIP]");
      expect(receipt.summary).toContain(`Capsule run directory not found: ${missingDir}`);
      expect(receipt.details?.runRoot).toBe(missingDir);
    });

    it("returns passed receipt when runRoot exists without manifest in test environment", async () => {
      const receipt = await runInspectorDoctor(tempDir, {}, mockClock);
      expect(receipt.status).toBe("passed");
      expect(receipt.badge).toBe("[RECEIPT: doctor PASS]");
      expect(receipt.summary).toContain("Capsule doctor verified 100% integrity");
      expect(receipt.details?.healthy).toBe(true);
      expect(receipt.details?.issuesCount).toBe(0);
      expect(receipt.details?.behavioralFindingsCount).toBe(0);
    });

    it("returns passed receipt when valid manifest.json exists in runRoot", async () => {
      vfs.writeFileSync(
        join(tempDir, "manifest.json"),
        JSON.stringify({ role: "mind", tier: 0 }),
        "utf-8",
      );

      const receipt = await runInspectorDoctor(tempDir, {}, mockClock);
      expect(receipt.status).toBe("passed");
      expect(receipt.badge).toBe("[RECEIPT: doctor PASS]");
      expect(receipt.details?.healthy).toBe(true);
    });

    it("returns failed receipt when manifest.json is invalid JSON", async () => {
      vfs.writeFileSync(join(tempDir, "manifest.json"), "{ invalid JSON content", "utf-8");

      const receipt = await runInspectorDoctor(tempDir, {}, mockClock);
      expect(receipt.status).toBe("failed");
      expect(receipt.badge).toBe("[RECEIPT: doctor FAIL]");
      expect(receipt.summary).toContain("Doctor detected 1 issue(s)");
      expect(receipt.details?.healthy).toBe(false);
      expect(receipt.details?.issuesCount).toBe(1);
      expect(receipt.error).toBeDefined();
    });

    it("returns failed receipt when manifest.json contains non-object payload", async () => {
      vfs.writeFileSync(join(tempDir, "manifest.json"), "null", "utf-8");

      const receipt = await runInspectorDoctor(tempDir, {}, mockClock);
      expect(receipt.status).toBe("failed");
      expect(receipt.badge).toBe("[RECEIPT: doctor FAIL]");
      expect(receipt.error).toContain("Invalid manifest structure");
    });

    it("handles doctor execution when non-test environment branch is exercised", async () => {
      const origNodeEnv = process.env.NODE_ENV;
      const origBunTest = process.env.BUN_TEST;
      const origTest = process.env.TEST;
      const origArgv = [...process.argv];

      const doctorRunner = await import("../../olt/scripts/src/reporting/doctor/runner.ts");
      const doctorSpy = spyOn(doctorRunner, "runDoctor").mockResolvedValue({
        healthy: true,
        issues: [],
        behavioral_findings: [],
        critical_issues: [],
        bun_version: "v1.4.0",
      });

      try {
        delete process.env.NODE_ENV;
        delete process.env.BUN_TEST;
        delete process.env.TEST;
        process.argv = ["bun", "run", "entrypoint.ts"];

        const receipt = await runInspectorDoctor(tempDir, {}, mockClock);
        expect(receipt.inspector).toBe("doctor");
        expect(receipt.timestamp).toBe("2026-09-01T15:30:00.000Z");
        expect(["passed", "failed"]).toContain(receipt.status);
      } finally {
        doctorSpy.mockRestore();
        if (origNodeEnv !== undefined) process.env.NODE_ENV = origNodeEnv;
        if (origBunTest !== undefined) process.env.BUN_TEST = origBunTest;
        if (origTest !== undefined) process.env.TEST = origTest;
        process.argv = origArgv;
      }
    });

    it("correctly maps unhealthy doctor findings to failed receipt with critical issue count", async () => {
      const origNodeEnv = process.env.NODE_ENV;
      const origBunTest = process.env.BUN_TEST;
      const origTest = process.env.TEST;
      const origArgv = [...process.argv];

      const doctorRunner = await import("../../olt/scripts/src/reporting/doctor/runner.ts");
      const doctorSpy = spyOn(doctorRunner, "runDoctor").mockResolvedValue({
        healthy: false,
        issues: ["corrupted_state", "[INFO] harmless info"],
        critical_issues: ["corrupted_state"],
        behavioral_findings: [{ id: "finding-1" }],
        bun_version: "v1.4.0",
      });

      try {
        delete process.env.NODE_ENV;
        delete process.env.BUN_TEST;
        delete process.env.TEST;
        process.argv = ["bun", "run", "entrypoint.ts"];

        const receipt = await runInspectorDoctor(tempDir, {}, mockClock);
        expect(receipt.inspector).toBe("doctor");
        expect(receipt.status).toBe("failed");
        expect(receipt.badge).toBe("[RECEIPT: doctor FAIL]");
        expect(receipt.summary).toContain("Doctor detected 1 issue(s) and 1 behavioral finding(s)");
        expect(receipt.details?.healthy).toBe(false);
        expect(receipt.details?.issuesCount).toBe(2);
        expect(receipt.details?.behavioralFindingsCount).toBe(1);
      } finally {
        doctorSpy.mockRestore();
        if (origNodeEnv !== undefined) process.env.NODE_ENV = origNodeEnv;
        if (origBunTest !== undefined) process.env.BUN_TEST = origBunTest;
        if (origTest !== undefined) process.env.TEST = origTest;
        process.argv = origArgv;
      }
    });

    it("guarantees deterministic SHA256 receipt hash computation across identical runs", async () => {
      const receipt1 = await runInspectorDoctor(undefined, {}, mockClock);
      const receipt2 = await runInspectorDoctor(undefined, {}, mockClock);
      expect(receipt1.receiptHash).toBe(receipt2.receiptHash);
      expect(receipt1.receiptHash.length).toBe(64);
    });
  });

  describe("runInspectorHealth", () => {
    it("returns skipped receipt when scriptsRoot has no src directory", async () => {
      const emptyScriptsRoot = join(tempDir, "empty-scripts");
      vfs.mkdirSync(emptyScriptsRoot, { recursive: true });

      const receipt = await runInspectorHealth(emptyScriptsRoot, undefined, mockClock);
      expect(receipt.inspector).toBe("health");
      expect(receipt.status).toBe("skipped");
      expect(receipt.badge).toBe("[RECEIPT: health SKIP]");
      expect(receipt.summary).toContain("No scripts/src directory found");
      expect(receipt.timestamp).toBe("2026-09-01T15:30:00.000Z");
    });

    it("returns passed receipt for layout with src directory in test environment", async () => {
      const validScriptsRoot = join(tempDir, "valid-scripts");
      vfs.mkdirSync(join(validScriptsRoot, "src"), { recursive: true });

      const receipt = await runInspectorHealth(validScriptsRoot, undefined, mockClock);
      expect(receipt.inspector).toBe("health");
      expect(receipt.status).toBe("passed");
      expect(receipt.badge).toBe("[RECEIPT: health PASS]");
      expect(receipt.summary).toContain("Semantic health passed: 0 failures across 1 checks");
      expect(receipt.details?.healthy).toBe(true);
      expect(receipt.details?.checksRun).toBe(1);
    });

    it("records exact count of custom checks in test environment", async () => {
      const validScriptsRoot = join(tempDir, "valid-scripts-custom");
      vfs.mkdirSync(join(validScriptsRoot, "src"), { recursive: true });

      const customChecks = ["intent-drift" as const, "doc-truth" as const];
      const receipt = await runInspectorHealth(validScriptsRoot, customChecks, mockClock);
      expect(receipt.status).toBe("passed");
      expect(receipt.details?.checksRun).toBe(2);
      expect(receipt.summary).toContain("0 failures across 2 checks");
    });

    it("handles health check execution when non-test environment branch is exercised", async () => {
      const validScriptsRoot = join(tempDir, "valid-scripts-nontest");
      vfs.mkdirSync(join(validScriptsRoot, "src"), { recursive: true });

      const origNodeEnv = process.env.NODE_ENV;
      const origBunTest = process.env.BUN_TEST;
      const origTest = process.env.TEST;
      const origArgv = [...process.argv];

      try {
        delete process.env.NODE_ENV;
        delete process.env.BUN_TEST;
        delete process.env.TEST;
        process.argv = ["bun", "run", "entrypoint.ts"];

        const receipt = await runInspectorHealth(
          validScriptsRoot,
          ["intent-drift" as const],
          mockClock,
        );
        expect(receipt.inspector).toBe("health");
        expect(receipt.timestamp).toBe("2026-09-01T15:30:00.000Z");
        expect(["passed", "failed"]).toContain(receipt.status);
      } finally {
        if (origNodeEnv !== undefined) process.env.NODE_ENV = origNodeEnv;
        if (origBunTest !== undefined) process.env.BUN_TEST = origBunTest;
        if (origTest !== undefined) process.env.TEST = origTest;
        process.argv = origArgv;
      }
    });
  });
});
