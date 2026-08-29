import { describe, expect, it } from "bun:test";
import {
  auditSkillConcurrencySaturation,
  SKILL_CONCURRENCY_UNDER_SATURATED,
  UNSTAGED_STATION_DURABILITY_RISK,
} from "../../../olt/scripts/src/mind/auditing/skill-concurrency-auditor.ts";
import type {
  AssemblyStation,
  GitStagingInvariantRecord,
  StragglerAssessment,
} from "../../../olt/scripts/src/mind/preplanning/types.ts";

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

  it("reports saturated when active workers match optimal concurrency and stations are staged", () => {
    const stations: readonly AssemblyStation[] = [
      {
        station_id: "s1",
        domain: "core",
        milestone_id: "m1",
        assigned_files: [],
        status: "IN_PROGRESS",
      },
      {
        station_id: "s2",
        domain: "validation",
        milestone_id: "m1",
        assigned_files: [],
        status: "IN_PROGRESS",
      },
      {
        station_id: "s3",
        domain: "tooling",
        milestone_id: "m1",
        assigned_files: [],
        status: "IN_PROGRESS",
      },
      {
        station_id: "s4",
        domain: "engine",
        milestone_id: "m1",
        assigned_files: [],
        status: "IN_PROGRESS",
      },
      {
        station_id: "s5",
        domain: "mind",
        milestone_id: "m1",
        assigned_files: [],
        status: "IN_PROGRESS",
      },
    ];

    const result = auditSkillConcurrencySaturation({
      activeStations: stations,
      totalWorkUnits: 5,
    });

    expect(result.is_saturated).toBe(true);
    expect(result.active_workers).toBe(5);
    expect(result.optimal_concurrency).toBe(5);
    expect(result.saturation_ratio).toBe(1);
    expect(result.unstaged_stations.length).toBe(0);
    expect(result.findings[0]).toContain("fully saturated");
  });

  it("flags SKILL_CONCURRENCY_UNDER_SATURATED when active workers fall below optimal concurrency", () => {
    const stations: readonly AssemblyStation[] = [
      {
        station_id: "s1",
        domain: "core",
        milestone_id: "m1",
        assigned_files: [],
        status: "IN_PROGRESS",
      },
    ];

    // 10 work units -> P = 10 optimal workers, but only 1 active -> 10% saturation
    const result = auditSkillConcurrencySaturation({
      activeStations: stations,
      totalWorkUnits: 10,
    });

    expect(result.is_saturated).toBe(false);
    expect(result.active_workers).toBe(1);
    expect(result.optimal_concurrency).toBe(10);
    expect(result.saturation_ratio).toBe(0.1);
    expect(result.findings.some((f) => f.includes(SKILL_CONCURRENCY_UNDER_SATURATED))).toBe(true);
  });

  it("flags UNSTAGED_STATION_DURABILITY_RISK when stations land without Git staging record", () => {
    const stations: readonly AssemblyStation[] = [
      {
        station_id: "station-unstaged-core",
        domain: "core",
        milestone_id: "m1",
        assigned_files: ["src/core.ts"],
        status: "LANDED",
        // staging_record is missing!
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

    const result = auditSkillConcurrencySaturation({
      activeStations: stations,
      totalWorkUnits: 2,
    });

    expect(result.is_saturated).toBe(false);
    expect(result.unstaged_stations).toEqual(["station-unstaged-core"]);
    expect(result.findings.some((f) => f.includes(UNSTAGED_STATION_DURABILITY_RISK))).toBe(true);
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

    const result = auditSkillConcurrencySaturation({
      activeStations: [],
      totalWorkUnits: 0,
      stragglingAssessments: stragglerAssessments,
    });

    expect(result.is_saturated).toBe(false);
    expect(result.straggling_tasks).toEqual(["task-heavy-1"]);
    expect(result.warnings.some((w) => w.includes("task-heavy-1"))).toBe(true);
  });
});
