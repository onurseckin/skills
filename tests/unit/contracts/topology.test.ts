import { describe, expect, test } from "bun:test";
import {
  isTopologyDecision,
  isTopologyReason,
  isTopologyRecord,
  isTopologyWave,
  readTopology,
  TOPOLOGY_REASONS,
  topologyWavesByTask,
  type TopologyDecision,
  type TopologyRecord,
  type TopologyWave,
} from "../../../olt/scripts/src/core/contracts/topology.ts";

describe("core contracts/topology", () => {
  test("TOPOLOGY_REASONS and isTopologyReason validate reasons", () => {
    expect(TOPOLOGY_REASONS).toContain("dependency");
    expect(TOPOLOGY_REASONS).toContain("write_scope_conflict");
    expect(TOPOLOGY_REASONS).toContain("priority_capacity");

    expect(isTopologyReason("dependency")).toBe(true);
    expect(isTopologyReason("write_scope_conflict")).toBe(true);
    expect(isTopologyReason("priority_capacity")).toBe(true);
    expect(isTopologyReason("unknown")).toBe(false);
    expect(isTopologyReason(123)).toBe(false);
  });

  test("isTopologyWave validates wave structures", () => {
    expect(isTopologyWave({ wave: 1, task_ids: ["t1", "t2"] })).toBe(true);
    expect(isTopologyWave({ wave: 0, task_ids: [] })).toBe(true);
    expect(isTopologyWave({ wave: -1, task_ids: [] })).toBe(true);
    expect(isTopologyWave({ wave: "1", task_ids: [] })).toBe(false);
    expect(isTopologyWave({ wave: 1, task_ids: [123] })).toBe(false);
    expect(isTopologyWave(null)).toBe(false);
  });

  test("isTopologyDecision validates topological decisions", () => {
    const validDecision: TopologyDecision = {
      task_id: "t2",
      wave: 2,
      parallel_with: ["t3"],
      serialized_after: ["t1"],
      reason: "dependency",
      rationale: "Depends on t1 output",
      evidence_class: "harness_observed",
    };

    expect(isTopologyDecision(validDecision)).toBe(true);
    expect(isTopologyDecision({ ...validDecision, task_id: 123 })).toBe(false);
    expect(isTopologyDecision({ ...validDecision, reason: "invalid" })).toBe(false);
    expect(isTopologyDecision({ ...validDecision, evidence_class: "bad" })).toBe(false);
    expect(isTopologyDecision(null)).toBe(false);
  });

  test("isTopologyRecord, readTopology, and topologyWavesByTask operate on complete topologies", () => {
    const validRecord: TopologyRecord = {
      revision: 1,
      max_parallel: 2,
      waves: [
        { wave: 1, task_ids: ["t1", "t2"] },
        { wave: 2, task_ids: ["t3"] },
      ],
      decisions: [
        {
          task_id: "t3",
          wave: 2,
          parallel_with: [],
          serialized_after: ["t1"],
          reason: "dependency",
          rationale: "Requires t1",
          evidence_class: "harness_observed",
        },
      ],
    };

    expect(isTopologyRecord(validRecord)).toBe(true);
    expect(isTopologyRecord({ ...validRecord, revision: "1" })).toBe(false);
    expect(isTopologyRecord({ ...validRecord, waves: "bad" })).toBe(false);
    expect(isTopologyRecord(null)).toBe(false);

    expect(readTopology({ topology: validRecord })).toEqual(validRecord);
    expect(readTopology({ topology: { revision: "bad" } })).toBeNull();
    expect(readTopology(null)).toBeNull();

    const wavesMap = topologyWavesByTask(validRecord);
    expect(wavesMap.get("t1")).toBe(1);
    expect(wavesMap.get("t2")).toBe(1);
    expect(wavesMap.get("t3")).toBe(2);
  });
});
