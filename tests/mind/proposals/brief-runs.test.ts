import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as storeModule from "../../../olt/scripts/src/engine/store/index.ts";
import { extractLiveRuns, parseNowMs } from "../../../olt/scripts/src/mind/proposals/brief/runs.ts";

describe("Mind Proposal Brief Runs Module (runs.ts)", () => {
  let tempDir: string;
  let capsulesDir: string;
  let currentRunDir: string;
  let loadRunSpy: ReturnType<typeof spyOn> | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "brief-runs-test-"));
    capsulesDir = join(tempDir, "capsules");
    currentRunDir = join(capsulesDir, "run-current");
    mkdirSync(capsulesDir, { recursive: true });
    mkdirSync(currentRunDir, { recursive: true });
  });

  afterEach(() => {
    loadRunSpy?.mockRestore();
    loadRunSpy = undefined;
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("parseNowMs", () => {
    it("handles numbers, Date instances, strings, and undefined", () => {
      expect(parseNowMs(1234567890)).toBe(1234567890);
      expect(parseNowMs(0)).toBe(0);
      expect(parseNowMs(-500)).toBe(-500);

      const d = new Date("2026-09-01T12:00:00.000Z");
      expect(parseNowMs(d)).toBe(d.getTime());

      expect(parseNowMs("2026-09-01T12:00:00.000Z")).toBe(d.getTime());

      const beforeInvalid = Date.now();
      const parsedInvalid = parseNowMs("invalid-timestamp-string");
      expect(parsedInvalid).toBeGreaterThanOrEqual(beforeInvalid);

      const beforeUndef = Date.now();
      const parsedUndef = parseNowMs();
      expect(parsedUndef).toBeGreaterThanOrEqual(beforeUndef);
    });
  });

  describe("extractLiveRuns", () => {
    it("returns empty array if capsulesDir does not exist or is a regular file", () => {
      expect(extractLiveRuns(join(tempDir, "non-existent"), currentRunDir, Date.now())).toEqual([]);

      const filePath = join(tempDir, "regular-file.txt");
      writeFileSync(filePath, "not a directory");
      expect(extractLiveRuns(filePath, currentRunDir, Date.now())).toEqual([]);
    });

    it("filters out currentBasename, mind-* prefixed, dot files, and regular files", () => {
      mkdirSync(join(capsulesDir, "mind-agent-1"), { recursive: true });
      mkdirSync(join(capsulesDir, ".hidden-capsule"), { recursive: true });
      writeFileSync(join(capsulesDir, "stray-file.json"), "{}");

      const summaries = extractLiveRuns(capsulesDir, currentRunDir, Date.now());
      expect(summaries).toEqual([]);
    });

    it("skips directories where loadRun throws or completion status is complete", () => {
      const corruptDir = join(capsulesDir, "run-corrupt");
      const completedDir = join(capsulesDir, "run-complete");
      mkdirSync(corruptDir, { recursive: true });
      mkdirSync(completedDir, { recursive: true });

      loadRunSpy = spyOn(storeModule, "loadRun").mockImplementation((path: string) => {
        if (path.endsWith("run-corrupt")) {
          throw new Error("Corrupt run state");
        }
        return {
          manifest: {} as never,
          state: { completion_result: { status: "complete" } } as never,
          events: [],
        };
      });

      const summaries = extractLiveRuns(capsulesDir, currentRunDir, Date.now());
      expect(summaries).toEqual([]);
    });

    it("extracts and calculates comprehensive run summaries across execution phases", () => {
      const runPlanning = join(capsulesDir, "run-plan");
      const runExecuting = join(capsulesDir, "run-exec");
      const runValidating = join(capsulesDir, "run-valid");
      mkdirSync(runPlanning, { recursive: true });
      mkdirSync(runExecuting, { recursive: true });
      mkdirSync(runValidating, { recursive: true });

      const nowMs = 1756728000000;

      loadRunSpy = spyOn(storeModule, "loadRun").mockImplementation((path: string) => {
        if (path.endsWith("run-plan")) {
          return {
            manifest: {} as never,
            state: { tasks: {}, gates: {} } as never,
            events: [],
          };
        }
        if (path.endsWith("run-exec")) {
          return {
            manifest: {} as never,
            state: {
              graph: { nodes: [] },
              tasks: {
                t1: {
                  status: "ready",
                  lease: { expires_at: new Date(nowMs - 5000).toISOString() },
                  open_finding_ids: ["f1", "f2"],
                },
                t2: {
                  status: "retry_ready",
                  lease: { expires_at: new Date(nowMs + 5000).toISOString() },
                  open_finding_ids: ["f3"],
                },
                t3: {
                  status: "escalated",
                  lease: "not-an-object",
                  open_finding_ids: "not-an-array",
                },
                t4: {
                  status: "blocked",
                },
              },
              gates: {
                g1: { status: "passed" },
                g2: { exit_code: 0 },
                g3: { status: "failed" },
                g4: { exit_code: 2 },
                g5: { status: "in_progress" },
              },
            } as never,
            events: [],
          };
        }
        return {
          manifest: {} as never,
          state: {
            tasks: {
              t1: { status: "validating" },
            },
          } as never,
          events: [],
        };
      });

      const summaries = extractLiveRuns(capsulesDir, currentRunDir, nowMs);
      expect(summaries).toHaveLength(3);

      const planSummary = summaries.find((s) => s.runId === "run-plan");
      expect(planSummary).toBeDefined();
      expect(planSummary?.phase).toBe("planning");
      expect(planSummary?.tasksCount).toBe(0);
      expect(planSummary?.greenGatesCount).toBe(0);
      expect(planSummary?.totalGatesCount).toBe(0);

      const execSummary = summaries.find((s) => s.runId === "run-exec");
      expect(execSummary).toBeDefined();
      expect(execSummary?.phase).toBe("executing");
      expect(execSummary?.tasksCount).toBe(4);
      expect(execSummary?.leasedCount).toBe(3);
      expect(execSummary?.escalatedCount).toBe(1);
      expect(execSummary?.readyTasksCount).toBe(2);
      expect(execSummary?.hasStaleLease).toBe(true);
      expect(execSummary?.openFindingsCount).toBe(3);
      expect(execSummary?.greenGatesCount).toBe(2);
      expect(execSummary?.failingGatesCount).toBe(2);
      expect(execSummary?.totalGatesCount).toBe(5);

      const valSummary = summaries.find((s) => s.runId === "run-valid");
      expect(valSummary).toBeDefined();
      expect(valSummary?.phase).toBe("validating");
      expect(valSummary?.tasksCount).toBe(1);
      expect(valSummary?.hasStaleLease).toBe(false);
    });

    it("processes symbolic links targeting valid runs", () => {
      const realTarget = join(tempDir, "external-run-target");
      mkdirSync(realTarget, { recursive: true });
      const symlinkPath = join(capsulesDir, "run-symlink");
      symlinkSync(realTarget, symlinkPath);

      loadRunSpy = spyOn(storeModule, "loadRun").mockReturnValue({
        manifest: {} as never,
        state: { tasks: {} } as never,
        events: [],
      });

      const summaries = extractLiveRuns(capsulesDir, currentRunDir, Date.now());
      expect(summaries.some((s) => s.runId === "run-symlink")).toBe(true);
    });
  });
});
