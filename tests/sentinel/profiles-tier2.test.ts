import { describe, expect, test } from "bun:test";
import {
  completenessCriticProfile,
  coordinatorProfile,
  planValidatorProfile,
  plannerProfile,
  repairerProfile,
} from "../../olt/scripts/src/sentinel/index.ts";

describe("Sentinel 20-Role Profiles: Tier 2", () => {
  describe("coordinator profile", () => {
    test("allows clean coordination briefing", () => {
      const violations = coordinatorProfile.evaluate({
        agent_id: "coord_01",
        role: "coordinator",
        wave_lane_count: 2,
        wave_concurrency: 2,
      });
      expect(violations).toHaveLength(0);
    });

    test("flags source code modification", () => {
      const violations = coordinatorProfile.evaluate({
        agent_id: "coord_01",
        role: "coordinator",
        modified_files: ["src/index.ts"],
      });
      expect(violations.some((v) => v.code === "COORDINATOR_SOURCE_MUTATION")).toBe(true);
    });

    test("flags whole-suite test execution", () => {
      const violations = coordinatorProfile.evaluate({
        agent_id: "coord_01",
        role: "coordinator",
        executed_commands: ["bun test"],
      });
      expect(violations.some((v) => v.code === "COORDINATOR_BROAD_TEST_SUITE_BREACH")).toBe(true);
    });

    test("flags false serialization blunder", () => {
      const violations = coordinatorProfile.evaluate({
        agent_id: "coord_01",
        role: "coordinator",
        wave_lane_count: 4,
        wave_concurrency: 1,
      });
      expect(violations.some((v) => v.code === "FALSE_SERIALIZATION_BLUNDER")).toBe(true);
    });
  });

  describe("planner profile", () => {
    test("flags source file mutations", () => {
      const violations = plannerProfile.evaluate({
        agent_id: "planner_01",
        role: "planner",
        modified_files: ["src/app.ts"],
      });
      expect(violations.some((v) => v.code === "PLANNER_SOURCE_MUTATION")).toBe(true);
    });
  });

  describe("plan-validator profile", () => {
    test("flags code mutations and shell commands", () => {
      const violations = planValidatorProfile.evaluate({
        agent_id: "plan_val_01",
        role: "plan-validator",
        modified_files: ["src/app.ts"],
        executed_commands: ["ls -la"],
      });
      expect(violations.some((v) => v.code === "PLAN_VALIDATOR_SOURCE_MUTATION")).toBe(true);
      expect(violations.some((v) => v.code === "PLAN_VALIDATOR_SHELL_FORBIDDEN")).toBe(true);
    });
  });

  describe("repairer profile", () => {
    test("flags out of scope defect modification", () => {
      const violations = repairerProfile.evaluate({
        agent_id: "repairer_01",
        role: "repairer",
        write_scope: ["src/fix.ts"],
        modified_files: ["src/other.ts"],
      });
      expect(violations.some((v) => v.code === "OUT_OF_SCOPE_MODIFICATION")).toBe(true);
    });

    test("flags missing regression test run before task submit", () => {
      const violations = repairerProfile.evaluate({
        agent_id: "repairer_01",
        role: "repairer",
        write_scope: ["src/fix.ts"],
        modified_files: ["src/fix.ts"],
        task_status: "submitted",
        had_file_scoped_test_run: false,
      });
      expect(violations.some((v) => v.code === "MISSING_REGRESSION_TEST_RUN")).toBe(true);
    });
  });

  describe("completeness-critic profile", () => {
    test("flags code edits and terminal execution", () => {
      const violations = completenessCriticProfile.evaluate({
        agent_id: "critic_01",
        role: "completeness-critic",
        modified_files: ["src/fix.ts"],
        executed_commands: ["bun test"],
      });
      expect(violations.some((v) => v.code === "CRITIC_SOURCE_MUTATION")).toBe(true);
      expect(violations.some((v) => v.code === "CRITIC_SHELL_FORBIDDEN")).toBe(true);
    });
  });
});
