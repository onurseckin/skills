import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  STANDARD_SUPERVISORY_CRONS,
  __setDagSnapshotPersistenceTestHook,
  canonicalPath,
  captureDagSnapshot,
  formatDagResumeMarkdown,
  formatDagSnapshotMarkdown,
  isOwnCode,
  loadDagSnapshot,
  persistDagSnapshot,
  requiredText,
  resumeDagSnapshot,
  strings,
  timestamp,
  type QuotaDagSnapshot,
  type ResumeDagSnapshotResult,
} from "../../olt/scripts/src/telemetry/snapshot/index.ts";
import type { CircuitBreakerEvaluation } from "../../olt/scripts/src/telemetry/circuit-breaker.ts";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";

describe("Telemetry Quota DAG Snapshot Suite", () => {
  const TEST_DIR = join(process.cwd(), "tests-tmp-telemetry-snapshot");

  beforeEach(() => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    __setDagSnapshotPersistenceTestHook(undefined);
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  function createTestSnapshot(
    repoRoot = TEST_DIR,
    runRoot = TEST_DIR,
    lowestQuotaObserved = 5,
  ): QuotaDagSnapshot {
    return {
      version: "2",
      repositoryRoot: repoRoot,
      runRoot,
      frozenAt: "2026-01-01T00:00:00.000Z",
      status: "frozen",
      tasks: [],
      agents: [],
      cronsSuspended: STANDARD_SUPERVISORY_CRONS,
      uncommittedFiles: [],
      lowestQuotaObserved,
      constrainedModels: ["claude-3-opus"],
      autoWakeSchedule: {
        resetTime: "2026-01-01T01:00:00.000Z",
        resumeTime: "2026-01-01T01:01:00.000Z",
      },
    };
  }

  describe("snapshot-capture", () => {
    it("captures valid snapshot without memory.json", async () => {
      const snap = await captureDagSnapshot({
        runRoot: TEST_DIR,
        repositoryRoot: process.cwd(),
        lowestQuotaObserved: 10,
        constrainedModels: ["gpt-4"],
        resetTime: "2026-01-01T02:00:00.000Z",
      });

      expect(snap.version).toBe("2");
      expect(snap.status).toBe("frozen");
      expect(snap.lowestQuotaObserved).toBe(10);
      expect(snap.constrainedModels).toEqual(["gpt-4"]);
      expect(snap.cronsSuspended).toEqual(STANDARD_SUPERVISORY_CRONS);
      expect(snap.autoWakeSchedule.resumeTime).toBe("2026-01-01T02:01:00.000Z");
    });

    it("parses memory.json when present in runRoot", async () => {
      const memoryData = {
        tasks: [{ id: "task-1", status: "running", effortMath: "3 Work", dependencies: [] }],
        agents: [{ id: "agent-alpha", role: "implementer", status: "busy" }],
        activeWave: { waveId: "wave-001", status: "in_progress", lanes: ["lane-a", "lane-b"] },
      };
      writeFileSync(join(TEST_DIR, "memory.json"), JSON.stringify(memoryData));

      const snap = await captureDagSnapshot({
        runRoot: TEST_DIR,
        repositoryRoot: process.cwd(),
        lowestQuotaObserved: null,
        constrainedModels: [],
        resetTime: "2026-01-01T03:00:00.000Z",
      });

      expect(snap.tasks).toHaveLength(1);
      expect(snap.tasks[0]?.id).toBe("task-1");
      expect(snap.agents).toHaveLength(1);
      expect(snap.agents[0]?.id).toBe("agent-alpha");
      expect(snap.activeWave?.waveId).toBe("wave-001");
      expect(snap.activeWave?.lanes).toEqual(["lane-a", "lane-b"]);
    });

    it("throws HarnessError on invalid lowestQuotaObserved or invalid resetTime", async () => {
      expect(
        captureDagSnapshot({
          runRoot: TEST_DIR,
          repositoryRoot: process.cwd(),
          lowestQuotaObserved: -5,
          constrainedModels: [],
          resetTime: "2026-01-01T00:00:00.000Z",
        }),
      ).rejects.toThrow(HarnessError);

      expect(
        captureDagSnapshot({
          runRoot: TEST_DIR,
          repositoryRoot: process.cwd(),
          lowestQuotaObserved: 5,
          constrainedModels: [],
          resetTime: "not-a-valid-date",
        }),
      ).rejects.toThrow(HarnessError);
    });

    it("formats snapshot markdown summary and detailed outputs", () => {
      const snap = createTestSnapshot();
      snap.tasks = [{ id: "t-1", status: "done", effortMath: "1 Work", dependencies: [] }];
      snap.uncommittedFiles = ["src/test.ts"];

      const evalData: CircuitBreakerEvaluation = {
        status: "constrained",
        isTriggered: true,
        lowestRemainingQuota: 5,
        constrainedModels: [{ modelName: "claude-3-opus" }],
        breakerStates: [],
      };

      const summaryMd = formatDagSnapshotMarkdown(snap, evalData, false);
      expect(summaryMd).toContain("## Quota DAG Snapshot");
      expect(summaryMd).toContain("5%");
      expect(summaryMd).not.toContain("src/test.ts");

      const detailedMd = formatDagSnapshotMarkdown(snap, evalData, true);
      expect(detailedMd).toContain("src/test.ts");
      expect(detailedMd).toContain("t-1");
    });
  });

  describe("snapshot-persistence", () => {
    it("persists and loads snapshot cleanly", () => {
      const snap = createTestSnapshot();
      const savedPath = persistDagSnapshot(snap);
      expect(savedPath).toBe(canonicalPath(TEST_DIR));

      const loaded = loadDagSnapshot(TEST_DIR);
      expect(loaded).toBeDefined();
      expect(loaded?.status).toBe("frozen");
      expect(loaded?.frozenAt).toBe(snap.frozenAt);
      expect(loaded?.lowestQuotaObserved).toBe(5);
    });

    it("returns undefined when loading from empty repository", () => {
      const emptyDir = join(TEST_DIR, "empty-repo");
      mkdirSync(emptyDir, { recursive: true });
      expect(loadDagSnapshot(emptyDir)).toBeUndefined();
    });

    it("rejects invalid JSON in snapshot file with HarnessError", () => {
      const oltDir = join(TEST_DIR, ".olt");
      mkdirSync(oltDir, { recursive: true });
      writeFileSync(join(oltDir, "quota-dag-snapshot.json"), "{ invalid: json");
      expect(() => loadDagSnapshot(TEST_DIR)).toThrow(HarnessError);
    });

    it("refuses symlinks and hardlinks pointing to external inodes", () => {
      const extFile = join(TEST_DIR, "ext.json");
      const targetPath = join(TEST_DIR, ".olt", "quota-dag-snapshot.json");
      mkdirSync(join(TEST_DIR, ".olt"), { recursive: true });
      writeFileSync(extFile, "external content");

      symlinkSync(extFile, targetPath);
      expect(() => loadDagSnapshot(TEST_DIR)).toThrow();

      rmSync(targetPath);
      linkSync(extFile, targetPath);
      expect(() => loadDagSnapshot(TEST_DIR)).toThrow();
    });

    it("handles persistence failure hooks and rollbacks", () => {
      persistDagSnapshot(createTestSnapshot());
      const path = canonicalPath(TEST_DIR);
      const original = readFileSync(path, "utf8");

      for (const stage of ["before_write", "before_file_fsync", "before_rename"] as const) {
        __setDagSnapshotPersistenceTestHook((observed) => {
          if (observed === stage) throw new Error(`simulated_${stage}`);
        });
        expect(() => persistDagSnapshot(createTestSnapshot(TEST_DIR, TEST_DIR, 20))).toThrow(
          `simulated_${stage}`,
        );
        expect(readFileSync(path, "utf8")).toBe(original);
      }
    });

    it("validates persistence helper functions", () => {
      expect(requiredText("valid", "field")).toBe("valid");
      expect(() => requiredText("", "field")).toThrow(HarnessError);
      expect(timestamp("2026-01-01T00:00:00Z", "time")).toBe("2026-01-01T00:00:00Z");
      expect(() => timestamp("invalid", "time")).toThrow(HarnessError);
      expect(strings(["a", "b"], "arr")).toEqual(["a", "b"]);
      expect(() => strings("not-array", "arr")).toThrow(HarnessError);

      const testError = new Error("File not found");
      Object.defineProperty(testError, "code", { value: "ENOENT", configurable: true });
      expect(isOwnCode(testError, "ENOENT")).toBe(true);
      expect(isOwnCode(testError, "EEXIST")).toBe(false);
      expect(isOwnCode({}, "ENOENT")).toBe(false);
    });
  });

  describe("snapshot-resume", () => {
    it("resumes a frozen snapshot and updates status to resumed", async () => {
      const snap = createTestSnapshot();
      snap.activeWave = { waveId: "wave-1", status: "frozen", lanes: ["lane-1", "lane-2"] };
      persistDagSnapshot(snap);

      const res = await resumeDagSnapshot({ repoRoot: TEST_DIR, runRoot: TEST_DIR });
      expect(res.restoredWaveLanes).toEqual(["lane-1", "lane-2"]);
      expect(res.cronsToReRegister).toHaveLength(STANDARD_SUPERVISORY_CRONS.length);
      expect(res.resumeDirectives[0]).toContain("Re-register crons");

      const loaded = loadDagSnapshot(TEST_DIR);
      expect(loaded?.status).toBe("resumed");
      expect(loaded?.resumedAt).toBeDefined();
    });

    it("throws HarnessError on missing snapshot to resume", async () => {
      const emptyDir = join(TEST_DIR, "no-snap-repo");
      mkdirSync(emptyDir, { recursive: true });
      expect(resumeDagSnapshot({ repoRoot: emptyDir, runRoot: TEST_DIR })).rejects.toThrow(
        HarnessError,
      );
    });

    it("throws HarnessError when trying to resume already resumed snapshot", async () => {
      persistDagSnapshot(createTestSnapshot());
      await resumeDagSnapshot({ repoRoot: TEST_DIR, runRoot: TEST_DIR });

      expect(resumeDagSnapshot({ repoRoot: TEST_DIR, runRoot: TEST_DIR })).rejects.toThrow(
        "quota snapshot is already resumed",
      );
    });

    it("refuses clearAfterResume to preserve durable evidence", async () => {
      persistDagSnapshot(createTestSnapshot());
      expect(
        resumeDagSnapshot({ repoRoot: TEST_DIR, runRoot: TEST_DIR, clearAfterResume: true }),
      ).rejects.toThrow("quota snapshot must remain as durable evidence");
    });

    it("formats resume markdown correctly", () => {
      const result: ResumeDagSnapshotResult = {
        restoredWaveLanes: ["lane-alpha"],
        cronsToReRegister: STANDARD_SUPERVISORY_CRONS,
        resumeDirectives: ["Directive alpha"],
      };

      const md = formatDagResumeMarkdown(result, true);
      expect(md).toContain("## DAG Resume State");
      expect(md).toContain("lane-alpha");
      expect(md).toContain("Directive alpha");
    });
  });
});
