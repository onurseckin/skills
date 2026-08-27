import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import {
  captureDagSnapshot,
  persistDagSnapshot,
  loadDagSnapshot,
  resumeDagSnapshot,
  formatDagSnapshotMarkdown,
  formatDagResumeMarkdown,
  STANDARD_SUPERVISORY_CRONS,
  __setDagSnapshotPersistenceTestHook,
  type QuotaDagSnapshot,
} from "../../../olt/scripts/src/telemetry/dag-snapshot.ts";
import { resolveQuotaDagSnapshotPath } from "../../../olt/scripts/src/core/shared/paths.ts";
import { readTelemetryStream } from "../../../olt/scripts/src/reporting/telemetry-stream.ts";

describe("DAG Snapshot", () => {
  const TMP_DIR = join(process.cwd(), "tests-tmp-dag-snapshot");

  beforeEach(() => {
    if (!existsSync(TMP_DIR)) {
      mkdirSync(TMP_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    __setDagSnapshotPersistenceTestHook(undefined);
    if (existsSync(TMP_DIR)) {
      rmSync(TMP_DIR, { recursive: true, force: true });
    }
  });

  function frozenSnapshot(
    repositoryRoot = TMP_DIR,
    runRoot = TMP_DIR,
    lowestQuotaObserved = 1,
  ): QuotaDagSnapshot {
    return {
      version: "2",
      repositoryRoot,
      runRoot,
      frozenAt: "2024-01-01T00:00:00Z",
      status: "frozen",
      tasks: [],
      agents: [],
      cronsSuspended: [],
      uncommittedFiles: [],
      lowestQuotaObserved,
      constrainedModels: [],
      autoWakeSchedule: {
        resetTime: "2024-01-01T01:00:00Z",
        resumeTime: "2024-01-01T01:01:00Z",
      },
    };
  }

  describe("captureDagSnapshot", () => {
    it("should capture basic state without memory.json", async () => {
      const snapshot = await captureDagSnapshot({
        runRoot: TMP_DIR,
        repositoryRoot: process.cwd(),
        lowestQuotaObserved: 2,
        constrainedModels: ["gemini-pro"],
        resetTime: new Date().toISOString(),
      });

      expect(snapshot.status).toBe("frozen");
      expect(snapshot.cronsSuspended).toEqual(STANDARD_SUPERVISORY_CRONS);
      expect(snapshot.tasks).toEqual([]);
      expect(snapshot.agents).toEqual([]);
      expect(snapshot.activeWave).toBeUndefined();
      expect(snapshot.lowestQuotaObserved).toBe(2);
      expect(snapshot.constrainedModels).toEqual(["gemini-pro"]);
      expect(snapshot.autoWakeSchedule.resetTime).toBeDefined();
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
        repositoryRoot: process.cwd(),
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
        version: "2",
        repositoryRoot: TMP_DIR,
        runRoot: TMP_DIR,
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

      persistDagSnapshot(snapshot);
      const loaded = loadDagSnapshot(TMP_DIR);
      expect(loaded).toBeDefined();
      expect(loaded?.frozenAt).toBe(snapshot.frozenAt);
      expect(loaded?.status).toBe("frozen");
    });

    it("rejects a corrupted canonical snapshot instead of treating it as absent", () => {
      const snapshotPath = join(TMP_DIR, ".olt", "quota-dag-snapshot.json");
      mkdirSync(join(TMP_DIR, ".olt"), { recursive: true });
      writeFileSync(snapshotPath, "{ bad json }");
      expect(() => loadDagSnapshot(TMP_DIR)).toThrow("quota snapshot contains invalid JSON");
    });

    it("refuses a symlinked canonical snapshot without touching its external target", () => {
      const external = join(TMP_DIR, "external-snapshot.json");
      const snapshotPath = join(TMP_DIR, ".olt", "quota-dag-snapshot.json");
      mkdirSync(join(TMP_DIR, ".olt"), { recursive: true });
      writeFileSync(external, "external sentinel", "utf8");
      symlinkSync(external, snapshotPath);

      expect(() => loadDagSnapshot(TMP_DIR)).toThrow();
      expect(readFileSync(external, "utf8")).toBe("external sentinel");
    });

    it("refuses a hardlinked canonical snapshot without touching its external inode", () => {
      const external = join(TMP_DIR, "external-snapshot.json");
      const snapshotPath = join(TMP_DIR, ".olt", "quota-dag-snapshot.json");
      mkdirSync(join(TMP_DIR, ".olt"), { recursive: true });
      writeFileSync(external, "external sentinel", "utf8");
      linkSync(external, snapshotPath);

      expect(() => loadDagSnapshot(TMP_DIR)).toThrow();
      expect(readFileSync(external, "utf8")).toBe("external sentinel");
    });

    it("preserves the prior bytes when write, file-fsync, or rename fails before commit", () => {
      persistDagSnapshot(frozenSnapshot());
      const path = join(TMP_DIR, ".olt", "quota-dag-snapshot.json");
      const before = readFileSync(path, "utf8");

      for (const stage of ["before_write", "before_file_fsync", "before_rename"] as const) {
        __setDagSnapshotPersistenceTestHook((observed) => {
          if (observed === stage) throw new Error(`fault:${stage}`);
        });
        expect(() => persistDagSnapshot(frozenSnapshot(TMP_DIR, TMP_DIR, 2))).toThrow(
          `fault:${stage}`,
        );
        __setDagSnapshotPersistenceTestHook(undefined);
        expect(readFileSync(path, "utf8")).toBe(before);
      }
    });

    it("reports post-rename durability uncertainty without false success telemetry and restarts from a whole state", () => {
      persistDagSnapshot(frozenSnapshot());
      for (const stage of ["after_rename", "before_directory_fsync"] as const) {
        const repo = join(TMP_DIR, stage);
        mkdirSync(repo);
        persistDagSnapshot(frozenSnapshot(repo, TMP_DIR, 1));
        __setDagSnapshotPersistenceTestHook((observed) => {
          if (observed === stage) throw new Error(`fault:${stage}`);
        });
        expect(() => persistDagSnapshot(frozenSnapshot(repo, TMP_DIR, 2))).toThrow(
          "outcome is uncertain after atomic rename",
        );
        __setDagSnapshotPersistenceTestHook(undefined);
        expect(loadDagSnapshot(repo)?.lowestQuotaObserved).toBe(2);
        expect(
          readTelemetryStream(repo).filter((event) => event.action === "QUOTA_FREEZE_SNAPSHOT"),
        ).toHaveLength(1);
      }
    });
  });

  describe("resumeDagSnapshot", () => {
    it("rejects a missing snapshot instead of reporting an empty resume", async () => {
      mkdirSync(join(TMP_DIR, "missing-repo"));
      expect(
        resumeDagSnapshot({ repoRoot: join(TMP_DIR, "missing-repo"), runRoot: TMP_DIR }),
      ).rejects.toThrow("no quota snapshot is available");
    });

    it("should resume and mark snapshot as resumed", async () => {
      const snapshot: QuotaDagSnapshot = {
        version: "2",
        repositoryRoot: join(TMP_DIR, "resume-repo"),
        runRoot: TMP_DIR,
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

      const result = await resumeDagSnapshot({ repoRoot: repoPath, runRoot: TMP_DIR });

      expect(result.restoredWaveLanes).toEqual(["lane-1", "lane-2"]);
      expect(result.cronsToReRegister.length).toBeGreaterThan(0);

      const rawContent = readFileSync(customPath, "utf-8");
      const updated = JSON.parse(rawContent) as QuotaDagSnapshot;
      expect(updated.status).toBe("resumed");
      expect(updated.resumedAt).toBeDefined();
    });

    it("refuses a snapshot bound to another run without mutating its bytes", async () => {
      const repoPath = join(TMP_DIR, "wrong-run-repo");
      mkdirSync(repoPath);
      const snapshot: QuotaDagSnapshot = {
        version: "2",
        repositoryRoot: repoPath,
        runRoot: TMP_DIR,
        frozenAt: "2024-01-01T00:00:00Z",
        status: "frozen",
        tasks: [],
        agents: [],
        cronsSuspended: [],
        uncommittedFiles: [],
        lowestQuotaObserved: 1,
        constrainedModels: [],
        autoWakeSchedule: {
          resetTime: "2024-01-01T01:00:00Z",
          resumeTime: "2024-01-01T01:01:00Z",
        },
      };
      persistDagSnapshot(snapshot);
      const path = join(repoPath, ".olt", "quota-dag-snapshot.json");
      const before = readFileSync(path, "utf8");

      await expect(
        resumeDagSnapshot({ repoRoot: repoPath, runRoot: join(TMP_DIR, "other-run") }),
      ).rejects.toThrow("bound to another repository or run");
      expect(readFileSync(path, "utf8")).toBe(before);
    });

    it("serializes two independent resume processes into one lifecycle transition", async () => {
      const repo = join(TMP_DIR, "cross-process-repo");
      mkdirSync(repo);
      persistDagSnapshot(frozenSnapshot(repo));
      const modulePath = new URL(
        "../../../olt/scripts/src/telemetry/dag-snapshot.ts",
        import.meta.url,
      ).pathname;
      const child = `
        import { resumeDagSnapshot } from ${JSON.stringify(modulePath)};
        try {
          await resumeDagSnapshot({ repoRoot: process.env.QUOTA_REPO, runRoot: process.env.QUOTA_RUN });
          console.log("success");
        } catch (error) {
          console.log(error && typeof error === "object" && "code" in error ? error.code : "error");
        }
      `;
      const environment = { ...process.env, QUOTA_REPO: repo, QUOTA_RUN: TMP_DIR };
      const first = Bun.spawn([process.execPath, "-e", child], {
        env: environment,
        stdout: "pipe",
        stderr: "pipe",
      });
      const second = Bun.spawn([process.execPath, "-e", child], {
        env: environment,
        stdout: "pipe",
        stderr: "pipe",
      });
      await Promise.all([first.exited, second.exited]);
      const outcomes = await Promise.all([
        new Response(first.stdout).text(),
        new Response(second.stdout).text(),
      ]);

      expect(outcomes.filter((outcome) => outcome.trim() === "success")).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.trim() === "INVALID_STATE")).toHaveLength(1);
      expect(loadDagSnapshot(repo)?.status).toBe("resumed");
    });

    it("should clear snapshot if clearAfterResume is true", async () => {
      const snapshot: QuotaDagSnapshot = {
        version: "2",
        repositoryRoot: join(TMP_DIR, "resume-clear-repo"),
        runRoot: TMP_DIR,
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

      await expect(
        resumeDagSnapshot({ repoRoot: repoPath, runRoot: TMP_DIR, clearAfterResume: true }),
      ).rejects.toThrow("quota snapshot must remain as durable evidence");
      expect(existsSync(customPath)).toBe(true);
    });
  });

  describe("Markdown formatting", () => {
    const snapshot: QuotaDagSnapshot = {
      version: "2",
      repositoryRoot: TMP_DIR,
      runRoot: TMP_DIR,
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
