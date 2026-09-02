import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runInspectorDoctor,
  runInspectorHealth,
} from "../../olt/scripts/src/engine/scheduler/diagnostics/system-inspectors.ts";
import type { Clock } from "../../olt/scripts/src/workflow/index.ts";

describe("System Diagnostics Inspectors", () => {
  let tempDir: string;
  const mockClock: Clock = {
    now: () => new Date("2026-09-01T15:30:00.000Z"),
  };

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "inspectors-test-"));
  });

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
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
      writeFileSync(
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
      writeFileSync(join(tempDir, "manifest.json"), "{ invalid JSON content", "utf-8");

      const receipt = await runInspectorDoctor(tempDir, {}, mockClock);
      expect(receipt.status).toBe("failed");
      expect(receipt.badge).toBe("[RECEIPT: doctor FAIL]");
      expect(receipt.summary).toContain("Doctor detected 1 issue(s)");
      expect(receipt.details?.healthy).toBe(false);
      expect(receipt.details?.issuesCount).toBe(1);
      expect(receipt.error).toBeDefined();
    });

    it("returns failed receipt when manifest.json contains non-object payload", async () => {
      writeFileSync(join(tempDir, "manifest.json"), "null", "utf-8");

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
        if (origNodeEnv !== undefined) process.env.NODE_ENV = origNodeEnv;
        if (origBunTest !== undefined) process.env.BUN_TEST = origBunTest;
        if (origTest !== undefined) process.env.TEST = origTest;
        process.argv = origArgv;
      }
    });
  });

  describe("runInspectorHealth", () => {
    it("returns skipped receipt when scriptsRoot has no src directory", async () => {
      const emptyScriptsRoot = join(tempDir, "empty-scripts");
      mkdirSync(emptyScriptsRoot, { recursive: true });

      const receipt = await runInspectorHealth(emptyScriptsRoot, undefined, mockClock);
      expect(receipt.inspector).toBe("health");
      expect(receipt.status).toBe("skipped");
      expect(receipt.badge).toBe("[RECEIPT: health SKIP]");
      expect(receipt.summary).toContain("No scripts/src directory found");
      expect(receipt.timestamp).toBe("2026-09-01T15:30:00.000Z");
    });

    it("returns passed receipt for layout with src directory in test environment", async () => {
      const validScriptsRoot = join(tempDir, "valid-scripts");
      mkdirSync(join(validScriptsRoot, "src"), { recursive: true });

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
      mkdirSync(join(validScriptsRoot, "src"), { recursive: true });

      const customChecks = ["intent-drift" as const, "doc-truth" as const];
      const receipt = await runInspectorHealth(validScriptsRoot, customChecks, mockClock);
      expect(receipt.status).toBe("passed");
      expect(receipt.details?.checksRun).toBe(2);
      expect(receipt.summary).toContain("0 failures across 2 checks");
    });

    it("handles health check execution when non-test environment branch is exercised", async () => {
      const validScriptsRoot = join(tempDir, "valid-scripts-nontest");
      mkdirSync(join(validScriptsRoot, "src"), { recursive: true });

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
