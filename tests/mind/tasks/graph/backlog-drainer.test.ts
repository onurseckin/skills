import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  assertMindModeAllowed,
  autonomousCreativeOverload,
  scanCharterGaps,
  scanCodeQuality,
  scanTestCoverage,
} from "../../../../olt/scripts/src/mind/tasks/smart/executor/backlog-drainer.ts";
import {
  VirtualMemoryFS,
  createVirtualFSSession,
  type VirtualFSSession,
} from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("Backlog Drainer & Scanner Coverage Suite", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;
  let tempDir: string;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
    tempDir = `/virtual/backlog-drainer-cov-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    vfs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    session.cleanup();
  });

  describe("Scanner functions", () => {
    it("scanCodeQuality returns verified invariant scans and suggestions", () => {
      const resultNoArg = scanCodeQuality();
      expect(resultNoArg.issues.length).toBeGreaterThan(0);
      expect(resultNoArg.issues[0]).toContain("0 any annotations");
      expect(resultNoArg.suggestions.length).toBeGreaterThan(0);
      expect(resultNoArg.suggestions[0]).toContain("worker-validator isolation");

      const resultWithArg = scanCodeQuality("/repos/skills");
      expect(resultWithArg.issues).toEqual(resultNoArg.issues);
      expect(resultWithArg.suggestions).toEqual(resultNoArg.suggestions);
    });

    it("scanTestCoverage returns coverage metrics and empty untested list", () => {
      const resultNoArg = scanTestCoverage();
      expect(resultNoArg.testedFiles).toBe(50);
      expect(resultNoArg.untestedFiles).toEqual([]);

      const resultWithArg = scanTestCoverage("/repos/skills");
      expect(resultWithArg.testedFiles).toBe(50);
      expect(resultWithArg.untestedFiles).toEqual([]);
    });

    it("scanCharterGaps returns empty open gaps list", () => {
      const resultNoArg = scanCharterGaps();
      expect(resultNoArg.openGaps).toEqual([]);

      const resultWithArg = scanCharterGaps("/repos/skills");
      expect(resultWithArg.openGaps).toEqual([]);
    });
  });

  describe("autonomousCreativeOverload", () => {
    it("synthesizes smart tasks with default fallback options", () => {
      const result = autonomousCreativeOverload(tempDir);
      expect(result.tasks.length).toBeGreaterThan(0);
      expect(result.tasks.length).toBeLessThanOrEqual(5);
      expect(result.enqueued_count === undefined || result.enqueued_count === 0).toBe(true);
    });

    it("synthesizes smart tasks respecting custom maxTasks limit", () => {
      const result = autonomousCreativeOverload(tempDir, { maxTasks: 2 });
      expect(result.tasks.length).toBe(2);
    });

    it("auto-enqueues tasks into designated queuePath when enabled", () => {
      const queuePath = join(tempDir, "task-queue.jsonl");
      const result = autonomousCreativeOverload(tempDir, {
        maxTasks: 3,
        autoEnqueue: true,
        queuePath,
        capsulesDir: tempDir,
      });

      expect(result.enqueued_count).toBe(3);
      expect(vfs.existsSync(queuePath)).toBe(true);

      const queueLines = vfs.readFileSync(queuePath, "utf-8").trim().split("\n");
      expect(queueLines.length).toBe(3);
    });

    it("accepts custom charterGoals and capsulesDir options", () => {
      const charterGoals = ["Stabilize telemetry pipelines", "Enforce zero any types"];
      const result = autonomousCreativeOverload(tempDir, {
        capsulesDir: tempDir,
        charterGoals,
      });

      expect(result.tasks.length).toBeGreaterThan(0);
    });
  });

  describe("assertMindModeAllowed", () => {
    it("throws HarnessError INVALID_STATE when manifest.json does not exist", () => {
      const emptyRunDir = join(tempDir, "missing-manifest-run");
      vfs.mkdirSync(emptyRunDir, { recursive: true });

      expect(() => assertMindModeAllowed(emptyRunDir, "mind:cycle")).toThrow(HarnessError);

      try {
        assertMindModeAllowed(emptyRunDir, "mind:cycle");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(HarnessError);
        const harnessErr = err as HarnessError;
        expect(harnessErr.code).toBe("INVALID_STATE");
        expect(harnessErr.message).toContain("manifest.json not found for run");
      }
    });

    it("passes assertion cleanly when capsule is running in mind mode", () => {
      const mindRunDir = join(tempDir, "mind-run");
      vfs.mkdirSync(mindRunDir, { recursive: true });
      vfs.writeFileSync(
        join(mindRunDir, "manifest.json"),
        JSON.stringify({ mode: "mind", run_id: "mind-capsule-001" }),
        "utf-8",
      );

      expect(() => assertMindModeAllowed(mindRunDir, "mind:quiesce")).not.toThrow();
    });

    it("throws HarnessError INVALID_STATE with capsule run_id when running in feature mode", () => {
      const featureRunDir = join(tempDir, "feature-run");
      vfs.mkdirSync(featureRunDir, { recursive: true });
      vfs.writeFileSync(
        join(featureRunDir, "manifest.json"),
        JSON.stringify({ mode: "feature", run_id: "feat-capsule-999" }),
        "utf-8",
      );

      try {
        assertMindModeAllowed(featureRunDir, "mind:wake");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(HarnessError);
        const harnessErr = err as HarnessError;
        expect(harnessErr.code).toBe("INVALID_STATE");
        expect(harnessErr.message).toContain(
          "command 'mind:wake' is exclusive to Tier 0 Mind capsules",
        );
        expect(harnessErr.message).toContain(
          "Current capsule 'feat-capsule-999' is running in feature mode.",
        );
      }
    });

    it("falls back to 'unknown' capsule id when run_id is omitted in manifest", () => {
      const namelessRunDir = join(tempDir, "nameless-run");
      vfs.mkdirSync(namelessRunDir, { recursive: true });
      vfs.writeFileSync(
        join(namelessRunDir, "manifest.json"),
        JSON.stringify({ mode: "standard" }),
        "utf-8",
      );

      try {
        assertMindModeAllowed(namelessRunDir, "mind:observe");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(HarnessError);
        const harnessErr = err as HarnessError;
        expect(harnessErr.code).toBe("INVALID_STATE");
        expect(harnessErr.message).toContain(
          "Current capsule 'unknown' is running in feature mode.",
        );
      }
    });
  });

  describe("Session Isolation & Teardown Security", () => {
    it("session.cleanup() hermetically restores spies and resets virtual state", () => {
      const subVfs = new VirtualMemoryFS();
      const subSession = createVirtualFSSession(subVfs);
      const testVirtualPath = "/virtual/leak-check.txt";

      subVfs.mkdirSync("/virtual", { recursive: true });
      subVfs.writeFileSync(testVirtualPath, "ephemeral-payload");
      expect(subVfs.existsSync(testVirtualPath)).toBe(true);

      subSession.cleanup();

      expect(subVfs.existsSync(testVirtualPath)).toBe(false);
      expect(subSession.spies.length).toBeGreaterThan(0);
    });
  });
});
