import { describe, expect, test } from "bun:test";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import {
  assertNoFalseSerialization,
  detectFalseSerialization,
} from "../../olt/scripts/src/orchestrator/velocity-rebalancer.ts";
import type {
  SynthesizedTaskSpec,
  TopologyWavePlan,
} from "../../olt/scripts/src/orchestrator/topology/types.ts";

describe("Domain 20: False-Serialization Prevention", () => {
  test("detects false serialization when independent task is put in later wave despite capacity and disjoint scopes", () => {
    const tasks: SynthesizedTaskSpec[] = [
      { id: "task-auth", writeScope: ["src/auth/"] },
      { id: "task-billing", writeScope: ["src/billing/"] },
    ];

    // Artificially placed in separate waves even though capacity is 4 and scopes are disjoint
    const waves: TopologyWavePlan[] = [
      {
        wave: 1,
        taskIds: ["task-auth"],
        capacity: 4,
        writeScopes: ["src/auth/"],
        dependenciesSatisfied: [],
        estimatedEffort: 1,
      },
      {
        wave: 2,
        taskIds: ["task-billing"],
        capacity: 4,
        writeScopes: ["src/billing/"],
        dependenciesSatisfied: ["task-auth"],
        estimatedEffort: 1,
      },
    ];

    const report = detectFalseSerialization(tasks, waves, 4);

    expect(report.detected).toBe(true);
    expect(report.violations.length).toBe(1);
    expect(report.violations[0]?.taskIdB).toBe("task-billing");
    expect(report.violations[0]?.reason).toContain("disjoint write scopes");
  });

  test("does NOT flag false serialization when tasks have overlapping write scopes", () => {
    const tasks: SynthesizedTaskSpec[] = [
      { id: "task-schema", writeScope: ["src/models/user.ts"] },
      { id: "task-model", writeScope: ["src/models/user.ts"] },
    ];

    const waves: TopologyWavePlan[] = [
      {
        wave: 1,
        taskIds: ["task-schema"],
        capacity: 4,
        writeScopes: ["src/models/user.ts"],
        dependenciesSatisfied: [],
        estimatedEffort: 1,
      },
      {
        wave: 2,
        taskIds: ["task-model"],
        capacity: 4,
        writeScopes: ["src/models/user.ts"],
        dependenciesSatisfied: ["task-schema"],
        estimatedEffort: 1,
      },
    ];

    const report = detectFalseSerialization(tasks, waves, 4);
    expect(report.detected).toBe(false);
    expect(report.violations.length).toBe(0);
  });

  test("does NOT flag false serialization when tasks have explicit dependencies", () => {
    const tasks: SynthesizedTaskSpec[] = [
      { id: "task-parent", writeScope: ["src/a.ts"] },
      { id: "task-child", writeScope: ["src/b.ts"], dependencies: ["task-parent"] },
    ];

    const waves: TopologyWavePlan[] = [
      {
        wave: 1,
        taskIds: ["task-parent"],
        capacity: 4,
        writeScopes: ["src/a.ts"],
        dependenciesSatisfied: [],
        estimatedEffort: 1,
      },
      {
        wave: 2,
        taskIds: ["task-child"],
        capacity: 4,
        writeScopes: ["src/b.ts"],
        dependenciesSatisfied: ["task-parent"],
        estimatedEffort: 1,
      },
    ];

    const report = detectFalseSerialization(tasks, waves, 4);
    expect(report.detected).toBe(false);
  });

  test("does NOT flag false serialization when prior wave was at full capacity", () => {
    const tasks: SynthesizedTaskSpec[] = [
      { id: "task-1", writeScope: ["src/1.ts"] },
      { id: "task-2", writeScope: ["src/2.ts"] },
      { id: "task-3", writeScope: ["src/3.ts"] },
      { id: "task-4", writeScope: ["src/4.ts"] },
      { id: "task-5", writeScope: ["src/5.ts"] },
    ];

    const waves: TopologyWavePlan[] = [
      {
        wave: 1,
        taskIds: ["task-1", "task-2", "task-3", "task-4"],
        capacity: 4,
        writeScopes: ["src/1.ts", "src/2.ts", "src/3.ts", "src/4.ts"],
        dependenciesSatisfied: [],
        estimatedEffort: 4,
      },
      {
        wave: 2,
        taskIds: ["task-5"],
        capacity: 4,
        writeScopes: ["src/5.ts"],
        dependenciesSatisfied: ["task-1", "task-2", "task-3", "task-4"],
        estimatedEffort: 1,
      },
    ];

    const report = detectFalseSerialization(tasks, waves, 4);
    expect(report.detected).toBe(false);
  });

  test("assertNoFalseSerialization throws HarnessError INTEGRITY on violations", () => {
    const tasks: SynthesizedTaskSpec[] = [
      { id: "t1", writeScope: ["src/t1/"] },
      { id: "t2", writeScope: ["src/t2/"] },
    ];
    const waves: TopologyWavePlan[] = [
      {
        wave: 1,
        taskIds: ["t1"],
        capacity: 2,
        writeScopes: ["src/t1/"],
        dependenciesSatisfied: [],
        estimatedEffort: 1,
      },
      {
        wave: 2,
        taskIds: ["t2"],
        capacity: 2,
        writeScopes: ["src/t2/"],
        dependenciesSatisfied: [],
        estimatedEffort: 1,
      },
    ];

    expect(() =>
      assertNoFalseSerialization(tasks, waves, { maxParallel: 2, strict: true }),
    ).toThrow(HarnessError);
  });
});
