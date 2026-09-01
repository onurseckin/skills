import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  AUDIT_INVARIANT_IDS,
  auditPlan,
  isAuditInvariantId,
} from "../../../olt/scripts/src/graph/plan-audit.ts";
import { saveRepoPolicy, type RepoPolicy } from "../../../olt/scripts/src/policy/repo-policy.ts";
import {
  clearPlanAuditFs,
  generatePrompt,
  installPlanAuditFsSpies,
  sampleTasks,
  tempDir,
} from "./plan-audit-fixture.ts";

describe("plan-audit A8 invariant registry & systemic decomposition", () => {
  beforeEach(() => {
    installPlanAuditFsSpies();
  });

  afterEach(() => {
    clearPlanAuditFs();
  });

  it("includes A8 in AUDIT_INVARIANT_IDS", () => {
    expect(AUDIT_INVARIANT_IDS).toContain("A8-systemic-decomposition");
    expect(isAuditInvariantId("A8-systemic-decomposition")).toBe(true);
  });

  const repoRoot = "/virtual/repo/plan-audit-fixture";

  it("passes when prompt carries <= 10 non-blank lines with few tasks", () => {
    const result = auditPlan(repoRoot, sampleTasks(2), {}, generatePrompt(10));
    expect(
      result.findings.find((f) => f.invariant === "A8-systemic-decomposition"),
    ).toBeUndefined();
  });

  it("blocks when prompt carries > 10 non-blank lines and tasks count < 6 (default minimum)", () => {
    const result = auditPlan(repoRoot, sampleTasks(2), {}, generatePrompt(15));
    const a8 = result.findings.find((f) => f.invariant === "A8-systemic-decomposition");
    expect(a8).toBeDefined();
    expect(a8?.severity).toBe("blocking");
    expect(a8?.evidence_class).toBe("derived");
    expect(a8?.task_ids).toEqual(["task-1", "task-2"]);
    expect(a8?.message).toContain("complex prompt");
    expect(a8?.message).toContain("minimum required: 6");
  });

  it("passes when prompt carries > 10 non-blank lines and tasks count >= 6", () => {
    const runState = { brainstorming: [{ id: "1" }] };
    const result = auditPlan(repoRoot, sampleTasks(6), runState, generatePrompt(15));
    expect(
      result.findings.find((f) => f.invariant === "A8-systemic-decomposition"),
    ).toBeUndefined();
  });

  it("honors custom repo policy min_tasks_per_complex_prompt threshold", () => {
    const root = tempDir("plan-audit-a8-");
    const customPolicy: RepoPolicy = {
      schema_version: 1,
      ecosystem: "bun",
      test_runner: {
        default_command: "bun test",
        targeted_pattern: "bun test <path>",
        full_suite_command: "bun test",
      },
      planning: {
        mandatory_brainstorming_rounds: 3,
        socratic_expansion_depth: 8,
        enforce_edge_case_matrix: true,
        min_tasks_per_complex_prompt: 3,
        max_files_per_task: 2,
        reject_shallow_umbrella_compression: true,
      },
    };
    saveRepoPolicy(customPolicy, root);
    const runState = { brainstorming: [{ id: "1" }] };
    const result = auditPlan(root, sampleTasks(3), runState, generatePrompt(15));
    expect(
      result.findings.find((f) => f.invariant === "A8-systemic-decomposition"),
    ).toBeUndefined();
  });
});
