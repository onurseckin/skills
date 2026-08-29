import { describe, expect, test } from "bun:test";
import { dependencyMap } from "../../../olt/scripts/src/graph/dependency-map.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  classifyTaskDomain,
  derivePrimaryValidatorDomain,
  dispatchMultiDomainValidators,
  evaluateMultiDomainBatch,
  isMultiDomainDispatchEligible,
  MULTI_DOMAIN_PARALLELISM_THRESHOLD,
  proposeMultiDomainWave,
  resolveParallelismFactor,
  SchedulerEngine,
  type MultiDomainBatchOptions,
} from "../../../olt/scripts/src/engine/scheduler/index.ts";

interface TestTaskOptions {
  readonly priority?: number;
  readonly created?: number;
  readonly effort?: number;
  readonly status?: string;
  readonly domain?: string;
  readonly primary_domain?: string;
  readonly validator_domain?: string;
  readonly resource_scope?: string[];
  readonly requirement_ids?: string[];
}

function createTask(
  id: string,
  writeScope: string | string[],
  options: TestTaskOptions = {},
): Record<string, unknown> {
  const scopes = Array.isArray(writeScope) ? writeScope : [writeScope];
  return {
    id,
    type: "task",
    label: id,
    requirement_ids: options.requirement_ids ?? ["R-001"],
    write_scope: scopes,
    resource_scope: options.resource_scope ?? [],
    artifact_ids: ["artifact-all"],
    status: options.status ?? "ready",
    priority: options.priority ?? 1,
    created_order: options.created ?? 10,
    effort: options.effort ?? 1,
    domain: options.domain,
    primary_domain: options.primary_domain,
    validator_domain: options.validator_domain,
  };
}

function createMultiDomainState(
  tasks: Array<Record<string, unknown>>,
  dependencies: Array<[string, string]> = [],
): Record<string, unknown> {
  const graph = {
    schema: "harness.graph",
    version: 1,
    revision: 1,
    nodes: [
      { id: "requirement-1", type: "requirement", label: "R-001", requirement_id: "R-001" },
      { id: "artifact-all", type: "artifact", label: "All output" },
      ...tasks,
    ],
    edges: dependencies.map(([source, target]) => ({ source, target, type: "depends_on" })),
    gates: [
      {
        id: "gate-one",
        command: ["bun", "test"],
        cwd: ".",
        scope: "task",
        requirement_ids: ["R-001"],
        mandatory: true,
      },
    ],
  };

  const dependencySets = dependencyMap(graph);
  return {
    graph,
    requirements: {
      schema: "harness.requirements",
      version: 1,
      prompt_sha256: "0".repeat(64),
      requirements: [{ id: "R-001", disposition: "actionable", dependencies: [] }],
      dispositions: [],
    },
    tasks: Object.fromEntries(
      tasks.map((item) => {
        const id = String(item.id);
        return [id, { ...item, dependencies: [...(dependencySets.get(id) ?? [])] }];
      }),
    ),
  };
}

