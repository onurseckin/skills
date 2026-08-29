import { describe, expect, test } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import type { FeedbackItem } from "../../../olt/scripts/src/mind/feedback/queue/index.ts";
import {
  deriveGateForCategory,
  deriveWriteScopeForCategory,
  expandExternalPromptToWavePlan,
  mapFeedbackPriorityToTaskPriority,
  planEnhanceToWavePlan,
  sanitizeSlug,
} from "../../../olt/scripts/src/mind/tasks/smart/executor/orchestrator.ts";

describe("smart-tasks-orchestrator", () => {
  describe("sanitizeSlug", () => {
    test("converts string to lowercase kebab-case", () => {
      expect(sanitizeSlug("Hello World!")).toBe("hello-world");
      expect(sanitizeSlug("---Test---Slug---")).toBe("test-slug");
      expect(sanitizeSlug("abc_123-XYZ")).toBe("abc_123-xyz");
      expect(sanitizeSlug("special!@#$%^&*()symbols")).toBe("special-symbols");
    });
  });

  describe("mapFeedbackPriorityToTaskPriority", () => {
    test("maps feedback priorities accurately to task priorities", () => {
      expect(mapFeedbackPriorityToTaskPriority("CRITICAL_USER_FEEDBACK")).toBe("CRITICAL");
      expect(mapFeedbackPriorityToTaskPriority("HIGH_ARCHITECTURAL_FEATURE")).toBe("HIGH");
      expect(mapFeedbackPriorityToTaskPriority("USER_DIRECTIVE")).toBe("HIGH");
      expect(mapFeedbackPriorityToTaskPriority("NORMAL")).toBe("MEDIUM");
      expect(mapFeedbackPriorityToTaskPriority("LOW")).toBe("LOW");
      expect(mapFeedbackPriorityToTaskPriority("UNKNOWN_PRIORITY")).toBe("MEDIUM");
    });
  });

  describe("deriveWriteScopeForCategory", () => {
    test("returns correct scopes for various categories", () => {
      expect(deriveWriteScopeForCategory("DOCUMENTATION", "doc-1")).toEqual([
        "docs/",
        "olt/references/",
      ]);
      expect(deriveWriteScopeForCategory("AGENT_CONTRACTS", "agent-1")).toEqual([
        "olt/agents/",
        "olt/roles/",
        "olt/references/",
      ]);
      expect(deriveWriteScopeForCategory("CLI_TOOLING", "my-cmd")).toEqual([
        "olt/scripts/src/cli/commands/my-cmd.ts",
        "tests/unit/cli/my-cmd.test.ts",
      ]);
      expect(deriveWriteScopeForCategory("WATCHDOG", "wd-1")).toEqual([
        "olt/scripts/src/authority/watchdog/index.ts",
        "olt/scripts/src/cli/commands/watchdog-ops.ts",
        "tests/unit/authority/watchdog-manager.test.ts",
      ]);
      expect(deriveWriteScopeForCategory("SCALING", "scale-1")).toEqual([
        "olt/scripts/src/workflow/",
        "olt/roles/",
        "tests/unit/workflow/",
      ]);
      expect(deriveWriteScopeForCategory("CORE_ENGINE", "engine-feature")).toEqual([
        "olt/scripts/src/mind/engine-feature.ts",
        "tests/unit/mind/engine-feature.test.ts",
      ]);
      expect(deriveWriteScopeForCategory("ARCHITECTURE", "arch-feature")).toEqual([
        "olt/scripts/src/mind/arch-feature.ts",
        "tests/unit/mind/arch-feature.test.ts",
      ]);
      expect(deriveWriteScopeForCategory("OTHER", "custom-feature")).toEqual([
        "olt/scripts/src/mind/custom-feature.ts",
        "tests/unit/mind/custom-feature.test.ts",
      ]);
    });
  });

  describe("deriveGateForCategory", () => {
    test("derives gate command based on write scope", () => {
      const scopeWithTest = ["olt/scripts/src/cli/cmd.ts", "tests/unit/cli/cmd.test.ts"];
      expect(deriveGateForCategory("CLI_TOOLING", scopeWithTest)).toBe(
        "bun test tests/unit/cli/cmd.test.ts && bun run typecheck",
      );

      const scopeWithDirTest = ["tests/unit/workflow/"];
      expect(deriveGateForCategory("SCALING", scopeWithDirTest)).toBe(
        "bun test tests/unit/workflow && bun run typecheck",
      );

      const scopeWithoutTest = ["docs/", "olt/references/"];
      expect(deriveGateForCategory("DOCUMENTATION", scopeWithoutTest)).toBe(
        "bun test tests/unit && bun run typecheck",
      );
    });
  });

  describe("expandExternalPromptToWavePlan", () => {
    test("throws HarnessError on empty prompt", () => {
      expect(() => expandExternalPromptToWavePlan("")).toThrow(HarnessError);
      expect(() => expandExternalPromptToWavePlan("   \n  \t ")).toThrow(
        "Prompt cannot be empty for wave expansion",
      );
    });

    test("expands multi-line prompt into sequenced wave plan", () => {
      const prompt = `
        # Header comment to be ignored
        Step 1: First action
        Step 2: Second action
        # Another comment
        Step 3: Third action
      `;

      const result = expandExternalPromptToWavePlan(prompt, {
        baseIdPrefix: "test-wave",
        charterGoals: ["G1", "G2"],
      });

      expect(result.waves.length).toBeGreaterThanOrEqual(1);
      const allTasks = result.waves.flatMap((w) => w.tasks);
      expect(allTasks).toHaveLength(3);

      expect(allTasks[0]!.id).toContain("test-wave-1-step-1-first-action");
      expect(allTasks[0]!.charter_goals).toEqual(["G1", "G2"]);
      expect(allTasks[0]!.dependencies).toEqual([]);

      expect(allTasks[1]!.id).toContain("test-wave-2-step-2-second-action");
      expect(allTasks[1]!.dependencies).toEqual([allTasks[0]!.id]);

      expect(allTasks[2]!.id).toContain("test-wave-3-step-3-third-action");
      expect(allTasks[2]!.dependencies).toEqual([allTasks[1]!.id]);
    });

    test("uses default options when none provided", () => {
      const prompt = "Single step prompt";
      const result = expandExternalPromptToWavePlan(prompt);

      expect(result.waves.length).toBeGreaterThanOrEqual(1);
      const allTasks = result.waves.flatMap((w) => w.tasks);
      expect(allTasks).toHaveLength(1);
      expect(allTasks[0]!.id).toContain("wave-task-1-single-step-prompt");
      expect(allTasks[0]!.charter_goals).toEqual(["G1"]);
    });
  });

  describe("planEnhanceToWavePlan", () => {
    test("delegates to expandExternalPromptToWavePlan when given a string", () => {
      const result = planEnhanceToWavePlan("Line 1\nLine 2", {
        baseIdPrefix: "str-wave",
      });
      const allTasks = result.waves.flatMap((w) => w.tasks);
      expect(allTasks).toHaveLength(2);
      expect(allTasks[0]!.id).toContain("str-wave-1-line-1");
    });

    test("enhances feedback items into disjoint or dependent wave tasks", () => {
      const feedbacks: readonly FeedbackItem[] = [
        {
          id: "fb-101",
          title: "Fix documentation links",
          content: "Broken links found in docs references",
          category: "DOCUMENTATION",
          priority: "NORMAL",
          status: "PENDING",
          timestamp: "2026-08-29T00:00:00.000Z",
        },
        {
          id: "fb-102",
          title: "Fix doc reference paths",
          content: "Ensure references match new schema",
          category: "DOCUMENTATION",
          priority: "CRITICAL_USER_FEEDBACK",
          status: "PENDING",
          timestamp: "2026-08-29T00:01:00.000Z",
        },
        {
          id: "fb-103",
          title: "Add CLI tooling command",
          content: "Implement new CLI tool",
          category: "CLI_TOOLING",
          priority: "HIGH_ARCHITECTURAL_FEATURE",
          status: "PENDING",
          timestamp: "2026-08-29T00:02:00.000Z",
        },
      ];

      const result = planEnhanceToWavePlan(feedbacks, {
        baseIdPrefix: "fb-test",
        charterGoals: ["G-SEC"],
      });

      expect(result.waves.length).toBeGreaterThanOrEqual(1);
      const allTasks = result.waves.flatMap((w) => w.tasks);
      expect(allTasks).toHaveLength(3);

      const task1 = allTasks.find((t) => t.id.includes("fb-test-1-fb-101"))!;
      const task2 = allTasks.find((t) => t.id.includes("fb-test-2-fb-102"))!;
      const task3 = allTasks.find((t) => t.id.includes("fb-test-3-fb-103"))!;

      expect(task1).toBeDefined();
      expect(task2).toBeDefined();
      expect(task3).toBeDefined();

      expect(task1.priority).toBe("MEDIUM");
      expect(task2.priority).toBe("CRITICAL");
      expect(task3.priority).toBe("HIGH");

      expect(task2.dependencies).toContain(task1.id);
      expect(task3.dependencies).toEqual([]);
    });

    test("handles empty feedback array gracefully", () => {
      const result = planEnhanceToWavePlan([]);
      expect(result.waves).toHaveLength(0);
      expect(result.total_tasks).toBe(0);
    });
  });
});
