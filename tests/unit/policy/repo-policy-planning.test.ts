import { describe, expect, test } from "bun:test";
import {
  DEFAULT_PLANNING_POLICY,
  generateDefaultRepoPolicy,
  validateRepoPolicy,
  type PlanningPolicy,
} from "../../../olt/scripts/src/policy/repo-policy.ts";

describe("Repo Policy Planning Policy Schema & Validation", () => {
  test("DEFAULT_PLANNING_POLICY contains expected default values", () => {
    expect(DEFAULT_PLANNING_POLICY.mandatory_brainstorming_rounds).toBe(3);
    expect(DEFAULT_PLANNING_POLICY.socratic_expansion_depth).toBe(8);
    expect(DEFAULT_PLANNING_POLICY.enforce_edge_case_matrix).toBe(true);
    expect(DEFAULT_PLANNING_POLICY.min_tasks_per_complex_prompt).toBe(6);
    expect(DEFAULT_PLANNING_POLICY.max_files_per_task).toBe(2);
    expect(DEFAULT_PLANNING_POLICY.reject_shallow_umbrella_compression).toBe(true);
  });

  test("generateDefaultRepoPolicy includes default planning policy across ecosystems", () => {
    const defaultPolicy = generateDefaultRepoPolicy();
    expect(defaultPolicy.planning).toBeDefined();
    expect(defaultPolicy.planning).toEqual(DEFAULT_PLANNING_POLICY);
  });

  test("validateRepoPolicy assigns DEFAULT_PLANNING_POLICY when planning property is omitted", () => {
    const rawPolicy: Record<string, unknown> = {
      schema_version: 1,
      ecosystem: "bun",
      test_runner: {
        default_command: "bun test",
        targeted_pattern: "bun test <path>",
        full_suite_command: "bun test",
      },
    };

    const validated = validateRepoPolicy(rawPolicy);
    expect(validated.planning).toBeDefined();
    expect(validated.planning).toEqual(DEFAULT_PLANNING_POLICY);
  });

  test("validateRepoPolicy correctly parses custom valid planning policy", () => {
    const customPlanning: PlanningPolicy = {
      mandatory_brainstorming_rounds: 5,
      socratic_expansion_depth: 12,
      enforce_edge_case_matrix: false,
      min_tasks_per_complex_prompt: 10,
      max_files_per_task: 1,
      reject_shallow_umbrella_compression: false,
    };

    const rawPolicy: Record<string, unknown> = {
      schema_version: 1,
      ecosystem: "bun",
      test_runner: {
        default_command: "bun test",
        targeted_pattern: "bun test <path>",
        full_suite_command: "bun test",
      },
      planning: customPlanning,
    };

    const validated = validateRepoPolicy(rawPolicy);
    expect(validated.planning).toEqual(customPlanning);
  });

  test("validateRepoPolicy falls back to defaults for invalid or missing planning fields", () => {
    const malformedPlanning: Record<string, unknown> = {
      mandatory_brainstorming_rounds: -1, // invalid negative number -> default (3)
      socratic_expansion_depth: "deep", // invalid type -> default (8)
      enforce_edge_case_matrix: "yes", // invalid type -> default (true)
      min_tasks_per_complex_prompt: 0, // invalid (< 1) -> default (6)
      max_files_per_task: -5, // invalid (< 1) -> default (2)
      reject_shallow_umbrella_compression: 123, // invalid type -> default (true)
    };

    const rawPolicy: Record<string, unknown> = {
      schema_version: 1,
      ecosystem: "bun",
      test_runner: {
        default_command: "bun test",
        targeted_pattern: "bun test <path>",
        full_suite_command: "bun test",
      },
      planning: malformedPlanning,
    };

    const validated = validateRepoPolicy(rawPolicy);
    expect(validated.planning).toEqual(DEFAULT_PLANNING_POLICY);
  });

  test("validateRepoPolicy preserves valid partial fields while defaulting the rest", () => {
    const partialPlanning: Record<string, unknown> = {
      mandatory_brainstorming_rounds: 4,
      max_files_per_task: 3,
    };

    const rawPolicy: Record<string, unknown> = {
      schema_version: 1,
      ecosystem: "bun",
      test_runner: {
        default_command: "bun test",
        targeted_pattern: "bun test <path>",
        full_suite_command: "bun test",
      },
      planning: partialPlanning,
    };

    const validated = validateRepoPolicy(rawPolicy);
    expect(validated.planning).toEqual({
      mandatory_brainstorming_rounds: 4,
      socratic_expansion_depth: DEFAULT_PLANNING_POLICY.socratic_expansion_depth,
      enforce_edge_case_matrix: DEFAULT_PLANNING_POLICY.enforce_edge_case_matrix,
      min_tasks_per_complex_prompt: DEFAULT_PLANNING_POLICY.min_tasks_per_complex_prompt,
      max_files_per_task: 3,
      reject_shallow_umbrella_compression:
        DEFAULT_PLANNING_POLICY.reject_shallow_umbrella_compression,
    });
  });
});