describe("REMED-006: Simultaneous Multi-Domain Dispatch", () => {
  describe("1. Threshold & Eligibility Rules", () => {
    test("MULTI_DOMAIN_PARALLELISM_THRESHOLD is exactly 2.5", () => {
      expect(MULTI_DOMAIN_PARALLELISM_THRESHOLD).toBe(2.5);
    });

    test("isMultiDomainDispatchEligible triggers at P >= 2.5 and not below", () => {
      expect(isMultiDomainDispatchEligible(2.5)).toBeTrue();
      expect(isMultiDomainDispatchEligible(2.51)).toBeTrue();
      expect(isMultiDomainDispatchEligible(3.0)).toBeTrue();
      expect(isMultiDomainDispatchEligible(10.0)).toBeTrue();

      expect(isMultiDomainDispatchEligible(2.49)).toBeFalse();
      expect(isMultiDomainDispatchEligible(2.0)).toBeFalse();
      expect(isMultiDomainDispatchEligible(1.0)).toBeFalse();
      expect(isMultiDomainDispatchEligible(0)).toBeFalse();
    });

    test("resolveParallelismFactor extracts factor from explicit options, state, or graph", () => {
      expect(resolveParallelismFactor({}, 3.14)).toBe(3.14);

      expect(resolveParallelismFactor({ workParallelismRatio: 2.8 })).toBe(2.8);
      expect(resolveParallelismFactor({ parallelismFactor: 3.5 })).toBe(3.5);

      const tasks = [
        createTask("t1", "src/ui/1.tsx"),
        createTask("t2", "src/api/2.ts"),
        createTask("t3", "src/auth/3.ts"),
        createTask("t4", "src/core/4.ts"),
      ];
      const state = createMultiDomainState(tasks);
      const computed = resolveParallelismFactor(state);
      expect(computed).toBe(4.0);

      expect(resolveParallelismFactor({})).toBe(1.0);
    });

    test("resolveParallelismFactor throws HarnessError on invalid explicit factor", () => {
      expect(() => resolveParallelismFactor({}, -1)).toThrow(HarnessError);
      expect(() => resolveParallelismFactor({}, Number.NaN)).toThrow(HarnessError);
    });
  });

  describe("2. Task Domain Classification & Validator Domain Derivation", () => {
    test("classifies tasks by explicit domain and primary_domain", () => {
      expect(classifyTaskDomain({ domain: "custom-pipeline" })).toBe("custom-pipeline");
      expect(classifyTaskDomain({ primary_domain: "custom-storage" })).toBe("custom-storage");
    });

    test("classifies tasks by explicit validator_domain mappings", () => {
      expect(classifyTaskDomain({ validator_domain: "ui-design" })).toBe("frontend-ui");
      expect(classifyTaskDomain({ validator_domain: "system-design" })).toBe("backend-system");
      expect(classifyTaskDomain({ validator_domain: "security" })).toBe("security-auth");
      expect(classifyTaskDomain({ validator_domain: "product" })).toBe("product-experience");
      expect(classifyTaskDomain({ validator_domain: "code-quality" })).toBe("core-engine");
      expect(classifyTaskDomain({ validator_domain: "specialized-domain" })).toBe(
        "specialized-domain",
      );
    });

    test("classifies tasks by file extension and path markers in write_scope", () => {
      expect(classifyTaskDomain({ write_scope: ["src/components/Header.tsx"] })).toBe(
        "frontend-ui",
      );
      expect(classifyTaskDomain({ write_scope: ["src/styles/theme.css"] })).toBe("frontend-ui");
      expect(classifyTaskDomain({ write_scope: ["src/views/Dashboard.vue"] })).toBe("frontend-ui");
      expect(classifyTaskDomain({ write_scope: ["src/schema/schema.graphql"] })).toBe(
        "backend-system",
      );
      expect(classifyTaskDomain({ write_scope: ["src/proto/service.proto"] })).toBe(
        "backend-system",
      );
      expect(classifyTaskDomain({ write_scope: ["src/api/routes.ts"] })).toBe("backend-system");
      expect(classifyTaskDomain({ write_scope: ["src/server/handler.ts"] })).toBe("backend-system");
      expect(classifyTaskDomain({ write_scope: ["src/auth/jwt-signer.ts"] })).toBe("security-auth");
      expect(classifyTaskDomain({ write_scope: ["src/security/encryption.ts"] })).toBe(
        "security-auth",
      );
      expect(classifyTaskDomain({ write_scope: ["src/core/math.ts"] })).toBe("core-engine");
      expect(classifyTaskDomain(null)).toBe("core-engine");
    });

    test("derivePrimaryValidatorDomain extracts appropriate validator domain", () => {
      expect(derivePrimaryValidatorDomain({ validator_domain: "security" })).toBe("security");
      expect(derivePrimaryValidatorDomain({ write_scope: ["src/ui/App.tsx"] })).toBe("ui-design");
      expect(derivePrimaryValidatorDomain({ write_scope: ["src/schema/db.graphql"] })).toBe(
        "system-design",
      );
      expect(derivePrimaryValidatorDomain({ write_scope: ["src/core/calc.ts"] })).toBe(
        "code-quality",
      );
      expect(derivePrimaryValidatorDomain(null)).toBe("code-quality");
    });
  });

  describe("3. Multi-Domain Implementer Concurrent Dispatch (P >= 2.5 vs P < 2.5)", () => {
    test("When P >= 2.5, mandates simultaneous multi-domain round-robin dispatch across distinct domains", () => {
      const tasks = [
        createTask("ui-1", "src/ui/CompA.tsx", { priority: 10 }),
        createTask("ui-2", "src/ui/CompB.tsx", { priority: 9 }),
        createTask("backend-1", "src/api/UserApi.ts", { priority: 8 }),
        createTask("backend-2", "src/api/OrderApi.ts", { priority: 7 }),
        createTask("sec-1", "src/auth/AuthService.ts", { priority: 6 }),
      ];

      const state = createMultiDomainState(tasks);

      // Evaluate under P >= 2.5 (e.g. 3.0) with maxParallel: 3
      const result = evaluateMultiDomainBatch(state, {
        parallelismFactor: 3.0,
        maxParallel: 3,
      });

      expect(result.isMultiDomainActive).toBeTrue();
      expect(result.mandatedConcurrentDomains).toBeTrue();
      expect(result.parallelismFactor).toBe(3.0);
      expect(result.implementerDispatches).toHaveLength(3);

      // Round-robin selection across distinct domains must pick 1 from UI, 1 from Backend, 1 from Security
      const dispatchedTaskIds = result.implementerDispatches.map((d) => d.taskId);
      expect(dispatchedTaskIds).toEqual(["ui-1", "backend-1", "sec-1"]);

      expect(result.distinctDomainCount).toBe(3);
      expect(result.activeDomains).toEqual(["backend-system", "frontend-ui", "security-auth"]);
      expect(result.scopeIsolated).toBeTrue();
    });

    test("When P < 2.5, executes normal sequential / single-domain priority dispatch", () => {
      const tasks = [
        createTask("ui-1", "src/ui/CompA.tsx", { priority: 10 }),
        createTask("ui-2", "src/ui/CompB.tsx", { priority: 9 }),
        createTask("backend-1", "src/api/UserApi.ts", { priority: 8 }),
        createTask("backend-2", "src/api/OrderApi.ts", { priority: 7 }),
        createTask("sec-1", "src/auth/AuthService.ts", { priority: 6 }),
      ];

      const state = createMultiDomainState(tasks);

      // Evaluate under P < 2.5 (e.g. 1.8) with maxParallel: 3
      const result = evaluateMultiDomainBatch(state, {
        parallelismFactor: 1.8,
        maxParallel: 3,
      });

      expect(result.isMultiDomainActive).toBeFalse();
      expect(result.mandatedConcurrentDomains).toBeFalse();
      expect(result.parallelismFactor).toBe(1.8);
      expect(result.implementerDispatches).toHaveLength(3);

      // Strict priority picks top 3 tasks by priority: ui-1 (10), ui-2 (9), backend-1 (8)
      const dispatchedTaskIds = result.implementerDispatches.map((d) => d.taskId);
      expect(dispatchedTaskIds).toEqual(["ui-1", "ui-2", "backend-1"]);

      expect(result.distinctDomainCount).toBe(2);
      expect(result.activeDomains).toEqual(["backend-system", "frontend-ui"]);
      expect(result.scopeIsolated).toBeTrue();
    });

    test("Multi-domain round-robin distributes fairly across multiple passes when maxParallel > domain count", () => {
      const tasks = [
        createTask("ui-1", "src/ui/CompA.tsx", { priority: 10 }),
        createTask("ui-2", "src/ui/CompB.tsx", { priority: 9 }),
        createTask("backend-1", "src/api/UserApi.ts", { priority: 8 }),
        createTask("sec-1", "src/auth/AuthService.ts", { priority: 6 }),
      ];

      const state = createMultiDomainState(tasks);

      const result = evaluateMultiDomainBatch(state, {
        parallelismFactor: 3.0,
        maxParallel: 4,
      });

      expect(result.implementerDispatches).toHaveLength(4);
      // Round 1: ui-1, backend-1, sec-1; Round 2: ui-2
      const dispatchedTaskIds = result.implementerDispatches.map((d) => d.taskId);
      expect(dispatchedTaskIds).toEqual(["ui-1", "backend-1", "sec-1", "ui-2"]);
    });
  });

  describe("4. Simultaneous Multi-Validator Dispatch Alongside Implementers (P >= 2.5 vs P < 2.5)", () => {
    test("When P >= 2.5, simultaneously dispatches validators on submitted tasks alongside implementers across disjoint domains", () => {
      const tasks = [
        // Ready implementer in frontend-ui
        createTask("impl-ui-1", "src/ui/Modal.tsx", { status: "ready", priority: 10 }),
        // Ready implementer in backend-system
        createTask("impl-backend-1", "src/api/PaymentApi.ts", { status: "ready", priority: 8 }),
        // Submitted task awaiting validation in security-auth
        createTask("sub-sec-1", "src/auth/TokenVerifier.ts", {
          status: "submitted",
          priority: 9,
          validator_domain: "security",
        }),
      ];

      const state = createMultiDomainState(tasks);

      const result = evaluateMultiDomainBatch(state, {
        parallelismFactor: 3.0,
        maxParallel: 4,
      });

      expect(result.isMultiDomainActive).toBeTrue();
      expect(result.implementerDispatches).toHaveLength(2);
      expect(result.validatorDispatches).toHaveLength(1);
      expect(result.allDispatches).toHaveLength(3);

      const validatorDispatch = result.validatorDispatches[0]!;
      expect(validatorDispatch.taskId).toBe("sub-sec-1");
      expect(validatorDispatch.role).toBe("validator");
      expect(validatorDispatch.validatorDomain).toBe("security");
      expect(validatorDispatch.domain).toBe("security-auth");

      expect(result.distinctDomainCount).toBe(3);
      expect(result.activeDomains).toEqual(["backend-system", "frontend-ui", "security-auth"]);
      expect(result.scopeIsolated).toBeTrue();
    });

    test("When P < 2.5, validator simultaneous dispatch alongside implementers is NOT active by default", () => {
      const tasks = [
        createTask("impl-ui-1", "src/ui/Modal.tsx", { status: "ready", priority: 10 }),
        createTask("sub-sec-1", "src/auth/TokenVerifier.ts", {
          status: "submitted",
          priority: 9,
          validator_domain: "security",
        }),
      ];

      const state = createMultiDomainState(tasks);

      const result = evaluateMultiDomainBatch(state, {
        parallelismFactor: 1.5,
        maxParallel: 3,
      });

      expect(result.isMultiDomainActive).toBeFalse();
      expect(result.implementerDispatches).toHaveLength(1);
      expect(result.validatorDispatches).toHaveLength(0);
      expect(result.allDispatches).toHaveLength(1);
    });

    test("dispatchMultiDomainValidators selects submitted tasks across distinct domains when P >= 2.5", () => {
      const tasks = [
        createTask("val-ui", "src/ui/Card.tsx", { status: "submitted", priority: 10 }),
        createTask("val-back", "src/api/Data.ts", { status: "submitted", priority: 8 }),
        createTask("val-sec", "src/auth/Cert.ts", { status: "submitted", priority: 9 }),
      ];

      const state = createMultiDomainState(tasks);

      const result = dispatchMultiDomainValidators(state, {
        parallelismFactor: 3.0,
        maxParallel: 3,
      });

      expect(result.isMultiDomainActive).toBeTrue();
      expect(result.validatorDispatches).toHaveLength(3);
      expect(result.dispatchedDomains).toEqual(["backend-system", "frontend-ui", "security-auth"]);
      expect(result.eligibleSubmittedTasks).toBe(3);
      expect(result.scopeIsolated).toBeTrue();
    });

    test("dispatchMultiDomainValidators avoids active implementer scopes", () => {
      const tasks = [
        createTask("val-1", "src/ui/Card.tsx", { status: "submitted", priority: 10 }),
        createTask("val-2", "src/api/Data.ts", { status: "submitted", priority: 8 }),
      ];

      const state = createMultiDomainState(tasks);

      // Active implementer touches src/ui/Card.tsx
      const result = dispatchMultiDomainValidators(state, {
        parallelismFactor: 3.0,
        maxParallel: 3,
        activeImplementerScopes: [["src/ui/Card.tsx"]],
      });

      expect(result.validatorDispatches).toHaveLength(1);
      expect(result.validatorDispatches[0]!.taskId).toBe("val-2");
    });

    test("skips conflicting submitted candidate and selects non-conflicting one in same domain during multi-domain batch", () => {
      const tasks = [
        // Implementer in UI touching src/ui/Header.tsx
        createTask("impl-ui", "src/ui/Header.tsx", { status: "ready", priority: 10 }),
        // First submitted in UI also touching src/ui/Header.tsx (conflicts with impl-ui)
        createTask("sub-ui-conflict", "src/ui/Header.tsx", { status: "submitted", priority: 9 }),
        // Second submitted in UI touching src/ui/Footer.tsx (non-conflicting)
        createTask("sub-ui-clean", "src/ui/Footer.tsx", { status: "submitted", priority: 8 }),
        // Submitted in backend
        createTask("sub-backend", "src/api/Data.ts", { status: "submitted", priority: 7 }),
      ];

      const state = createMultiDomainState(tasks);

      const result = evaluateMultiDomainBatch(state, {
        parallelismFactor: 3.0,
        maxParallel: 3,
      });

      expect(result.implementerDispatches).toHaveLength(1);
      expect(result.implementerDispatches[0]!.taskId).toBe("impl-ui");

      const valIds = result.validatorDispatches.map((d) => d.taskId);
      expect(valIds).toContain("sub-backend");
      expect(valIds).toContain("sub-ui-clean");
      expect(valIds).not.toContain("sub-ui-conflict");
    });
  });

  describe("5. Strict Scope Isolation Across Disjoint Domains", () => {
    test("Prevents simultaneous dispatch of cross-domain tasks with overlapping write scopes", () => {
      const tasks = [
        // Task A in UI domain touching shared types
        createTask("task-ui", "src/shared/types.ts", {
          priority: 10,
          domain: "frontend-ui",
        }),
        // Task B in Backend domain also touching shared types
        createTask("task-backend-conflicting", "src/shared/types.ts", {
          priority: 9,
          domain: "backend-system",
        }),
        // Task C in Backend domain with disjoint scope
        createTask("task-backend-clean", "src/api/clean.ts", {
          priority: 8,
          domain: "backend-system",
        }),
      ];

      const state = createMultiDomainState(tasks);

      const result = evaluateMultiDomainBatch(state, {
        parallelismFactor: 3.0,
        maxParallel: 3,
      });

      const dispatchedIds = result.implementerDispatches.map((d) => d.taskId);
      expect(dispatchedIds).toContain("task-ui");
      expect(dispatchedIds).toContain("task-backend-clean");
      expect(dispatchedIds).not.toContain("task-backend-conflicting");
      expect(result.scopeIsolated).toBeTrue();
    });

    test("Prevents concurrent validator dispatch when submitted task conflicts with dispatched implementer scope", () => {
      const tasks = [
        // Implementer touching src/shared/kernel.ts
        createTask("task-impl", "src/shared/kernel.ts", {
          status: "ready",
          priority: 10,
          domain: "frontend-ui",
        }),
        // Submitted task touching the same src/shared/kernel.ts
        createTask("task-sub-conflict", "src/shared/kernel.ts", {
          status: "submitted",
          priority: 9,
          domain: "backend-system",
        }),
        // Submitted task with clean disjoint scope
        createTask("task-sub-clean", "src/auth/safe.ts", {
          status: "submitted",
          priority: 8,
          domain: "security-auth",
        }),
      ];

      const state = createMultiDomainState(tasks);

      const result = evaluateMultiDomainBatch(state, {
        parallelismFactor: 3.0,
        maxParallel: 3,
      });

      const dispatchedIds = result.allDispatches.map((d) => d.taskId);
      expect(dispatchedIds).toContain("task-impl");
      expect(dispatchedIds).toContain("task-sub-clean");
      expect(dispatchedIds).not.toContain("task-sub-conflict");
      expect(result.scopeIsolated).toBeTrue();
    });

    test("Prevents dispatch of tasks that conflict with occupied/running tasks in state", () => {
      const tasks = [
        // Running task in state holding lease on src/api/active.ts
        createTask("task-running", "src/api/active.ts", {
          status: "running",
          priority: 10,
          domain: "backend-system",
        }),
        // Ready candidate trying to write to src/api/active.ts
        createTask("task-candidate-conflict", "src/api/active.ts", {
          status: "ready",
          priority: 9,
          domain: "backend-system",
        }),
        // Ready candidate with disjoint write scope
        createTask("task-candidate-clean", "src/ui/clean.tsx", {
          status: "ready",
          priority: 8,
          domain: "frontend-ui",
        }),
      ];

      const state = createMultiDomainState(tasks);

      const result = evaluateMultiDomainBatch(state, {
        parallelismFactor: 3.0,
        maxParallel: 3,
      });

      const dispatchedIds = result.implementerDispatches.map((d) => d.taskId);
      expect(dispatchedIds).toContain("task-candidate-clean");
      expect(dispatchedIds).not.toContain("task-candidate-conflict");
      expect(result.scopeIsolated).toBeTrue();
    });

    test("Prevents simultaneous dispatch on resource scope collision", () => {
      const tasks = [
        createTask("task-res-1", "src/ui/1.tsx", {
          priority: 10,
          resource_scope: ["db:postgres_main"],
          domain: "frontend-ui",
        }),
        createTask("task-res-2", "src/api/2.ts", {
          priority: 9,
          resource_scope: ["db:postgres_main"],
          domain: "backend-system",
        }),
      ];

      const state = createMultiDomainState(tasks);

      const result = evaluateMultiDomainBatch(state, {
        parallelismFactor: 3.0,
        maxParallel: 3,
      });

      expect(result.implementerDispatches).toHaveLength(1);
      expect(result.implementerDispatches[0]!.taskId).toBe("task-res-1");
      expect(result.scopeIsolated).toBeTrue();
    });
  });

  describe("6. Multi-Domain Wave Evaluation & Blocked Tasks Diagnostics", () => {
    test("proposeMultiDomainWave produces structured wave with blocked and occupied tasks", () => {
      const tasks = [
        createTask("task-ready", "src/ui/App.tsx", { status: "ready", priority: 10 }),
        createTask("task-running", "src/api/Run.ts", { status: "running", priority: 9 }),
        createTask("task-blocked", "src/auth/Block.ts", { status: "blocked", priority: 8 }),
      ];

      const state = createMultiDomainState(tasks);

      const wave = proposeMultiDomainWave(state, {
        parallelismFactor: 3.0,
        maxParallel: 2,
      });

      expect(wave.wave).toBe(1);
      expect(typeof wave.evaluatedAt).toBe("string");
      expect(wave.implementerDispatches).toHaveLength(1);
      expect(wave.implementerDispatches[0]!.taskId).toBe("task-ready");
      expect(wave.activeOccupiedTasks).toContain("task-running");
      expect(wave.blockedTasks).toHaveLength(1);
      expect(wave.blockedTasks[0]!.taskId).toBe("task-blocked");
    });
  });

  describe("7. SchedulerEngine Class Multi-Domain Methods", () => {
    test("SchedulerEngine executes evaluateMultiDomainBatch, dispatchMultiDomainValidators, and proposeMultiDomainWave", () => {
      const engine = new SchedulerEngine({ maxParallel: 4 });

      const tasks = [
        createTask("ui-task", "src/ui/Panel.tsx", { status: "ready", priority: 10 }),
        createTask("backend-task", "src/api/Data.ts", { status: "ready", priority: 9 }),
        createTask("sub-task", "src/auth/Jwt.ts", { status: "submitted", priority: 8 }),
      ];

      const state = createMultiDomainState(tasks);

      const batch = engine.evaluateMultiDomainBatch(state, { parallelismFactor: 3.0 });
      expect(batch.isMultiDomainActive).toBeTrue();
      expect(batch.distinctDomainCount).toBe(3);
      expect(batch.maxParallel).toBe(4);

      const valDispatch = engine.dispatchMultiDomainValidators(state, { parallelismFactor: 3.0 });
      expect(valDispatch.validatorDispatches).toHaveLength(1);
      expect(valDispatch.validatorDispatches[0]!.taskId).toBe("sub-task");

      const wave = engine.proposeMultiDomainWave(state, { parallelismFactor: 3.0 });
      expect(wave.wave).toBe(1);
      expect(wave.allDispatches).toHaveLength(3);
    });
  });

  describe("8. Edge Cases and Error Handling", () => {
    test("throws HarnessError on invalid state or missing plan", () => {
      expect(() => evaluateMultiDomainBatch(null)).toThrow(HarnessError);
      expect(() => evaluateMultiDomainBatch({ graph: {} })).toThrow(HarnessError);
      expect(() => dispatchMultiDomainValidators(null)).toThrow(HarnessError);
    });

    test("throws HarnessError on invalid maxParallel", () => {
      const state = createMultiDomainState([createTask("t1", "src/t1")]);
      expect(() => evaluateMultiDomainBatch(state, { maxParallel: 0 })).toThrow(HarnessError);
      expect(() => evaluateMultiDomainBatch(state, { maxParallel: -5 })).toThrow(HarnessError);
      expect(() => dispatchMultiDomainValidators(state, { maxParallel: 0 })).toThrow(HarnessError);
    });

    test("handles empty tasks gracefully", () => {
      const state = createMultiDomainState([]);
      const result = evaluateMultiDomainBatch(state, { parallelismFactor: 3.0 });
      expect(result.allDispatches).toHaveLength(0);
      expect(result.distinctDomainCount).toBe(0);
      expect(result.scopeIsolated).toBeTrue();
    });

    test("handles all tasks in a single domain when P >= 2.5 without error", () => {
      const tasks = [
        createTask("ui-1", "src/ui/1.tsx", { priority: 10 }),
        createTask("ui-2", "src/ui/2.tsx", { priority: 9 }),
      ];

      const state = createMultiDomainState(tasks);

      const result = evaluateMultiDomainBatch(state, {
        parallelismFactor: 3.0,
        maxParallel: 2,
      });

      expect(result.isMultiDomainActive).toBeTrue();
      expect(result.implementerDispatches).toHaveLength(2);
      expect(result.distinctDomainCount).toBe(1);
      expect(result.activeDomains).toEqual(["frontend-ui"]);
    });

    test("filters out tasks with unsatisfied prerequisites", () => {
      const tasks = [
        createTask("parent-task", "src/parent.ts", { status: "ready", priority: 10 }),
        createTask("child-task", "src/child.ts", { status: "ready", priority: 9 }),
      ];

      const state = createMultiDomainState(tasks, [["child-task", "parent-task"]]);

      const result = evaluateMultiDomainBatch(state, {
        parallelismFactor: 3.0,
        maxParallel: 2,
      });

      expect(result.implementerDispatches).toHaveLength(1);
      expect(result.implementerDispatches[0]!.taskId).toBe("parent-task");
    });

    test("dispatches sequential validators when forced with allowSimultaneousValidators: true and P < 2.5", () => {
      const tasks = [
        createTask("impl-1", "src/ui/1.tsx", { status: "ready", priority: 10 }),
        createTask("sub-1", "src/api/1.ts", { status: "submitted", priority: 8 }),
        createTask("sub-2", "src/api/2.ts", { status: "submitted", priority: 7 }),
      ];

      const state = createMultiDomainState(tasks);

      const result = evaluateMultiDomainBatch(state, {
        parallelismFactor: 1.5,
        maxParallel: 3,
        allowSimultaneousValidators: true,
      });

      expect(result.isMultiDomainActive).toBeFalse();
      expect(result.implementerDispatches).toHaveLength(1);
      expect(result.validatorDispatches).toHaveLength(2);
      expect(result.allDispatches).toHaveLength(3);
    });

    test("dispatchMultiDomainValidators dispatches sequentially when P < 2.5", () => {
      const tasks = [
        createTask("sub-1", "src/api/1.ts", { status: "submitted", priority: 10 }),
        createTask("sub-2", "src/api/2.ts", { status: "submitted", priority: 8 }),
      ];

      const state = createMultiDomainState(tasks);

      const result = dispatchMultiDomainValidators(state, {
        parallelismFactor: 1.5,
        maxParallel: 2,
      });

      expect(result.isMultiDomainActive).toBeFalse();
      expect(result.validatorDispatches).toHaveLength(2);
      expect(result.dispatchedDomains).toEqual(["backend-system"]);
    });

    test("handles validator intra-domain conflicts during round-robin selection", () => {
      const tasks = [
        // Two submitted tasks in same domain with conflicting scopes
        createTask("sub-ui-1", "src/ui/Button.tsx", { status: "submitted", priority: 10 }),
        createTask("sub-ui-2", "src/ui/Button.tsx", { status: "submitted", priority: 9 }),
        createTask("sub-sec-1", "src/auth/token.ts", { status: "submitted", priority: 8 }),
      ];

      const state = createMultiDomainState(tasks);

      const result = dispatchMultiDomainValidators(state, {
        parallelismFactor: 3.0,
        maxParallel: 3,
      });

      expect(result.validatorDispatches).toHaveLength(2);
      const dispatchedIds = result.validatorDispatches.map((d) => d.taskId);
      expect(dispatchedIds).toContain("sub-ui-1");
      expect(dispatchedIds).toContain("sub-sec-1");
      expect(dispatchedIds).not.toContain("sub-ui-2");
    });

    test("falls back gracefully when graph has dependency cycle during parallelism factor resolution", () => {
      const state = {
        graph: {
          nodes: [{ id: "t1" }, { id: "t2" }],
          edges: [
            { source: "t1", target: "t2", type: "depends_on" },
            { source: "t2", target: "t1", type: "depends_on" },
          ],
        },
        tasks: {
          t1: createTask("t1", "src/t1.ts"),
          t2: createTask("t2", "src/t2.ts"),
        },
        workParallelismRatio: 2.75,
      };

      const factor = resolveParallelismFactor(state);
      expect(factor).toBe(2.75);
    });

    test("sorts domain groups alphabetically on equal priority during multi-domain dispatch", () => {
      const tasks = [
        createTask("task-b", "src/api/b.ts", { priority: 5 }), // backend-system
        createTask("task-f", "src/ui/f.tsx", { priority: 5 }), // frontend-ui
      ];

      const state = createMultiDomainState(tasks);

      const result = evaluateMultiDomainBatch(state, {
        parallelismFactor: 3.0,
        maxParallel: 2,
      });

      expect(result.implementerDispatches).toHaveLength(2);
      expect(result.implementerDispatches[0]!.taskId).toBe("task-b");
      expect(result.implementerDispatches[1]!.taskId).toBe("task-f");
    });

    test("proposeMultiDomainWave supports custom clock", () => {
      const tasks = [createTask("t1", "src/ui/1.tsx")];
      const state = createMultiDomainState(tasks);
      const customDate = new Date("2026-08-22T12:00:00.000Z");

      const wave = proposeMultiDomainWave(state, {
        clock: { now: () => customDate },
      });

      expect(wave.evaluatedAt).toBe("2026-08-22T12:00:00.000Z");
    });

    test("filters submitted tasks that conflict with occupied running tasks in evaluateMultiDomainBatch", () => {
      const tasks = [
        createTask("t-running", "src/auth/token.ts", { status: "running", priority: 10 }),
        createTask("t-submitted", "src/auth/token.ts", { status: "submitted", priority: 9 }),
        createTask("t-ready", "src/ui/1.tsx", { status: "ready", priority: 8 }),
      ];

      const state = createMultiDomainState(tasks);

      const result = evaluateMultiDomainBatch(state, {
        parallelismFactor: 3.0,
        maxParallel: 3,
      });

      expect(result.validatorDispatches).toHaveLength(0);
      expect(result.implementerDispatches).toHaveLength(1);
      expect(result.implementerDispatches[0]!.taskId).toBe("t-ready");
    });

    test("dispatchMultiDomainValidators filters out tasks that conflict with occupied tasks", () => {
      const tasks = [
        createTask("t-running", "src/auth/token.ts", { status: "running", priority: 10 }),
        createTask("t-sub-conflict", "src/auth/token.ts", { status: "submitted", priority: 9 }),
        createTask("t-sub-clean", "src/ui/1.tsx", { status: "submitted", priority: 8 }),
      ];

      const state = createMultiDomainState(tasks);

      const result = dispatchMultiDomainValidators(state, {
        parallelismFactor: 3.0,
        maxParallel: 2,
      });

      expect(result.validatorDispatches).toHaveLength(1);
      expect(result.validatorDispatches[0]!.taskId).toBe("t-sub-clean");
    });

    test("handles validator resource conflicts in multi-domain batch and validator dispatch", () => {
      const tasks = [
        createTask("impl-1", "src/ui/1.tsx", { status: "ready", priority: 10 }),
        createTask("sub-res-1", "src/api/1.ts", {
          status: "submitted",
          priority: 9,
          resource_scope: ["res:db"],
        }),
        createTask("sub-res-2", "src/api/2.ts", {
          status: "submitted",
          priority: 8,
          resource_scope: ["res:db"],
        }),
      ];

      const state = createMultiDomainState(tasks);

      const batchResult = evaluateMultiDomainBatch(state, {
        parallelismFactor: 3.0,
        maxParallel: 3,
      });
      expect(batchResult.validatorDispatches).toHaveLength(1);
      expect(batchResult.validatorDispatches[0]!.taskId).toBe("sub-res-1");

      const valResult = dispatchMultiDomainValidators(state, {
        parallelismFactor: 3.0,
        maxParallel: 3,
        activeResourceScopes: [["res:db"]],
      });
      expect(valResult.validatorDispatches).toHaveLength(0);
    });
  });
});
