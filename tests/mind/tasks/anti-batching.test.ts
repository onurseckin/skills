import { describe, expect, it } from "bun:test";
import {
  buildExactAnchorBriefing,
  deriveTargetFiles,
  dispatchTaskWithExactAnchors,
  enrichTaskPlanWithExactAnchors,
  extractFileAnchors,
  formatZeroExplorationPrompt,
  prepareExactAnchorBriefingForTask,
} from "../../../olt/scripts/src/mind/tasks/smart/planner/anti-batching.ts";
import type { SmartTaskPlan } from "../../../olt/scripts/src/mind/tasks/smart/planner/models.ts";

function createPlan(partial: Partial<SmartTaskPlan> = {}): SmartTaskPlan {
  return {
    id: "task-anti-1",
    label: "Task Anti 1",
    write_scope: ["olt/scripts/src/mind/tasks/smart/planner/anti-batching.ts"],
    gate: "bun test",
    charter_goals: ["goal-1"],
    acceptance_criteria: ["Must satisfy requirements"],
    dependencies: [],
    source_type: "self_evolution",
    rationale: "Zero-exploration planning",
    ...partial,
  };
}

describe("Anti-Batching & Exact Anchor Planning Suite (anti-batching.ts)", () => {
  describe("deriveTargetFiles", () => {
    it("returns explicit targets directly when provided and non-empty", () => {
      const result = deriveTargetFiles(["src/"], ["src/index.ts", "src/util.ts"]);
      expect(result).toEqual(["src/index.ts", "src/util.ts"]);
    });

    it("extracts explicit file paths and non-slash dir paths from write scope", () => {
      const result = deriveTargetFiles(["src/core/engine.ts", "docs/spec.md", "packages/lib"]);
      expect(result).toEqual(["src/core/engine.ts", "docs/spec.md", "packages/lib"]);
    });

    it("falls back to index.ts for directory-scoped paths when no files matched", () => {
      const result = deriveTargetFiles(["src/mind/", "src/tasks/"]);
      expect(result).toEqual(["src/mind/index.ts", "src/tasks/index.ts"]);
    });
  });

  describe("extractFileAnchors", () => {
    it("extracts and formats AST file anchors with token estimations", () => {
      const anchors = extractFileAnchors(
        "olt/scripts/src/mind/tasks/smart/planner/anti-batching.ts",
        {
          symbolHints: ["deriveTargetFiles"],
        },
      );
      expect(Array.isArray(anchors)).toBe(true);
      if (anchors.length > 0) {
        const first = anchors[0]!;
        expect(first.file_path).toBeDefined();
        expect(first.line_start).toBeGreaterThan(0);
        expect(first.token_count).toBeGreaterThan(0);
      }
    });
  });

  describe("formatZeroExplorationPrompt", () => {
    it("formats briefing with full anchors, custom test commands, and assigned roles", () => {
      const prompt = formatZeroExplorationPrompt({
        task_id: "task-100",
        task_label: "Anchor Task",
        write_scope: ["src/a.ts"],
        target_files: ["src/a.ts"],
        file_anchors: [
          {
            file_path: "src/a.ts",
            line_start: 10,
            line_end: 25,
            symbol_name: "testFn",
            symbol_kind: "function",
            ast_reference: "testFn ast",
            replacement_anchor: "export function testFn() {}",
            token_count: 5,
          },
        ],
        recommended_test_commands: ["bun test tests/a.test.ts"],
        gate_command: "bun test",
        acceptance_criteria: ["Criteria 1", "Criteria 2"],
        rationale: "Strict invariant preservation",
        assigned_tier: "Tier_3_Implementer",
        assigned_implementer: "agent-impl-1",
        assigned_validator: "agent-val-1",
        async_wait_ms: 5000,
      });

      expect(prompt).toContain("# Zero-Exploration 1-Shot Task Briefing");
      expect(prompt).toContain("`task-100`");
      expect(prompt).toContain("`testFn` [function]");
      expect(prompt).toContain("`agent-impl-1`");
      expect(prompt).toContain("`agent-val-1`");
      expect(prompt).toContain("WaitMsBeforeAsync: 5000");
      expect(prompt).toContain("Criteria 1");
    });

    it("formats prompt fallbacks when anchors, test commands, and criteria are empty", () => {
      const prompt = formatZeroExplorationPrompt({
        task_id: "task-empty",
        task_label: "Empty Anchor Task",
        write_scope: ["src/b.ts"],
        target_files: ["src/b.ts"],
        file_anchors: [],
        recommended_test_commands: [],
        gate_command: "bun test",
        acceptance_criteria: [],
        rationale: "Default fallback testing",
        assigned_tier: "Tier_3_Implementer",
        assigned_implementer: undefined,
        assigned_validator: undefined,
        async_wait_ms: 10000,
      });

      expect(prompt).toContain("Full file scope");
      expect(prompt).toContain("bun test");
      expect(prompt).toContain("unassigned");
      expect(prompt).toContain("Implement required changes cleanly");
    });
  });

  describe("buildExactAnchorBriefing", () => {
    it("builds briefing from SmartTaskPlan with default options", () => {
      const plan = createPlan({
        assigned_implementer: "impl-a",
        assigned_validator: "val-a",
      });
      const briefing = buildExactAnchorBriefing(plan);
      expect(briefing.task_id).toBe("task-anti-1");
      expect(briefing.task_label).toBe("Task Anti 1");
      expect(briefing.assigned_implementer).toBe("impl-a");
      expect(briefing.assigned_validator).toBe("val-a");
      expect(briefing.async_wait_ms).toBe(10000);
      expect(briefing.zero_exploration_prompt).toContain("# Zero-Exploration 1-Shot Task Briefing");
    });

    it("handles minimal object input with fallback title, description, and custom asyncWaitMs", () => {
      const minimal = {
        id: "task-min-1",
        title: "Minimal Title",
        description: "Minimal Desc",
      };
      const briefing = buildExactAnchorBriefing(minimal, { asyncWaitMs: 3000 });
      expect(briefing.task_id).toBe("task-min-1");
      expect(briefing.task_label).toBe("Minimal Title");
      expect(briefing.rationale).toBe("Minimal Desc");
      expect(briefing.async_wait_ms).toBe(3000);
      expect(briefing.assigned_tier).toBe("Tier_3_Implementer");
    });

    it("handles task without label or title using id fallback", () => {
      const noLabel = { id: "task-raw" };
      const briefing = buildExactAnchorBriefing(noLabel);
      expect(briefing.task_label).toBe("Task task-raw");
      expect(briefing.rationale).toContain("Task execution for Task task-raw");
    });
  });

  describe("enrichTaskPlanWithExactAnchors & dispatchTaskWithExactAnchors", () => {
    it("enriches task plan with exact briefing, target files, and metadata", () => {
      const plan = createPlan({
        feedback_id: "fb-123",
        candidate_id: "cand-456",
      });
      const enriched = enrichTaskPlanWithExactAnchors(plan);
      expect(enriched.exact_briefing).toBeDefined();
      expect(enriched.target_files).toBeDefined();
      expect(enriched.metadata?.["feedback_id"]).toBe("fb-123");
      expect(enriched.metadata?.["candidate_id"]).toBe("cand-456");
      expect(enriched.metadata?.["zero_exploration_1shot_brief"]).toBeDefined();
    });

    it("prepares exact briefing using prepareExactAnchorBriefingForTask alias", () => {
      const plan = createPlan();
      const briefing = prepareExactAnchorBriefingForTask(plan);
      expect(briefing.task_id).toBe(plan.id);
    });

    it("dispatches task returning enriched plan and zero exploration prompt", () => {
      const plan = createPlan();
      const dispatched = dispatchTaskWithExactAnchors(plan);
      expect(dispatched.plan.exact_briefing).toBeDefined();
      expect(dispatched.briefing.task_id).toBe(plan.id);
      expect(dispatched.zero_exploration_prompt).toContain(
        "# Zero-Exploration 1-Shot Task Briefing",
      );
    });
  });
});
