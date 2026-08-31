import { describe, expect, it } from "bun:test";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  isMultiDomainDispatchEligible,
  classifyTaskDomain,
  derivePrimaryValidatorDomain,
  isDualValidationRequired,
  getRequiredValidatorDomains,
  normalizeTask,
} from "../../../../olt/scripts/src/engine/scheduler/dispatch/multi-domain-types.ts";
import {
  resolveParallelismFactor,
} from "../../../../olt/scripts/src/engine/scheduler/dispatch/multi-domain-factor.ts";
import {
  evaluateMultiDomainBatch,
} from "../../../../olt/scripts/src/engine/scheduler/dispatch/multi-domain-batch.ts";
import {
  dispatchMultiDomainValidators,
  proposeMultiDomainWave,
} from "../../../../olt/scripts/src/engine/scheduler/dispatch/multi-domain-dispatch.ts";
import {
  ParallelWaveDispatchEnforcer,
} from "../../../../olt/scripts/src/engine/scheduler/dispatch/parallel-enforcer.ts";
import {
  evaluateHierarchicalDecision,
  HIERARCHICAL_TIERS,
} from "../../../../olt/scripts/src/engine/scheduler/conflict/decision-tree.ts";

describe("engine/scheduler/dispatch/multi-domain-types.ts", () => {
  it("evaluates eligibility and domain classification", () => {
    expect(isMultiDomainDispatchEligible(2.6)).toBe(true);
    expect(isMultiDomainDispatchEligible(2.0)).toBe(false);

    expect(classifyTaskDomain({ write_scope: ["src/components/button.tsx"] })).toBe("frontend-ui");
    expect(classifyTaskDomain({ write_scope: ["src/auth/jwt.ts"] })).toBe("security-auth");
    expect(classifyTaskDomain({ write_scope: ["src/engine/core.ts"] })).toBe("core-engine");
    expect(classifyTaskDomain({ write_scope: ["src/server/routes.ts"] })).toBe("backend-system");

    expect(derivePrimaryValidatorDomain({ write_scope: ["tests/ui.test.ts"] })).toBe("code-quality");
    expect(isDualValidationRequired({ write_scope: ["src/auth/jwt.ts", "src/ui/app.tsx"] })).toBe(true);
    expect(getRequiredValidatorDomains({ write_scope: ["src/auth/jwt.ts"] })).toBeDefined();

    const normalized = normalizeTask("task-1", {
      priority: 2,
      write_scope: ["src/file.ts"],
      status: "ready",
    });
    expect(normalized).toBeDefined();
    expect(normalized?.id).toBe("task-1");
    expect(normalized?.priority).toBe(2);
  });
});

describe("engine/scheduler/dispatch/parallel-enforcer.ts", () => {
  it("enforces parallel subagent invocation count", () => {
    expect(() =>
      ParallelWaveDispatchEnforcer.assertParallelDispatch(
        { waveIndex: 1, readyTaskIds: ["task-1", "task-2"] },
        1,
      ),
    ).toThrow(HarnessError);

    expect(() =>
      ParallelWaveDispatchEnforcer.assertParallelDispatch(
        { waveIndex: 1, readyTaskIds: ["task-1", "task-2"] },
        2,
      ),
    ).not.toThrow();
  });
});

describe("engine/scheduler/conflict/decision-tree.ts", () => {
  it("validates hierarchical tiers and evaluateHierarchicalDecision", () => {
    expect(HIERARCHICAL_TIERS.mind).toBe(0);
    expect(HIERARCHICAL_TIERS.coordinator).toBe(1);
    expect(HIERARCHICAL_TIERS.implementer).toBe(2);
    expect(HIERARCHICAL_TIERS.validator).toBe(3);

    const allowedDecision = evaluateHierarchicalDecision(
      { actor: "agent-1", role: "implementer" },
      "write_code",
    );
    expect(allowedDecision.allowed).toBe(true);

    const disallowedDecision = evaluateHierarchicalDecision(
      { actor: "agent-1", role: "coordinator" },
      "write_code",
    );
    expect(disallowedDecision.allowed).toBe(false);
  });
});

describe("engine/scheduler/dispatch/multi-domain-batch.ts & dispatch.ts", () => {
  it("evaluates multi-domain batches and proposes waves", () => {
    const mockState = {
      graph: {
        schema: "harness.graph",
        version: 1,
        revision: 1,
        nodes: [{ id: "task-1" }, { id: "task-2" }],
        edges: [],
        gates: [],
      },
      tasks: {
        "task-1": {
          id: "task-1",
          status: "ready",
          priority: 1,
          write_scope: ["src/frontend/app.tsx"],
          requirement_ids: [],
        },
        "task-2": {
          id: "task-2",
          status: "ready",
          priority: 2,
          write_scope: ["src/backend/api.ts"],
          requirement_ids: [],
        },
      },
    };

    const batch = evaluateMultiDomainBatch(mockState, { parallelismFactor: 3.0 });
    expect(batch.isMultiDomainActive).toBe(true);
    expect(batch.allDispatches.length).toBeGreaterThanOrEqual(1);

    const wave = proposeMultiDomainWave(mockState, { parallelismFactor: 3.0 });
    expect(wave).toBeDefined();

    const validatorDispatch = dispatchMultiDomainValidators(mockState, { parallelismFactor: 3.0 });
    expect(validatorDispatch).toBeDefined();
  });
});
