import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  expandExternalPromptToPlan,
  synthesizeAutonomousTasks,
} from "../../../orchestrating-long-tasks/scripts/src/mind/smart-task-manager.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("Smart Task Manager & Autonomous Synthesizer", () => {
  const testDir = scratchRoot(import.meta.path, "test-smart-task-manager");
  const queueFile = join(testDir, "FEEDBACK_QUEUE.jsonl");

  function setup() {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
    writeFileSync(
      queueFile,
      JSON.stringify({
        id: "fb-test-item",
        title: "Test Feedback Item",
        content: "Test feedback content for smart task manager",
        priority: "CRITICAL_USER_FEEDBACK",
        category: "CORE_ENGINE",
        status: "PENDING",
      }) + "\n",
      "utf8",
    );
  }

  function teardown() {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  it("synthesizes tasks when pending user feedbacks exist", () => {
    setup();
    const result = synthesizeAutonomousTasks({ capsulesDir: queueFile });
    expect(result.mode).toBe("feedback_intake");
    expect(result.tasks.length).toBeGreaterThan(0);
    expect(result.source_items_count).toBeGreaterThan(0);

    const firstTask = result.tasks[0]!;
    expect(firstTask.id).toBeDefined();
    expect(firstTask.label).toBeDefined();
    expect(firstTask.write_scope.length).toBeGreaterThan(0);
    expect(firstTask.gate).toContain("bun test");
    expect(firstTask.source_type).toBe("feedback_intake");
    teardown();
  });

  it("respects maxTasks limit during synthesis", () => {
    setup();
    const result = synthesizeAutonomousTasks({ capsulesDir: queueFile, maxTasks: 2 });
    expect(result.tasks.length).toBeLessThanOrEqual(2);
    teardown();
  });

  it("expands an external prompt into a structured task plan", () => {
    const plan = expandExternalPromptToPlan("Implement real-time metrics telemetry\nDetailed prompt description", {
      baseId: "task-metrics-1",
      charterGoals: ["G1", "G2"],
    });

    expect(plan.id).toBe("task-metrics-1");
    expect(plan.label).toBe("Implement real-time metrics telemetry");
    expect(plan.charter_goals).toEqual(["G1", "G2"]);
    expect(plan.gate).toBe("bun test tests/unit && bun run typecheck");
    expect(plan.source_type).toBe("direct_prompt");
  });

  it("throws when expanding an empty prompt", () => {
    expect(() => {
      expandExternalPromptToPlan("   ");
    }).toThrow("Prompt cannot be empty");
  });
});

describe("Static Invariant Verification: Zero TypeScript any & Zero Suppressions", () => {
  it("verifies smart task manager files contain zero any and zero suppressions", () => {
    const filesToAudit = [
      "/Users/onurseckinsenoglu/repos/skills/orchestrating-long-tasks/scripts/src/mind/smart-task-manager.ts",
      "/Users/onurseckinsenoglu/repos/skills/orchestrating-long-tasks/scripts/src/cli/commands/smart-task-ops.ts",
      "/Users/onurseckinsenoglu/repos/skills/tests/unit/mind/smart-task-manager.test.ts",
    ];

    const anyPattern = /:\s*any\b|as\s+any\b|<any>/;
    const suppressionPattern = /@ts-ignore|@ts-expect-error|@ts-nocheck|eslint-disable|oxlint-disable/;

    for (const filePath of filesToAudit) {
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (line.includes("anyPattern") || line.includes("suppressionPattern")) continue;

        expect(anyPattern.test(line)).toBe(false);
        expect(suppressionPattern.test(line)).toBe(false);
      }
    }
  });
});
