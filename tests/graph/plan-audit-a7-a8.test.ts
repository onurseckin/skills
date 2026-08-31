import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AUDIT_INVARIANT_IDS,
  auditPlan,
  isAuditInvariantId,
} from "../../olt/scripts/src/graph/plan-audit.ts";
import { saveRepoPolicy, type RepoPolicy } from "../../olt/scripts/src/policy/repo-policy.ts";

function generatePrompt(lineCount: number): string {
  return Array.from(
    { length: lineCount },
    (_, i) => `Requirement ${i + 1}: Detailed actionable obligation`,
  ).join("\n");
}

function sampleTasks(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    taskId: `task-${i + 1}`,
    writeScope: [`src/module-${i + 1}.ts`],
    deps: [] as string[],
    gate: `bun test tests/unit/module-${i + 1}.test.ts`,
  }));
}

describe("plan-audit A7 and A8 invariant registry", () => {
  it("includes A7 and A8 in AUDIT_INVARIANT_IDS", () => {
    expect(AUDIT_INVARIANT_IDS).toContain("A7-edge-case-exhaustiveness");
    expect(AUDIT_INVARIANT_IDS).toContain("A8-systemic-decomposition");
    expect(isAuditInvariantId("A7-edge-case-exhaustiveness")).toBe(true);
    expect(isAuditInvariantId("A8-systemic-decomposition")).toBe(true);
  });
});

describe("A7-edge-case-exhaustiveness", () => {
  const repoRoot = process.cwd();

  it("passes when prompt carries <= 5 non-blank lines without mapped edge cases", () => {
    const prompt = generatePrompt(5);
    const tasks = sampleTasks(2);
    const result = auditPlan(repoRoot, tasks, {}, prompt);
    const a7 = result.findings.find((f) => f.invariant === "A7-edge-case-exhaustiveness");
    expect(a7).toBeUndefined();
  });

  it("blocks when prompt carries > 5 non-blank lines and 0 edge cases are mapped", () => {
    const prompt = generatePrompt(6);
    const tasks = sampleTasks(2);
    const result = auditPlan(repoRoot, tasks, {}, prompt);
    const a7 = result.findings.find((f) => f.invariant === "A7-edge-case-exhaustiveness");
    expect(a7).toBeDefined();
    expect(a7?.severity).toBe("blocking");
    expect(a7?.evidence_class).toBe("derived");
    expect(a7?.task_ids).toEqual(["task-1", "task-2"]);
    expect(a7?.message).toContain("0 edge-case matrix vectors or brainstorming items");
  });

  it("passes when prompt carries > 5 non-blank lines and runState.brainstorming array is provided", () => {
    const prompt = generatePrompt(8);
    const tasks = sampleTasks(2);
    const runState = {
      brainstorming: [{ id: "item-1", vectorId: "EMPTY_PAYLOAD" }],
    };
    const result = auditPlan(repoRoot, tasks, runState, prompt);
    const a7 = result.findings.find((f) => f.invariant === "A7-edge-case-exhaustiveness");
    expect(a7).toBeUndefined();
  });

  it("passes when runState.brainstorming is an object with totalExpandedItems", () => {
    const prompt = generatePrompt(8);
    const tasks = sampleTasks(2);
    const runState = {
      brainstorming: {
        totalExpandedItems: 8,
        roundsExecuted: 3,
      },
    };
    const result = auditPlan(repoRoot, tasks, runState, prompt);
    const a7 = result.findings.find((f) => f.invariant === "A7-edge-case-exhaustiveness");
    expect(a7).toBeUndefined();
  });

  it("passes when runState.brainstorming has expandedItems array", () => {
    const prompt = generatePrompt(8);
    const tasks = sampleTasks(2);
    const runState = {
      brainstorming: {
        expandedItems: [{ id: "item-1" }, { id: "item-2" }],
      },
    };
    const result = auditPlan(repoRoot, tasks, runState, prompt);
    const a7 = result.findings.find((f) => f.invariant === "A7-edge-case-exhaustiveness");
    expect(a7).toBeUndefined();
  });

  it("passes when runState.edge_cases is provided", () => {
    const prompt = generatePrompt(8);
    const tasks = sampleTasks(2);
    const runState = {
      edge_cases: ["ec-1", "ec-2"],
    };
    const result = auditPlan(repoRoot, tasks, runState, prompt);
    const a7 = result.findings.find((f) => f.invariant === "A7-edge-case-exhaustiveness");
    expect(a7).toBeUndefined();
  });

  it("passes when runState.planning contains brainstorming", () => {
    const prompt = generatePrompt(8);
    const tasks = sampleTasks(2);
    const runState = {
      planning: {
        brainstorming: { totalExpandedItems: 16 },
      },
    };
    const result = auditPlan(repoRoot, tasks, runState, prompt);
    const a7 = result.findings.find((f) => f.invariant === "A7-edge-case-exhaustiveness");
    expect(a7).toBeUndefined();
  });

  it("passes when brainstorming.json exists in repoRoot", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "plan-audit-a7-"));
    try {
      writeFileSync(
        join(tempDir, "brainstorming.json"),
        JSON.stringify({ totalExpandedItems: 8 }),
        "utf-8",
      );
      const prompt = generatePrompt(8);
      const tasks = sampleTasks(2);
      const result = auditPlan(tempDir, tasks, {}, prompt);
      const a7 = result.findings.find((f) => f.invariant === "A7-edge-case-exhaustiveness");
      expect(a7).toBeUndefined();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe("A8-systemic-decomposition", () => {
  const repoRoot = process.cwd();

  it("passes when prompt carries <= 10 non-blank lines with few tasks", () => {
    const prompt = generatePrompt(10);
    const tasks = sampleTasks(2);
    const result = auditPlan(repoRoot, tasks, {}, prompt);
    const a8 = result.findings.find((f) => f.invariant === "A8-systemic-decomposition");
    expect(a8).toBeUndefined();
  });

  it("blocks when prompt carries > 10 non-blank lines and tasks count < 6 (default minimum)", () => {
    const prompt = generatePrompt(15);
    const tasks = sampleTasks(2);
    const result = auditPlan(repoRoot, tasks, {}, prompt);
    const a8 = result.findings.find((f) => f.invariant === "A8-systemic-decomposition");
    expect(a8).toBeDefined();
    expect(a8?.severity).toBe("blocking");
    expect(a8?.evidence_class).toBe("derived");
    expect(a8?.task_ids).toEqual(["task-1", "task-2"]);
    expect(a8?.message).toContain("complex prompt");
    expect(a8?.message).toContain("minimum required: 6");
  });

  it("passes when prompt carries > 10 non-blank lines and tasks count >= 6", () => {
    const prompt = generatePrompt(15);
    const tasks = sampleTasks(6);
    const runState = {
      brainstorming: [{ id: "1" }],
    };
    const result = auditPlan(repoRoot, tasks, runState, prompt);
    const a8 = result.findings.find((f) => f.invariant === "A8-systemic-decomposition");
    expect(a8).toBeUndefined();
  });

  it("honors custom repo policy min_tasks_per_complex_prompt threshold", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "plan-audit-a8-"));
    try {
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
      saveRepoPolicy(customPolicy, tempDir);

      const prompt = generatePrompt(15);
      const tasks = sampleTasks(3);
      const runState = {
        brainstorming: [{ id: "1" }],
      };
      const result = auditPlan(tempDir, tasks, runState, prompt);
      const a8 = result.findings.find((f) => f.invariant === "A8-systemic-decomposition");
      expect(a8).toBeUndefined();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
