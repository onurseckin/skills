import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  computeCriticalPathDepth,
  pairValidatorsStrictly,
  assertUnboundedConcurrencySafety,
  validateDepthInvariants,
  scheduleUnlimitedDepthDAG,
  type DepthMetrics,
  type UnboundedWavePartition,
} from "../../../olt/scripts/src/scheduler/unlimited-depth.ts";
import { topologyState } from "./fixtures.ts";

describe("Unlimited Depth DAG Scheduler & Validator Pairing", () => {
  describe("computeCriticalPathDepth", () => {
    test("computes critical path and effort for a linear chain", () => {
      const deps = new Map([
        ["t1", new Set<string>()],
        ["t2", new Set(["t1"])],
        ["t3", new Set(["t2"])],
      ]);
      const tasks = [
        {
          id: "t1",
          priority: 1,
          created_order: 1,
          effort: 2,
          requirement_ids: [],
          write_scope: [],
        },
        {
          id: "t2",
          priority: 1,
          created_order: 2,
          effort: 3,
          requirement_ids: [],
          write_scope: [],
        },
        {
          id: "t3",
          priority: 1,
          created_order: 3,
          effort: 1,
          requirement_ids: [],
          write_scope: [],
        },
      ];

      const result = computeCriticalPathDepth(deps, tasks);
      expect(result.depth).toBe(3);
      expect(result.criticalPath).toEqual(["t1", "t2", "t3"]);
      expect(result.longestChainEffort).toBe(6);
    });

    test("computes critical path for diamond DAG choosing longest effort branch", () => {
      const deps = new Map([
        ["start", new Set<string>()],
        ["fast-branch", new Set(["start"])],
        ["heavy-branch", new Set(["start"])],
        ["end", new Set(["fast-branch", "heavy-branch"])],
      ]);
      const tasks = new Map([
        [
          "start",
          {
            id: "start",
            priority: 1,
            created_order: 1,
            effort: 1,
            requirement_ids: [],
            write_scope: [],
          },
        ],
        [
          "fast-branch",
          {
            id: "fast-branch",
            priority: 1,
            created_order: 2,
            effort: 1,
            requirement_ids: [],
            write_scope: [],
          },
        ],
        [
          "heavy-branch",
          {
            id: "heavy-branch",
            priority: 1,
            created_order: 3,
            effort: 5,
            requirement_ids: [],
            write_scope: [],
          },
        ],
        [
          "end",
          {
            id: "end",
            priority: 1,
            created_order: 4,
            effort: 2,
            requirement_ids: [],
            write_scope: [],
          },
        ],
      ]);

      const result = computeCriticalPathDepth(deps, tasks);
      expect(result.depth).toBe(3);
      expect(result.criticalPath).toEqual(["start", "heavy-branch", "end"]);
      expect(result.longestChainEffort).toBe(8);
    });

    test("handles deep 50-step DAG without arbitrary depth limits", () => {
      const deps = new Map<string, Set<string>>();
      const tasks: {
        id: string;
        priority: number;
        created_order: number;
        effort: number;
        requirement_ids: string[];
        write_scope: string[];
      }[] = [];

      for (let i = 1; i <= 50; i++) {
        const id = `node-${i}`;
        const prereqs = i === 1 ? new Set<string>() : new Set([`node-${i - 1}`]);
        deps.set(id, prereqs);
        tasks.push({
          id,
          priority: 1,
          created_order: i,
          effort: 1,
          requirement_ids: [],
          write_scope: [],
        });
      }

      const result = computeCriticalPathDepth(deps, tasks);
      expect(result.depth).toBe(50);
      expect(result.criticalPath.length).toBe(50);
      expect(result.criticalPath[0]).toBe("node-1");
      expect(result.criticalPath[49]).toBe("node-50");
      expect(result.longestChainEffort).toBe(50);
    });

    test("returns empty critical path on empty DAG", () => {
      const result = computeCriticalPathDepth(new Map(), []);
      expect(result.depth).toBe(0);
      expect(result.criticalPath).toEqual([]);
      expect(result.longestChainEffort).toBe(0);
    });

    test("throws INTEGRITY error on cycle", () => {
      const deps = new Map([
        ["a", new Set(["b"])],
        ["b", new Set(["a"])],
      ]);
      const tasks = [
        {
          id: "a",
          priority: 1,
          created_order: 1,
          effort: 1,
          requirement_ids: [],
          write_scope: [],
        },
        {
          id: "b",
          priority: 1,
          created_order: 2,
          effort: 1,
          requirement_ids: [],
          write_scope: [],
        },
      ];

      expect(() => computeCriticalPathDepth(deps, tasks)).toThrow("execution cycle");
    });
  });

  describe("pairValidatorsStrictly", () => {
    test("pairs code-quality as baseline validator for generic tasks", () => {
      const tasks = [
        {
          id: "task-backend",
          priority: 1,
          created_order: 1,
          effort: 1,
          requirement_ids: [],
          write_scope: ["src/utils/calc.ts"],
        },
      ];

      const pairings = pairValidatorsStrictly(tasks);
      expect(pairings.length).toBe(1);
      expect(pairings[0]!.taskId).toBe("task-backend");
      expect(pairings[0]!.applicableDomains).toEqual(["code-quality"]);
      expect(pairings[0]!.pairedValidatorDomains).toEqual(["code-quality"]);
      expect(pairings[0]!.isPaired).toBe(true);
      expect(pairings[0]!.pairingStrictness).toBe("strict");
    });

    test("strictly pairs multi-domain validators for UI and system design write scopes", () => {
      const tasks = [
        {
          id: "task-ui",
          priority: 1,
          created_order: 1,
          effort: 1,
          requirement_ids: [],
          write_scope: ["src/components/Modal.tsx", "src/styles/theme.css"],
        },
        {
          id: "task-schema",
          priority: 1,
          created_order: 2,
          effort: 1,
          requirement_ids: [],
          write_scope: ["src/contracts/user.graphql"],
        },
      ];

      const pairings = pairValidatorsStrictly(tasks);
      expect(pairings.length).toBe(2);

      const uiPair = pairings.find((p) => p.taskId === "task-ui");
      expect(uiPair).toBeDefined();
      expect(uiPair?.applicableDomains).toContain("code-quality");
      expect(uiPair?.applicableDomains).toContain("ui-design");
      expect(uiPair?.pairedValidatorDomains).toContain("code-quality");
      expect(uiPair?.pairedValidatorDomains).toContain("ui-design");
      expect(uiPair?.isPaired).toBe(true);

      const schemaPair = pairings.find((p) => p.taskId === "task-schema");
      expect(schemaPair).toBeDefined();
      expect(schemaPair?.applicableDomains).toContain("code-quality");
      expect(schemaPair?.applicableDomains).toContain("system-design");
      expect(schemaPair?.pairedValidatorDomains).toContain("code-quality");
      expect(schemaPair?.pairedValidatorDomains).toContain("system-design");
      expect(schemaPair?.isPaired).toBe(true);
    });

    test("pairs UI validator domain from requirement text signals", () => {
      const tasks = [
        {
          id: "task-req-ui",
          priority: 1,
          created_order: 1,
          effort: 1,
          requirement_ids: [],
          write_scope: ["src/logic/state.ts"],
        },
      ];
      const reqTexts = new Map([
        ["task-req-ui", ["Verify responsive visual viewport and WCAG contrast ratio"]],
      ]);

      const pairings = pairValidatorsStrictly(tasks, { requirementTexts: reqTexts });
      expect(pairings[0]!.applicableDomains).toContain("ui-design");
      expect(pairings[0]!.pairedValidatorDomains).toContain("ui-design");
      expect(pairings[0]!.isPaired).toBe(true);
    });

    test("supports relaxed pairing mode and assigned implementer metadata", () => {
      const tasks = [
        {
          id: "task-rel",
          priority: 1,
          created_order: 1,
          effort: 1,
          requirement_ids: [],
          write_scope: ["src/view.tsx"],
        },
      ];
      const assigned = new Map([["task-rel", "implementer_task-rel"]]);

      const pairings = pairValidatorsStrictly(tasks, {
        pairingStrictness: "relaxed",
        assignedImplementers: assigned,
      });

      expect(pairings[0]!.assignedImplementer).toBe("implementer_task-rel");
      expect(pairings[0]!.pairingStrictness).toBe("relaxed");
    });
  });

  describe("assertUnboundedConcurrencySafety", () => {
    test("passes on waves with isolated write scopes and compliant parallelism", () => {
      const waves: UnboundedWavePartition[] = [
        {
          wave: 1,
          taskIds: ["t1", "t2"],
          tasks: [
            {
              id: "t1",
              priority: 1,
              created_order: 1,
              effort: 1,
              requirement_ids: [],
              write_scope: ["src/a.ts"],
            },
            {
              id: "t2",
              priority: 1,
              created_order: 2,
              effort: 1,
              requirement_ids: [],
              write_scope: ["src/b.ts"],
            },
          ],
          depth: 1,
          parallelism: 2,
          validatorPairings: [],
          isolatedWriteScopes: ["src/a.ts", "src/b.ts"],
          isUnbounded: true,
        },
      ];

      expect(() => assertUnboundedConcurrencySafety(waves, 4)).not.toThrow();
    });

    test("throws INVALID_STATE on write scope conflict in same wave", () => {
      const waves: UnboundedWavePartition[] = [
        {
          wave: 1,
          taskIds: ["t1", "t2"],
          tasks: [
            {
              id: "t1",
              priority: 1,
              created_order: 1,
              effort: 1,
              requirement_ids: [],
              write_scope: ["src/shared.ts"],
            },
            {
              id: "t2",
              priority: 1,
              created_order: 2,
              effort: 1,
              requirement_ids: [],
              write_scope: ["src/shared.ts"],
            },
          ],
          depth: 1,
          parallelism: 2,
          validatorPairings: [],
          isolatedWriteScopes: ["src/shared.ts"],
          isUnbounded: true,
        },
      ];

      expect(() => assertUnboundedConcurrencySafety(waves, 4)).toThrow(
        "conflict on write or resource scope",
      );
    });

    test("throws INVALID_STATE on wave exceeding max_parallel ceiling", () => {
      const waves: UnboundedWavePartition[] = [
        {
          wave: 1,
          taskIds: ["t1", "t2", "t3"],
          tasks: [
            {
              id: "t1",
              priority: 1,
              created_order: 1,
              effort: 1,
              requirement_ids: [],
              write_scope: ["src/a.ts"],
            },
            {
              id: "t2",
              priority: 1,
              created_order: 2,
              effort: 1,
              requirement_ids: [],
              write_scope: ["src/b.ts"],
            },
            {
              id: "t3",
              priority: 1,
              created_order: 3,
              effort: 1,
              requirement_ids: [],
              write_scope: ["src/c.ts"],
            },
          ],
          depth: 1,
          parallelism: 3,
          validatorPairings: [],
          isolatedWriteScopes: ["src/a.ts", "src/b.ts", "src/c.ts"],
          isUnbounded: true,
        },
      ];

      expect(() => assertUnboundedConcurrencySafety(waves, 2)).toThrow(
        "exceeds max_parallel limit",
      );
    });
  });

  describe("validateDepthInvariants", () => {
    test("validates compliant depth metrics", () => {
      const metrics: DepthMetrics = {
        totalTasks: 10,
        maxWaveDepth: 4,
        criticalPathLength: 4,
        criticalPathTasks: ["t1", "t2", "t3", "t4"],
        longestChainEffort: 8,
        maxConcurrentWidth: 3,
        averageConcurrency: 2.5,
        unboundedSafetyVerified: true,
        validatorPairingRate: 1.0,
      };

      const result = validateDepthInvariants(metrics);
      expect(result.valid).toBe(true);
      expect(result.violations).toEqual([]);
    });

    test("detects violations for unverified concurrency safety and incomplete validator pairing", () => {
      const metrics: DepthMetrics = {
        totalTasks: 5,
        maxWaveDepth: 2,
        criticalPathLength: 2,
        criticalPathTasks: ["t1", "t2"],
        longestChainEffort: 4,
        maxConcurrentWidth: 3,
        averageConcurrency: 2.5,
        unboundedSafetyVerified: false,
        validatorPairingRate: 0.8,
      };

      const result = validateDepthInvariants(metrics, {
        require_strict_validator_pairing: true,
      });
      expect(result.valid).toBe(false);
      expect(result.violations).toContain(
        "strict validator pairing rate must be 1.0 (100% paired)",
      );
      expect(result.violations).toContain("unbounded concurrency safety must be verified");
    });

    test("detects violation when configured max_depth is exceeded", () => {
      const metrics: DepthMetrics = {
        totalTasks: 10,
        maxWaveDepth: 6,
        criticalPathLength: 6,
        criticalPathTasks: ["t1", "t2", "t3", "t4", "t5", "t6"],
        longestChainEffort: 6,
        maxConcurrentWidth: 2,
        averageConcurrency: 1.67,
        unboundedSafetyVerified: true,
        validatorPairingRate: 1.0,
      };

      const result = validateDepthInvariants(metrics, { max_depth: 4 });
      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.includes("exceeds configured max_depth"))).toBe(true);
    });
  });

  describe("scheduleUnlimitedDepthDAG", () => {
    test("schedules standard DAG state into waves with metrics and strict validator pairings", () => {
      const state = topologyState();
      const result = scheduleUnlimitedDepthDAG(state, { default_max_parallel: 4 });

      expect(result.revision).toBe(3);
      expect(result.max_parallel).toBe(4);
      expect(result.waves.length).toBe(2);
      expect(result.metrics.totalTasks).toBe(4);
      expect(result.metrics.maxWaveDepth).toBe(2);
      expect(result.metrics.criticalPathLength).toBe(2);
      expect(result.metrics.unboundedSafetyVerified).toBe(true);
      expect(result.metrics.validatorPairingRate).toBe(1.0);
      expect(result.pairings.length).toBe(4);
      expect(result.pairings.every((p) => p.isPaired)).toBe(true);
      expect(result.decisions.length).toBe(4);
    });

    test("schedules arbitrarily deep linear DAG of 20 waves seamlessly", () => {
      const tasksRecord: Record<string, Record<string, unknown>> = {};
      const edges: { source: string; target: string; type: string }[] = [];

      for (let i = 1; i <= 20; i++) {
        const id = `deep-task-${i}`;
        const prereqs = i === 1 ? [] : [`deep-task-${i - 1}`];
        tasksRecord[id] = {
          id,
          priority: 1,
          created_order: i,
          effort: 1,
          requirement_ids: ["R-001"],
          write_scope: [`src/deep/step_${i}.ts`],
          resource_scope: [],
          status: "ready",
          dependencies: prereqs,
        };
        if (i > 1) {
          edges.push({
            source: id,
            target: `deep-task-${i - 1}`,
            type: "depends_on",
          });
        }
      }

      const deepState = {
        graph: {
          schema: "harness.graph",
          version: 1,
          revision: 1,
          nodes: Object.keys(tasksRecord).map((id) => ({
            id,
            type: "task",
            requirement_ids: ["R-001"],
          })),
          edges,
          gates: [],
        },
        requirements: {
          schema: "harness.requirements",
          version: 1,
          prompt_sha256: "0".repeat(64),
          requirements: [{ id: "R-001", disposition: "actionable", dependencies: [] }],
          dispositions: [],
        },
        tasks: tasksRecord,
      };

      const result = scheduleUnlimitedDepthDAG(deepState, { default_max_parallel: 4 });

      expect(result.waves.length).toBe(20);
      expect(result.metrics.maxWaveDepth).toBe(20);
      expect(result.metrics.criticalPathLength).toBe(20);
      expect(result.metrics.totalTasks).toBe(20);
      expect(result.metrics.unboundedSafetyVerified).toBe(true);
      expect(result.metrics.validatorPairingRate).toBe(1.0);
      expect(result.waves[0]!.taskIds).toEqual(["deep-task-1"]);
      expect(result.waves[19]!.taskIds).toEqual(["deep-task-20"]);
    });

    test("records agent-reported rationales when supplied", () => {
      const state = topologyState();
      const customRationale = "Custom manual prioritization rationale";
      const result = scheduleUnlimitedDepthDAG(state, {
        default_max_parallel: 4,
        rationales: { "t-alpha": customRationale },
      });

      const alphaDecision = result.decisions.find((d) => d.task_id === "t-alpha");
      expect(alphaDecision).toBeDefined();
      expect(alphaDecision?.rationale).toBe(customRationale);
      expect(alphaDecision?.evidence_class).toBe("agent_reported");
    });

    test("throws INVALID_STATE when graph revision is missing", () => {
      const invalidState = {
        graph: { revision: 0 },
        tasks: {},
      };

      expect(() => scheduleUnlimitedDepthDAG(invalidState)).toThrow(
        "graph revision is required to schedule DAG",
      );
    });
  });

  describe("Static Invariants & Typing", () => {
    test("unlimited-depth.ts contains 0 any types and 0 linter/compiler suppressions", () => {
      const filePath = join(
        import.meta.dir,
        "../../../olt/scripts/src/scheduler/unlimited-depth.ts",
      );
      const content = readFileSync(filePath, "utf-8");

      expect(content).not.toMatch(/: any\b/);
      expect(content).not.toMatch(/as any\b/);
      expect(content).not.toMatch(/<any>/);
      expect(content).not.toMatch(/@ts-ignore/);
      expect(content).not.toMatch(/@ts-expect-error/);
      expect(content).not.toMatch(/@ts-nocheck/);
      expect(content).not.toMatch(/eslint-disable/);
    });
  });
});
