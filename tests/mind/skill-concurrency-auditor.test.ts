import { describe, expect, it } from "bun:test";
import {
  auditConcurrencySaturation,
  auditSkillConcurrencySaturation,
  SKILL_CONCURRENCY_UNDER_SATURATED,
  UNSTAGED_STATION_DURABILITY_RISK,
  type ConcurrencyAuditOptions,
  type ConcurrencyAuditResult,
  type ConcurrencySaturationReport,
} from "../../olt/scripts/src/mind/auditing/skill-concurrency-auditor.ts";
import type {
  AssemblyStation,
  GitStagingInvariantRecord,
  StragglerAssessment,
} from "../../olt/scripts/src/mind/preplanning/types.ts";

describe("Active Anti-Passivity: Skill Concurrency Saturation Auditor (Task 3.2)", () => {
  const sampleStagingRecord: GitStagingInvariantRecord = {
    staging_id: "staging-core-1",
    milestone_id: "m1",
    subdomain: "core",
    staged_at: "2026-08-29T10:00:00Z",
    staged_files: ["src/core.ts"],
    git_index_sha: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
    blob_objects_written: 1,
  };

  const createStations = (
    count: number,
    status: AssemblyStation["status"] = "IN_PROGRESS",
  ): AssemblyStation[] =>
    Array.from({ length: count }, (_, i) => ({
      station_id: `s-${i + 1}`,
      domain: `domain-${i + 1}`,
      milestone_id: "m1",
      assigned_files: [],
      status,
    }));

  describe("auditConcurrencySaturation()", () => {
    it("reports saturated when active slots match optimal concurrency and stations are staged", () => {
      const stations = createStations(5, "IN_PROGRESS");
      const report: ConcurrencySaturationReport = auditConcurrencySaturation({
        activeStations: stations,
        totalWorkUnits: 5,
      });

      expect(report.isSaturated).toBe(true);
      expect(report.activeSlots).toBe(5);
      expect(report.totalSlots).toBe(5);
      expect(report.saturationRatio).toBe(1);
      expect(report.underParallelizedTasks.length).toBe(0);
      expect(report.unstagedStations.length).toBe(0);
      expect(report.findings[0]).toContain("fully saturated");
    });

    it("flags SKILL_CONCURRENCY_UNDER_SATURATED when active slots fall below optimal concurrency", () => {
      const stations = createStations(1, "IN_PROGRESS");
      const report = auditConcurrencySaturation({
        activeStations: stations,
        totalWorkUnits: 10,
      });

      expect(report.isSaturated).toBe(false);
      expect(report.activeSlots).toBe(1);
      expect(report.totalSlots).toBe(10);
      expect(report.saturationRatio).toBe(0.1);
      expect(report.findings.some((f) => f.includes(SKILL_CONCURRENCY_UNDER_SATURATED))).toBe(true);
      expect(report.warnings.some((w) => w.includes(SKILL_CONCURRENCY_UNDER_SATURATED))).toBe(true);
      expect(report.underParallelizedTasks.length).toBeGreaterThan(0);
    });

    it("flags SKILL_CONCURRENCY_UNDER_SATURATED when > 5 tasks are queued and active slots < 2", () => {
      const queued = ["task-1", "task-2", "task-3", "task-4", "task-5", "task-6"];
      const report = auditConcurrencySaturation({
        queuedTasks: queued,
        activeSlots: 1,
        totalSlots: 6,
      });

      expect(report.isSaturated).toBe(false);
      expect(report.activeSlots).toBe(1);
      expect(report.underParallelizedTasks).toEqual(queued);
      expect(report.findings.some((f) => f.includes(SKILL_CONCURRENCY_UNDER_SATURATED))).toBe(true);
    });

    it("flags UNSTAGED_STATION_DURABILITY_RISK when stations land without Git staging record", () => {
      const stations: readonly AssemblyStation[] = [
        {
          station_id: "station-unstaged-core",
          domain: "core",
          milestone_id: "m1",
          assigned_files: ["src/core.ts"],
          status: "LANDED",
        },
        {
          station_id: "station-staged-val",
          domain: "validation",
          milestone_id: "m1",
          assigned_files: ["tests/val.ts"],
          status: "LANDED",
          staging_record: sampleStagingRecord,
        },
      ];

      const report = auditConcurrencySaturation({
        activeStations: stations,
        totalWorkUnits: 2,
      });

      expect(report.isSaturated).toBe(false);
      expect(report.unstagedStations).toEqual(["station-unstaged-core"]);
      expect(report.findings.some((f) => f.includes(UNSTAGED_STATION_DURABILITY_RISK))).toBe(true);
    });

    it("surfaces straggling task warnings requiring dynamic decomposition", () => {
      const stragglerAssessments: readonly StragglerAssessment[] = [
        {
          task_id: "task-heavy-1",
          agent_id: "agent-1",
          elapsed_seconds: 420,
          is_straggler: true,
          recommended_action: "DECOMPOSE_PARALLEL",
        },
      ];

      const report = auditConcurrencySaturation({
        activeStations: [],
        totalWorkUnits: 0,
        stragglingAssessments: stragglerAssessments,
      });

      expect(report.isSaturated).toBe(false);
      expect(report.stragglingTasks).toEqual(["task-heavy-1"]);
      expect(report.warnings.some((w) => w.includes("task-heavy-1"))).toBe(true);
    });
  });

  describe("auditSkillConcurrencySaturation()", () => {
    it("returns ConcurrencyAuditResult compatible structure matching saturation report", () => {
      const stations = createStations(5, "IN_PROGRESS");
      const result: ConcurrencyAuditResult = auditSkillConcurrencySaturation({
        activeStations: stations,
        totalWorkUnits: 5,
      });

      expect(result.is_saturated).toBe(true);
      expect(result.active_workers).toBe(5);
      expect(result.optimal_concurrency).toBe(5);
      expect(result.saturation_ratio).toBe(1);
      expect(result.unstaged_stations).toEqual([]);
      expect(result.straggling_tasks).toEqual([]);
      expect(result.findings[0]).toContain("fully saturated");
    });

    it("flags under-saturation and unstaged stations in ConcurrencyAuditResult", () => {
      const stations: readonly AssemblyStation[] = [
        {
          station_id: "station-unstaged-1",
          domain: "core",
          milestone_id: "m1",
          assigned_files: ["src/a.ts"],
          status: "VERIFIED",
        },
      ];

      const result = auditSkillConcurrencySaturation({
        activeStations: stations,
        totalWorkUnits: 8,
      });

      expect(result.is_saturated).toBe(false);
      expect(result.unstaged_stations).toEqual(["station-unstaged-1"]);
      expect(result.findings.some((f) => f.includes(SKILL_CONCURRENCY_UNDER_SATURATED))).toBe(true);
      expect(result.findings.some((f) => f.includes(UNSTAGED_STATION_DURABILITY_RISK))).toBe(true);
    });

    it("handles undefined options gracefully", () => {
      const result = auditSkillConcurrencySaturation();
      expect(result.is_saturated).toBe(true);
      expect(result.active_workers).toBe(0);
      expect(result.optimal_concurrency).toBe(0);
    });
  });
});
