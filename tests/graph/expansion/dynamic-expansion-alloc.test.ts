import { describe, expect, test } from "bun:test";
import {
  createImplementerValidatorPair,
  detectTransitiveBypasses,
} from "../../../olt/scripts/src/graph/dynamic-expansion.ts";

describe("dynamic-expansion: createImplementerValidatorPair", () => {
  test("creates paired implementer, validator, artifact, edges, and gates", () => {
    const pair = createImplementerValidatorPair({
      taskId: "task-auth",
      label: "OAuth2 Provider Integration",
      writeScope: ["src/auth", "src/tokens.ts"],
      gate: "bun test tests/auth.test.ts",
      validatorGate: "bun test tests/auth-adversarial.test.ts",
      validatorScope: ["tests/probes/auth.ts"],
      priority: 80,
      effort: 5,
      requirementIds: ["req-auth"],
    });

    expect(pair.implementerTask.id).toBe("task-auth");
    expect(pair.implementerTask.role).toBe("implementer");
    expect(pair.implementerTask.paired_validator_id).toBe("val-auth");
    expect(pair.implementerTask.write_scope).toEqual(["src/auth", "src/tokens.ts"]);

    expect(pair.validatorTask.id).toBe("val-auth");
    expect(pair.validatorTask.role).toBe("validator");
    expect(pair.validatorTask.validates_task_id).toBe("task-auth");
    expect(pair.validatorTask.write_scope).toEqual(["tests/probes/auth.ts"]);

    expect(pair.artifactNode.id).toBe("artifact-auth");
    expect(pair.producesEdge).toEqual({
      source: "task-auth",
      target: "artifact-auth",
      type: "produces",
    });

    expect(pair.validationEdge.source).toBe("val-auth");
    expect(pair.validationEdge.target).toBe("task-auth");
    expect(pair.validationEdge.type).toBe("depends_on");

    expect(pair.gateNode.command).toEqual(["bun", "test", "tests/auth.test.ts"]);
    expect(pair.validatorGateNode?.command).toEqual([
      "bun",
      "test",
      "tests/auth-adversarial.test.ts",
    ]);
  });
});

describe("dynamic-expansion: detectTransitiveBypasses", () => {
  test("returns hasBypass=false for clean linear and diamond topologies", () => {
    const nodes = [
      { id: "task-1", type: "task" },
      { id: "task-2", type: "task" },
      { id: "task-3", type: "task" },
    ];
    const edges = [
      { source: "task-2", target: "task-1", type: "depends_on" },
      { source: "task-3", target: "task-2", type: "depends_on" },
    ];

    const result = detectTransitiveBypasses(nodes, edges);
    expect(result.hasBypass).toBe(false);
    expect(result.violations).toHaveLength(0);
  });

  test("flags transitive shortcut bypass and generates structured cognitive guidance", () => {
    const nodes = [
      { id: "task-1", type: "task" },
      { id: "val-1", type: "task", role: "validator" },
      { id: "task-2", type: "task" },
    ];
    const edges = [
      { source: "val-1", target: "task-1", type: "depends_on" },
      { source: "task-2", target: "val-1", type: "depends_on" },
      { source: "task-2", target: "task-1", type: "depends_on" },
    ];

    const result = detectTransitiveBypasses(nodes, edges);
    expect(result.hasBypass).toBe(true);
    expect(result.violations.length).toBeGreaterThanOrEqual(1);

    const violation = result.violations[0]!;
    expect(violation.code).toBe("TRANSITIVE_BYPASS_VIOLATION");
    expect(violation.edge).toEqual({ source: "task-2", target: "task-1" });
    expect(violation.bypassedPath).toEqual(["task-2", "val-1", "task-1"]);
    expect(violation.bypassedStage).toBe("val-1");
    expect(violation.guidance.summary).toContain("bypasses intermediate stage val-1");
    expect(violation.guidance.remediationAction).toContain("Remove direct bypass edge");
    expect(violation.guidance.suggestedRemediationEdges).toEqual([
      { source: "task-2", target: "val-1", type: "depends_on" },
    ]);
  });

  test("flags paired validator bypass when downstream consumer skips paired validator", () => {
    const nodes = [
      { id: "task-impl", type: "task", role: "implementer", paired_validator_id: "val-impl" },
      { id: "val-impl", type: "task", role: "validator", validates_task_id: "task-impl" },
      { id: "task-consumer", type: "task", role: "implementer" },
    ];
    const edges = [
      { source: "val-impl", target: "task-impl", type: "depends_on" },
      { source: "task-consumer", target: "task-impl", type: "depends_on" },
    ];

    const result = detectTransitiveBypasses(nodes, edges);
    expect(result.hasBypass).toBe(true);
    const validatorBypass = result.violations.find((v) => v.bypassedStage === "val-impl");
    expect(validatorBypass).toBeDefined();
    expect(validatorBypass?.guidance.summary).toContain("bypasses paired validator val-impl");
    expect(validatorBypass?.guidance.remediationAction).toContain(
      "make task-consumer depend on val-impl",
    );
  });
});
