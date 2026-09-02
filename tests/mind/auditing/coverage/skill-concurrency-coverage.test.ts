import { describe, expect, it } from "bun:test";
import {
  auditConcurrencySaturation,
  auditSkillConcurrencySaturation,
  SKILL_CONCURRENCY_UNDER_SATURATED,
  UNSTAGED_STATION_DURABILITY_RISK,
} from "../../../../olt/scripts/src/mind/auditing/skill-concurrency-auditor.ts";
import type {
  AssemblyStation,
  GitStagingInvariantRecord,
  StragglerAssessment,
} from "../../../../olt/scripts/src/mind/preplanning/types.ts";

const dummyStaging: GitStagingInvariantRecord = {
  staging_id: "st-1",
  milestone_id: "m-1",
  subdomain: "core",
  staged_at: "2026-09-01T00:00:00Z",
  staged_files: ["file.ts"],
  git_index_sha: "sha-123456",
  blob_objects_written: 1,
};

describe("Skill Concurrency Auditor Coverage Suite", () => {
  it("exports expected invariant risk constants", () => {
    expect(SKILL_CONCURRENCY_UNDER_SATURATED).toBe("SKILL_CONCURRENCY_UNDER_SATURATED");
    expect(UNSTAGED_STATION_DURABILITY_RISK).toBe("UNSTAGED_STATION_DURABILITY_RISK");
  });

  it("evaluates default empty audit options with full saturation", () => {
    const report = auditConcurrencySaturation();
    expect(report.totalSlots).toBe(0);
    expect(report.activeSlots).toBe(0);
    expect(report.saturationRatio).toBe(1);
    expect(report.isSaturated).toBe(true);
    expect(report.underParallelizedTasks).toEqual([]);
    expect(report.unstagedStations).toEqual([]);
    expect(report.stragglingTasks).toEqual([]);
    expect(report.findings[0]).toContain("fully saturated");

    const result = auditSkillConcurrencySaturation();
    expect(result.is_saturated).toBe(true);
    expect(result.active_workers).toBe(0);
    expect(result.optimal_concurrency).toBe(0);
    expect(result.saturation_ratio).toBe(1);
  });

  it("detects under-saturation when work units > 5 and active slots < 2 with fallback task", () => {
    const report = auditConcurrencySaturation({
      totalWorkUnits: 10,
      activeSlots: 1,
      spanLength: 2,
    });
    expect(report.isSaturated).toBe(false);
    expect(report.findings.some((f) => f.includes(SKILL_CONCURRENCY_UNDER_SATURATED))).toBe(true);
    expect(report.warnings.some((w) => w.includes(SKILL_CONCURRENCY_UNDER_SATURATED))).toBe(true);
    expect(report.underParallelizedTasks).toEqual(["workload-10-units"]);
  });

  it("populates underParallelizedTasks from queuedTasks array or pre-supplied list", () => {
    const queuedReport = auditConcurrencySaturation({
      queuedTasks: ["task-a", "task-b", "task-c", "task-d", "task-e", "task-f"],
      activeSlots: 0,
      minSaturationRatio: 0.9,
    });
    expect(queuedReport.isSaturated).toBe(false);
    expect(queuedReport.underParallelizedTasks).toEqual([
      "task-a",
      "task-b",
      "task-c",
      "task-d",
      "task-e",
      "task-f",
    ]);

    const explicitReport = auditConcurrencySaturation({
      totalWorkUnits: 8,
      activeSlots: 1,
      underParallelizedTasks: ["custom-task-1"],
    });
    expect(explicitReport.underParallelizedTasks).toEqual(["custom-task-1"]);
  });

  it("populates underParallelizedTasks from pending stations when queuedTasks is a number", () => {
    const stations: AssemblyStation[] = [
      {
        station_id: "st-pending-1",
        domain: "core",
        milestone_id: "m1",
        assigned_files: [],
        status: "PENDING",
      },
      {
        station_id: "st-active-1",
        domain: "core",
        milestone_id: "m1",
        assigned_files: [],
        status: "IN_PROGRESS",
      },
      {
        station_id: "st-landed-1",
        domain: "core",
        milestone_id: "m1",
        assigned_files: [],
        status: "LANDED",
        staging_record: dummyStaging,
      },
    ];
    const report = auditConcurrencySaturation({
      activeStations: stations,
      queuedTasks: 6,
      totalSlots: 5,
      activeSlots: 1,
      minSaturationRatio: 0.8,
    });
    expect(report.isSaturated).toBe(false);
    expect(report.underParallelizedTasks).toEqual(["st-pending-1"]);
  });

  it("detects unstaged stations when LANDED or VERIFIED without git index sha", () => {
    const stations: AssemblyStation[] = [
      {
        station_id: "st-verified-bad",
        domain: "validation",
        milestone_id: "m1",
        assigned_files: [],
        status: "VERIFIED",
      },
      {
        station_id: "st-landed-no-sha",
        domain: "engine",
        milestone_id: "m1",
        assigned_files: [],
        status: "LANDED",
        staging_record: { ...dummyStaging, git_index_sha: "" },
      },
      {
        station_id: "st-verified-ok",
        domain: "mind",
        milestone_id: "m1",
        assigned_files: [],
        status: "VERIFIED",
        staging_record: dummyStaging,
      },
      {
        station_id: "st-failed",
        domain: "core",
        milestone_id: "m1",
        assigned_files: [],
        status: "FAILED",
      },
    ];
    const report = auditConcurrencySaturation({
      activeStations: stations,
      totalSlots: 2,
      activeSlots: 2,
      minSaturationRatio: 0.5,
    });
    expect(report.unstagedStations).toContain("st-verified-bad");
    expect(report.unstagedStations).toContain("st-landed-no-sha");
    expect(report.unstagedStations).not.toContain("st-verified-ok");
    expect(report.findings.some((f) => f.includes(UNSTAGED_STATION_DURABILITY_RISK))).toBe(true);
    expect(report.isSaturated).toBe(false);
  });

  it("records straggler tasks and emits warnings", () => {
    const assessments: StragglerAssessment[] = [
      {
        task_id: "task-fast",
        agent_id: "ag-1",
        elapsed_seconds: 30,
        is_straggler: false,
        recommended_action: "CONTINUE",
      },
      {
        task_id: "task-slow",
        agent_id: "ag-2",
        elapsed_seconds: 450.5,
        is_straggler: true,
        recommended_action: "DECOMPOSE_PARALLEL",
      },
    ];
    const report = auditConcurrencySaturation({
      stragglingAssessments: assessments,
      totalSlots: 1,
      activeSlots: 1,
    });
    expect(report.stragglingTasks).toEqual(["task-slow"]);
    expect(report.warnings.some((w) => w.includes("Straggler task task-slow"))).toBe(true);
    expect(report.isSaturated).toBe(false);
  });

  it("computes active slots automatically from stations when activeSlots is undefined", () => {
    const stations: AssemblyStation[] = [
      {
        station_id: "st-prog",
        domain: "core",
        milestone_id: "m1",
        assigned_files: [],
        status: "IN_PROGRESS",
      },
      {
        station_id: "st-ver",
        domain: "core",
        milestone_id: "m1",
        assigned_files: [],
        status: "VERIFIED",
        staging_record: dummyStaging,
      },
      {
        station_id: "st-pend",
        domain: "core",
        milestone_id: "m1",
        assigned_files: [],
        status: "PENDING",
      },
    ];
    const report = auditConcurrencySaturation({
      activeStations: stations,
      totalSlots: 2,
    });
    expect(report.activeSlots).toBe(2);
    expect(report.saturationRatio).toBe(1);
    expect(report.isSaturated).toBe(true);
  });
});
