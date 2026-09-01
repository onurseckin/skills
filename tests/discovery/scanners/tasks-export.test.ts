import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  planTasksForDefect,
  type DefectTaskTarget,
  type PlanTasksForDefectOptions,
  type SmartTaskPlan,
} from "../../../olt/scripts/src/mind/tasks/index.ts";
import { planTasksForDefect as planTasksForDefectFromSmart } from "../../../olt/scripts/src/mind/tasks/smart/index.ts";
import { planTasksForDefect as planTasksForDefectFromExecutor } from "../../../olt/scripts/src/mind/tasks/smart/executor/index.ts";

describe("Task 1.35: Named Export 'planTasksForDefect' in mind/tasks/index.ts", () => {
  test("1. planTasksForDefect is exported cleanly across barrel facades", () => {
    expect(typeof planTasksForDefect).toBe("function");
    expect(typeof planTasksForDefectFromSmart).toBe("function");
    expect(typeof planTasksForDefectFromExecutor).toBe("function");
    expect(planTasksForDefect).toBe(planTasksForDefectFromSmart);
    expect(planTasksForDefect).toBe(planTasksForDefectFromExecutor);
  });

  test("2. planTasksForDefect handles empty array and invalid string input", () => {
    const emptyResult = planTasksForDefect([]);
    expect(Array.isArray(emptyResult)).toBe(true);
    expect(emptyResult.length).toBe(0);

    expect(() => planTasksForDefect("")).toThrow();
    expect(() => planTasksForDefect("   ")).toThrow();
  });

  test("3. planTasksForDefect plans single task from string defect prompt", () => {
    const tasks = planTasksForDefect("defect-missing-feature-flag");
    expect(tasks.length).toBe(1);

    const task = tasks[0]!;
    expect(task.id).toContain("defect-missing-feature-flag");
    expect(task.source_type).toBe("defect_remediation");
    expect(task.priority).toBe("CRITICAL");
    expect(task.charter_goals).toEqual(["G2"]);
    expect(task.assigned_tier).toBe("Tier_3_Implementer");
    expect(task.assigned_implementer).toContain("implementer-defect-");
    expect(task.assigned_validator).toContain("validator-defect-");
    expect(task.acceptance_criteria.length).toBeGreaterThanOrEqual(3);
    expect(task.exact_anchors).toBeDefined();
  });

  test("4. planTasksForDefect plans structured defect target object with severity mapping", () => {
    const defectObj: DefectTaskTarget = {
      id: "defect-core-engine-hang",
      observation: "Engine hangs on empty task queue pop",
      remediation: "Add null check in popNextEligibleTask",
      category: "CORE_ENGINE",
      severity: "high",
      status: "open",
    };

    const tasks = planTasksForDefect(defectObj);
    expect(tasks.length).toBe(1);

    const task = tasks[0]!;
    expect(task.id).toBe("task-1-defect-defect-core-engine-hang");
    expect(task.priority).toBe("HIGH");
    expect(task.candidate_id).toBe("defect-core-engine-hang");
    expect(task.metadata?.defect_id).toBe("defect-core-engine-hang");
    expect(task.write_scope.length).toBeGreaterThan(0);
    expect(task.gate).toContain("bun test");
  });

  test("5. planTasksForDefect supports custom planning options", () => {
    const defectObj: DefectTaskTarget = {
      id: "defect-cli-arg-parse",
      title: "CLI arguments fail to parse",
      category: "CLI_TOOLING",
      severity: "low",
    };

    const options: PlanTasksForDefectOptions = {
      baseId: "custom-task-cli-fix",
      priority: "MEDIUM",
      writeScope: ["olt/scripts/src/cli/commands/audit.ts", "tests/cli/audit.test.ts"],
      gate: "bun test tests/cli/audit.test.ts && bun run typecheck",
      charterGoals: ["G1", "G2"],
      assignedTier: "Tier_2_Coordinator",
      assignedImplementer: "implementer-custom",
      assignedValidator: "validator-custom",
    };

    const tasks = planTasksForDefect(defectObj, options);
    expect(tasks.length).toBe(1);

    const task = tasks[0]!;
    expect(task.id).toBe("custom-task-cli-fix");
    expect(task.priority).toBe("MEDIUM");
    expect(task.write_scope).toEqual(options.writeScope!);
    expect(task.gate).toBe(options.gate!);
    expect(task.charter_goals).toEqual(["G1", "G2"]);
    expect(task.assigned_tier).toBe("Tier_2_Coordinator");
    expect(task.assigned_implementer).toBe("implementer-custom");
    expect(task.assigned_validator).toBe("validator-custom");
  });

  test("6. planTasksForDefect handles batch of defects with collision linking", () => {
    const defects: readonly DefectTaskTarget[] = [
      {
        id: "defect-alpha-1",
        observation: "First issue in mind module",
        write_scope: ["olt/scripts/src/mind/core.ts", "tests/mind/core.test.ts"],
        severity: "critical",
      },
      {
        id: "defect-alpha-2",
        observation: "Second issue sharing mind module scope",
        write_scope: ["olt/scripts/src/mind/core.ts", "tests/mind/core.test.ts"],
        severity: "medium",
      },
    ];

    const tasks = planTasksForDefect(defects);
    expect(tasks.length).toBe(2);

    expect(tasks[0]!.dependencies).toEqual([]);
    expect(tasks[1]!.dependencies).toContain(tasks[0]!.id);
    expect(tasks[0]!.priority).toBe("CRITICAL");
    expect(tasks[1]!.priority).toBe("MEDIUM");
  });

  test("7. Strict repository invariants are verified on modified source files", () => {
    const targetFiles = [
      "olt/scripts/src/mind/tasks/index.ts",
      "olt/scripts/src/mind/tasks/smart/index.ts",
      "olt/scripts/src/mind/tasks/smart/executor/index.ts",
      "olt/scripts/src/mind/tasks/smart/executor/evolution/defect-evolution.ts",
      "tests/discovery/scanners/tasks-export.test.ts",
    ];

    for (const relPath of targetFiles) {
      const fullPath = join(process.cwd(), relPath);
      expect(existsSync(fullPath)).toBe(true);

      const content = readFileSync(fullPath, "utf-8");
      const lines = content.split("\n");
      expect(lines.length).toBeLessThanOrEqual(300);

      expect(content).not.toContain("@ts" + "-ignore");
      expect(content).not.toContain("@ts" + "-expect-error");
      expect(content).not.toContain("@ts" + "-nocheck");

      const colonAny = new RegExp(":\\s*" + "any\\b", "u");
      const asAny = new RegExp("as\\s+" + "any\\b", "u");
      const bracketAny = new RegExp("<" + "any>", "u");
      expect(colonAny.test(content)).toBe(false);
      expect(asAny.test(content)).toBe(false);
      expect(bracketAny.test(content)).toBe(false);

      const blockComment = new RegExp("/" + "\\*[\\s\\S]*?\\*" + "/", "u");
      const lineComment = new RegExp("/" + "/.*$", "mu");
      expect(blockComment.test(content)).toBe(false);
      expect(lineComment.test(content)).toBe(false);
    }
  });
});
