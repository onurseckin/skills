import { describe, expect, test } from "bun:test";
import { dependencyMap } from "../../../olt/scripts/src/graph/dependency-map.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  classifyTaskDomain,
  derivePrimaryValidatorDomain,
  isMultiDomainDispatchEligible,
  MULTI_DOMAIN_PARALLELISM_THRESHOLD,
  resolveParallelismFactor,
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

describe("Multi-Domain Dispatch: Thresholds, Eligibility & Classification", () => {
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
});
