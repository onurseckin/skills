import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  persistDagSnapshot,
  loadDagSnapshot,
  resumeDagSnapshot,
  STANDARD_SUPERVISORY_CRONS,
  type QuotaDagSnapshot,
} from "../../../olt/scripts/src/telemetry/dag-snapshot.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";

describe("DAG Snapshot Resume & Recovery", () => {
  const roots: string[] = [];
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = realpathSync(mkdtempSync(join(tmpdir(), "snap-resume-")));
    roots.push(tmpDir);
  });

  afterEach(() => {
    for (const root of roots.splice(0)) {
      if (existsSync(root)) {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  function frozenSnapshot(
    repositoryRoot = tmpDir,
    runRoot = tmpDir,
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
      cronsSuspended: STANDARD_SUPERVISORY_CRONS,
      uncommittedFiles: [],
      lowestQuotaObserved,
      constrainedModels: [],
      autoWakeSchedule: {
        resetTime: "2024-01-01T01:00:00Z",
        resumeTime: "2024-01-01T01:01:00Z",
      },
    };
  }

  it("rejects a missing snapshot instead of reporting an empty resume", async () => {
    const missingRepo = join(tmpDir, "missing-repo");
    mkdirSync(missingRepo);
    expect(
      resumeDagSnapshot({ repoRoot: missingRepo, runRoot: tmpDir }),
    ).rejects.toThrow("no quota snapshot is available");
  });

  it("should resume and mark snapshot as resumed", async () => {
    const snapshot: QuotaDagSnapshot = {
      version: "2",
      repositoryRoot: join(tmpDir, "resume-repo"),
      runRoot: tmpDir,
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

    const repoPath = join(tmpDir, "resume-repo");
    const targetDir = join(repoPath, ".olt");
    mkdirSync(targetDir, { recursive: true });
    const customPath = join(targetDir, "quota-dag-snapshot.json");
    writeFileSync(customPath, JSON.stringify(snapshot));

    const result = await resumeDagSnapshot({ repoRoot: repoPath, runRoot: tmpDir });

    expect(result.restoredWaveLanes).toEqual(["lane-1", "lane-2"]);
    expect(result.cronsToReRegister.length).toBeGreaterThan(0);

    const rawContent = readFileSync(customPath, "utf-8");
    const updated = JSON.parse(rawContent) as QuotaDagSnapshot;
    expect(updated.status).toBe("resumed");
    expect(updated.resumedAt).toBeDefined();
  });

  it("refuses a snapshot bound to another run without mutating its bytes", async () => {
    const repoPath = join(tmpDir, "wrong-run-repo");
    mkdirSync(repoPath);
    const snapshot: QuotaDagSnapshot = {
      version: "2",
      repositoryRoot: repoPath,
      runRoot: tmpDir,
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
      resumeDagSnapshot({ repoRoot: repoPath, runRoot: join(tmpDir, "other-run") }),
    ).rejects.toThrow("bound to another repository or run");
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("serializes two independent resume processes into one lifecycle transition", async () => {
    const repo = join(tmpDir, "cross-process-repo");
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
    const environment = { ...process.env, QUOTA_REPO: repo, QUOTA_RUN: tmpDir };
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

  it("refuses clearAfterResume to preserve durable evidence", async () => {
    const snapshot: QuotaDagSnapshot = {
      version: "2",
      repositoryRoot: join(tmpDir, "resume-clear-repo"),
      runRoot: tmpDir,
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

    const repoPath = join(tmpDir, "resume-clear-repo");
    const targetDir = join(repoPath, ".olt");
    mkdirSync(targetDir, { recursive: true });
    const customPath = join(targetDir, "quota-dag-snapshot.json");
    writeFileSync(customPath, JSON.stringify(snapshot));

    await expect(
      resumeDagSnapshot({ repoRoot: repoPath, runRoot: tmpDir, clearAfterResume: true }),
    ).rejects.toThrow("quota snapshot must remain as durable evidence");
    expect(existsSync(customPath)).toBe(true);
  });
});
