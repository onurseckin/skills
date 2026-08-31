import { describe, expect, it } from "bun:test";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  synthesizeDynamicTopology,
} from "../../../../olt/scripts/src/engine/scheduler/topology/dynamic-synthesize.ts";
import {
  partitionOrchestratorDomains,
  calculateValidatorAllocations,
  calculateCriticConcurrency,
} from "../../../../olt/scripts/src/engine/scheduler/topology/dynamic-allocations.ts";
import {
  computeWorkSpanMetrics,
  computeResourceDisjointness,
} from "../../../../olt/scripts/src/engine/scheduler/topology/dynamic-metrics.ts";
import {
  SkillAuditorPolicy,
} from "../../../../olt/scripts/src/engine/scheduler/diagnostics/skill-auditor-policy.ts";
import {
  probeDoctorErrorResolution,
} from "../../../../olt/scripts/src/engine/scheduler/core/loop-doctor.ts";
import {
  resolveAgentSchedulerConfig,
  DEFAULT_HOST_INTERVAL_SECONDS,
} from "../../../../olt/scripts/src/engine/scheduler/host-cadence.ts";
import { generateAsciiDagBadges } from "../../../../olt/scripts/src/engine/scheduler/diagnostics/ascii-badges.ts";

describe("engine/scheduler/topology/dynamic", () => {
  const mockState = {
    graph: {
      schema: "harness.graph",
      version: 1,
      revision: 1,
      nodes: [{ id: "t1" }, { id: "t2" }],
      edges: [{ source: "t1", target: "t2" }],
      gates: [],
    },
    requirements: [
      {
        id: "req-1",
        disposition: "actionable",
      },
    ],
    tasks: {
      t1: {
        id: "t1",
        label: "Task 1",
        priority: 1,
        created_order: 1,
        effort: 2,
        requirement_ids: ["req-1"],
        write_scope: ["src/ui/Button.tsx"],
        resource_scope: [],
        status: "proposed",
      },
      t2: {
        id: "t2",
        label: "Task 2",
        priority: 1,
        created_order: 2,
        effort: 1,
        requirement_ids: ["req-1"],
        write_scope: ["src/backend/api.ts"],
        resource_scope: [],
        status: "proposed",
      },
    },
  };

  it("synthesizes dynamic topology with workspan metrics and partitions", () => {
    const syn = synthesizeDynamicTopology(mockState, { default_max_parallel: 4 });
    expect(syn.work).toBeGreaterThanOrEqual(1);
    expect(syn.span).toBeGreaterThanOrEqual(1);
    expect(syn.orchestratorPartitions.length).toBeGreaterThanOrEqual(1);
    expect(syn.waves.length).toBeGreaterThanOrEqual(1);
  });

  it("calculates validator allocations and critic concurrency", () => {
    const valAlloc = calculateValidatorAllocations(
      [
        {
          id: "t1",
          label: "t1",
          priority: 1,
          created_order: 1,
          effort: 1,
          requirement_ids: ["req-1"],
          write_scope: ["src/ui/app.tsx"],
          resource_scope: [],
          status: "proposed",
        },
      ],
      { "t1": [] },
    );
    expect(valAlloc).toBeDefined();

    const criticConcurrency = calculateCriticConcurrency(5, 2, 2);
    expect(criticConcurrency).toBeGreaterThanOrEqual(1);
  });

  it("computes resource disjointness", () => {
    const disjoint = computeResourceDisjointness([
      {
        id: "t1",
        label: "t1",
        priority: 1,
        created_order: 1,
        effort: 1,
        requirement_ids: ["req-1"],
        write_scope: ["src/a.ts"],
        resource_scope: ["db:1"],
        status: "ready",
      },
      {
        id: "t2",
        label: "t2",
        priority: 1,
        created_order: 2,
        effort: 1,
        requirement_ids: ["req-1"],
        write_scope: ["src/b.ts"],
        resource_scope: ["db:2"],
        status: "ready",
      },
    ]);
    expect(disjoint.disjointnessScore).toBe(1.0);
    expect(disjoint.disjointComponentCount).toBe(2);
  });
});

describe("engine/scheduler/diagnostics/skill-auditor-policy.ts", () => {
  it("validates mandatory targets and companion audits", () => {
    expect(SkillAuditorPolicy.isMandatoryTarget("/home/user/skills/proj")).toBe(true);
    expect(SkillAuditorPolicy.isMandatoryTarget("/home/user/other-project")).toBe(false);

    expect(() =>
      SkillAuditorPolicy.assertSkillAuditorRequired("/path/to/skills", []),
    ).toThrow(HarnessError);

    expect(() =>
      SkillAuditorPolicy.assertSkillAuditorRequired("/path/to/skills", [
        {
          agent_id: "auditor-1",
          role: "skill-auditor",
          fingerprint: "fp",
          issued_at: new Date().toISOString(),
        } as any,
      ]),
    ).not.toThrow();

    expect(() =>
      SkillAuditorPolicy.assertMindAuditorRequired("/path/to/skills", []),
    ).toThrow(HarnessError);
  });
});

describe("engine/scheduler/core/loop-doctor.ts", () => {
  it("probes doctor error resolution", () => {
    const healthy = probeDoctorErrorResolution(undefined, { healthy: true, issues: ["issue-1"] });
    expect(healthy.passed).toBe(false);
    expect(healthy.unresolvedErrors.length).toBe(1);

    const unhealthy = probeDoctorErrorResolution(undefined, { healthy: false });
    expect(unhealthy.passed).toBe(false);
  });
});

describe("engine/scheduler/host-cadence.ts", () => {
  it("resolves agent scheduler config from policy", () => {
    expect(DEFAULT_HOST_INTERVAL_SECONDS.antigravity).toBe(300);
    expect(DEFAULT_HOST_INTERVAL_SECONDS.cursor).toBe(300);
    expect(() => resolveAgentSchedulerConfig("")).toThrow(HarnessError);
  });
});

describe("engine/scheduler/diagnostics/ascii-badges.ts", () => {
  it("generates ascii dag badges", () => {
    const badges = generateAsciiDagBadges([
      { id: "t1", status: "done", dependencies: [] },
      { id: "t2", status: "ready", dependencies: ["t1"] },
    ]);
    expect(Array.isArray(badges)).toBe(true);
    expect(badges.length).toBe(2);
  });
});
