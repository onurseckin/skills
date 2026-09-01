import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  AUDIT_INVARIANT_IDS,
  auditPlan,
  isAuditInvariantId,
} from "../../../olt/scripts/src/graph/plan-audit.ts";
import {
  clearPlanAuditFs,
  generatePrompt,
  installPlanAuditFsSpies,
  sampleTasks,
  tempDir,
  vfs,
} from "./plan-audit-fixture.ts";

describe("plan-audit A7 invariant registry & edge-case exhaustiveness", () => {
  beforeEach(() => {
    installPlanAuditFsSpies();
  });

  afterEach(() => {
    clearPlanAuditFs();
  });

  it("includes A7 in AUDIT_INVARIANT_IDS", () => {
    expect(AUDIT_INVARIANT_IDS).toContain("A7-edge-case-exhaustiveness");
    expect(isAuditInvariantId("A7-edge-case-exhaustiveness")).toBe(true);
  });

  const repoRoot = "/virtual/repo/plan-audit-fixture";

  it("passes when prompt carries <= 5 non-blank lines without mapped edge cases", () => {
    const result = auditPlan(repoRoot, sampleTasks(2), {}, generatePrompt(5));
    expect(
      result.findings.find((f) => f.invariant === "A7-edge-case-exhaustiveness"),
    ).toBeUndefined();
  });

  it("blocks when prompt carries > 5 non-blank lines and 0 edge cases are mapped", () => {
    const result = auditPlan(repoRoot, sampleTasks(2), {}, generatePrompt(6));
    const a7 = result.findings.find((f) => f.invariant === "A7-edge-case-exhaustiveness");
    expect(a7).toBeDefined();
    expect(a7?.severity).toBe("blocking");
    expect(a7?.evidence_class).toBe("derived");
    expect(a7?.task_ids).toEqual(["task-1", "task-2"]);
    expect(a7?.message).toContain("0 edge-case matrix vectors or brainstorming items");
  });

  it("passes when prompt carries > 5 non-blank lines and runState.brainstorming array is provided", () => {
    const runState = { brainstorming: [{ id: "item-1", vectorId: "EMPTY_PAYLOAD" }] };
    const result = auditPlan(repoRoot, sampleTasks(2), runState, generatePrompt(8));
    expect(
      result.findings.find((f) => f.invariant === "A7-edge-case-exhaustiveness"),
    ).toBeUndefined();
  });

  it("passes when runState.brainstorming is an object with totalExpandedItems", () => {
    const runState = { brainstorming: { totalExpandedItems: 8, roundsExecuted: 3 } };
    const result = auditPlan(repoRoot, sampleTasks(2), runState, generatePrompt(8));
    expect(
      result.findings.find((f) => f.invariant === "A7-edge-case-exhaustiveness"),
    ).toBeUndefined();
  });

  it("passes when runState.brainstorming has expandedItems array", () => {
    const runState = { brainstorming: { expandedItems: [{ id: "item-1" }, { id: "item-2" }] } };
    const result = auditPlan(repoRoot, sampleTasks(2), runState, generatePrompt(8));
    expect(
      result.findings.find((f) => f.invariant === "A7-edge-case-exhaustiveness"),
    ).toBeUndefined();
  });

  it("passes when runState.edge_cases is provided", () => {
    const runState = { edge_cases: ["ec-1", "ec-2"] };
    const result = auditPlan(repoRoot, sampleTasks(2), runState, generatePrompt(8));
    expect(
      result.findings.find((f) => f.invariant === "A7-edge-case-exhaustiveness"),
    ).toBeUndefined();
  });

  it("passes when runState.planning contains brainstorming", () => {
    const runState = { planning: { brainstorming: { totalExpandedItems: 16 } } };
    const result = auditPlan(repoRoot, sampleTasks(2), runState, generatePrompt(8));
    expect(
      result.findings.find((f) => f.invariant === "A7-edge-case-exhaustiveness"),
    ).toBeUndefined();
  });

  it("passes when brainstorming.json exists in repoRoot", () => {
    const root = tempDir("plan-audit-a7-");
    vfs.set(join(root, "brainstorming.json"), JSON.stringify({ totalExpandedItems: 8 }));
    const result = auditPlan(root, sampleTasks(2), {}, generatePrompt(8));
    expect(
      result.findings.find((f) => f.invariant === "A7-edge-case-exhaustiveness"),
    ).toBeUndefined();
  });
});
