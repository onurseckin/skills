import { describe, expect, test } from "bun:test";
import { dependencyMap } from "../../../olt/scripts/src/graph/dependency-map.ts";
import {
  dispatchMultiDomainValidators,
  evaluateMultiDomainBatch,
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

describe("Multi-Domain Dispatch: Validator Concurrent Dispatch", () => {
  describe("Simultaneous Multi-Validator Dispatch Alongside Implementers (P >= 2.5 vs P < 2.5)", () => {
    test("When P >= 2.5, simultaneously dispatches validators on submitted tasks alongside implementers across disjoint domains", () => {
      const tasks = [
        createTask("impl-ui-1", "src/ui/Modal.tsx", { status: "ready", priority: 10 }),
        createTask("impl-backend-1", "src/api/PaymentApi.ts", { status: "ready", priority: 8 }),
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
        createTask("impl-ui", "src/ui/Header.tsx", { status: "ready", priority: 10 }),
        createTask("sub-ui-conflict", "src/ui/Header.tsx", { status: "submitted", priority: 9 }),
        createTask("sub-ui-clean", "src/ui/Footer.tsx", { status: "submitted", priority: 8 }),
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
});
