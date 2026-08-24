import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { existsSync, writeFileSync, rmSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import {
  captureDagSnapshot,
  persistDagSnapshot,
  loadDagSnapshot,
  resumeDagSnapshot,
  formatDagSnapshotMarkdown,
  formatDagResumeMarkdown,
  STANDARD_SUPERVISORY_CRONS,
  type QuotaDagSnapshot,
} from "../../../olt/scripts/src/telemetry/dag-snapshot.ts";
import { resolveQuotaDagSnapshotPath } from "../../../olt/scripts/src/core/shared/paths.ts";

describe("DAG Snapshot", () => {
  const TMP_DIR = join(process.cwd(), "tests-tmp-dag-snapshot");

  beforeEach(() => {
    if (!existsSync(TMP_DIR)) {
      mkdirSync(TMP_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (existsSync(TMP_DIR)) {
      rmSync(TMP_DIR, { recursive: true, force: true });
    }
  });

  describe("captureDagSnapshot", () => {
    it("should capture basic state without memory.json", async () => {
      const snapshot = await captureDagSnapshot({
        runRoot: TMP_DIR,
        lowestQuotaObserved: 2,
        constrainedModels: ["gemini-pro"],
        resetTime: new Date().toISOString(),
      });

      expect(snapshot.status).toBe("frozen");
      expect(snapshot.cronsSuspended).toEqual(STANDARD_SUPERVISORY_CRONS);
      expect(snapshot.tasks).toEqual([]);
      expect(snapshot.agents).toEqual([]);
      expect(snapshot.activeWave).toBeUndefined();
    });

    it("should parse memory.json if available", async () => {
      const memoryObj = {
        tasks: [
          {
            id: "t1",
            status: "running",
            effortMath: "2 Work",
            agent: "agent-1",
            dependencies: ["t0"],
          },
        ],
        agents: [{ id: "agent-1", role: "coder", status: "active" }],
        activeWave: { waveId: "w1", status: "active", lanes: ["lane-1"] },
      };

      writeFileSync(join(TMP_DIR, "memory.json"), JSON.stringify(memoryObj));

      const snapshot = await captureDagSnapshot({
        runRoot: TMP_DIR,
        lowestQuotaObserved: 3,
        constrainedModels: [],
        resetTime: new Date().toISOString(),
      });

      expect(snapshot.tasks.length).toBe(1);
      expect(snapshot.tasks[0].id).toBe("t1");
      expect(snapshot.tasks[0].effortMath).toBe("2 Work");

      expect(snapshot.agents.length).toBe(1);
      expect(snapshot.agents[0].id).toBe("agent-1");

      expect(snapshot.activeWave?.waveId).toBe("w1");
      expect(snapshot.activeWave?.lanes).toEqual(["lane-1"]);
    });
  });

  describe("persistDagSnapshot & loadDagSnapshot", () => {
    it("should load correctly after manually writing a snapshot file", () => {
      const snapshot: QuotaDagSnapshot = {
        version: "1.0.0",
        frozenAt: "2024-01-01T00:00:00Z",
        status: "frozen",
        tasks: [],
        agents: [],
        cronsSuspended: [],
        uncommittedFiles: [],
        lowestQuotaObserved: 1,
        constrainedModels: [],
        autoWakeSchedule: { resetTime: "2024-01-01T01:00:00Z", resumeTime: "2024-01-01T01:01:00Z" },
      };

      const customPath = join(TMP_DIR, "test-snapshot.json");
      writeFileSync(customPath, JSON.stringify(snapshot, null, 2), "utf-8");

      const loaded = loadDagSnapshot(undefined, customPath);
      expect(loaded).not.toBeNull();
      expect(loaded?.frozenAt).toBe(snapshot.frozenAt);
      expect(loaded?.status).toBe("frozen");
    });

    it("loadDagSnapshot should return null if file missing", () => {
      const loaded = loadDagSnapshot(undefined, join(TMP_DIR, "missing.json"));
      expect(loaded).toBeNull();
    });

    it("loadDagSnapshot should return null if file is corrupted JSON", () => {
      const customPath = join(TMP_DIR, "corrupt.json");
      writeFileSync(customPath, "{ bad json }");
      const loaded = loadDagSnapshot(undefined, customPath);
      expect(loaded).toBeNull();
    });
  });

  describe("resumeDagSnapshot", () => {
    it("should return empty state if no snapshot exists", async () => {
      const result = await resumeDagSnapshot({ repoRoot: join(TMP_DIR, "missing-repo") });
      expect(result.restoredWaveLanes).toEqual([]);
      expect(result.cronsToReRegister).toEqual([]);
    });

    it("should resume and mark snapshot as resumed", async () => {
      const snapshot: QuotaDagSnapshot = {
        version: "1.0.0",
        frozenAt: "2024-01-01T00:00:00Z",
        status: "frozen",
        tasks: [],
        agents: [],
        cronsSuspended: STANDARD_SUPERVISORY_CRONS,
        uncommittedFiles: [],
        lowestQuotaObserved: 1,
        constrainedModels: [],
        activeWave: { waveId: "w1", status: "frozen", lanes: ["lane-1", "lane-2"] },
        autoWakeSchedule: { resetTime: "2024-01-01T01:00:00Z", resumeTime: "2024-01-01T01:01:00Z" },
      };

      const repoPath = join(TMP_DIR, "resume-repo");
      const targetDir = join(repoPath, ".olt");
      mkdirSync(targetDir, { recursive: true });
      const customPath = join(targetDir, "quota-dag-snapshot.json");
      writeFileSync(customPath, JSON.stringify(snapshot));

      const result = await resumeDagSnapshot({ repoRoot: repoPath });

      expect(result.restoredWaveLanes).toEqual(["lane-1", "lane-2"]);
      expect(result.cronsToReRegister.length).toBeGreaterThan(0);

      const rawContent = readFileSync(customPath, "utf-8");
      const updated = JSON.parse(rawContent) as QuotaDagSnapshot;
      expect(updated.status).toBe("resumed");
      expect(updated.resumedAt).toBeDefined();
    });

    it("should clear snapshot if clearAfterResume is true", async () => {
      const snapshot: QuotaDagSnapshot = {
        version: "1.0.0",
        frozenAt: "2024-01-01T00:00:00Z",
        status: "frozen",
        tasks: [],
        agents: [],
        cronsSuspended: [],
        uncommittedFiles: [],
        lowestQuotaObserved: 1,
        constrainedModels: [],
        autoWakeSchedule: { resetTime: "2024-01-01T01:00:00Z", resumeTime: "2024-01-01T01:01:00Z" },
      };

      const repoPath = join(TMP_DIR, "resume-clear-repo");
      const targetDir = join(repoPath, ".olt");
      mkdirSync(targetDir, { recursive: true });
      const customPath = join(targetDir, "quota-dag-snapshot.json");
      writeFileSync(customPath, JSON.stringify(snapshot));

      await resumeDagSnapshot({ repoRoot: repoPath, clearAfterResume: true });
      expect(existsSync(customPath)).toBe(false);
    });
  });

  describe("Markdown formatting", () => {
    const snapshot: QuotaDagSnapshot = {
      version: "1.0.0",
      frozenAt: "2024-01-01T00:00:00Z",
      status: "frozen",
      tasks: [{ id: "t1", status: "running", effortMath: "1 Work", dependencies: [] }],
      agents: [],
      cronsSuspended: [],
      uncommittedFiles: ["src/index.ts"],
      lowestQuotaObserved: 2,
      constrainedModels: ["gemini-pro"],
      autoWakeSchedule: { resetTime: "2024-01-01T01:00:00Z", resumeTime: "2024-01-01T01:01:00Z" },
    };

    const evaluation: any = {
      status: "constrained" as const,
      isTriggered: true,
      lowestRemainingQuota: 2,
      constrainedModels: [{ modelName: "gemini-pro" }],
      breakerStates: [],
    };

    it("should format snapshot summary", () => {
      const md = formatDagSnapshotMarkdown(snapshot, evaluation, false);
      expect(md).toContain("Quota DAG Snapshot");
      expect(md).toContain("frozen");
      expect(md).toContain("gemini-pro");
      expect(md).not.toContain("src/index.ts");
    });

    it("should format detailed snapshot", () => {
      const md = formatDagSnapshotMarkdown(snapshot, evaluation, true);
      expect(md).toContain("src/index.ts");
      expect(md).toContain("1 Work");
    });

    it("should format resume summary", () => {
      const result = {
        restoredWaveLanes: ["lane-1"],
        cronsToReRegister: STANDARD_SUPERVISORY_CRONS,
        resumeDirectives: ["Directive 1"],
      };

      const md = formatDagResumeMarkdown(result, true);
      expect(md).toContain("DAG Resume State");
      expect(md).toContain("lane-1");
      expect(md).toContain("Directive 1");
    });
  });

  describe("resolveQuotaDagSnapshotPath", () => {
    it("should resolve relative to repoRoot", () => {
      const resolved = resolveQuotaDagSnapshotPath("/repo");
      expect(resolved.replace(/\\/g, "/")).toContain("/repo/.olt/quota-dag-snapshot.json");
    });

    it("should prefer customPath", () => {
      const resolved = resolveQuotaDagSnapshotPath("/repo", "/custom/path.json");
      expect(resolved.replace(/\\/g, "/")).toBe("/custom/path.json");
    });
  });
});
