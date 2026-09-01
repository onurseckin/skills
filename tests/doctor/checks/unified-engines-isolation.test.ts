import { describe, expect, test } from "bun:test";
import {
  checkDualChannelUi,
  checkCognitiveValidatorCommandLock,
  checkRoleBoundaryInterlock,
  checkPushbackQuotas,
  MIN_ADVERSARIAL_PROBES,
  MANDATORY_COGNITIVE_PUSHBACKS,
} from "../../../olt/scripts/src/reporting/doctor.ts";

export const unifiedEnginesIsolationSuiteName =
  "Unified Master Doctor - Isolation & Enforcement Engines (UI, Command Lock, Role Boundary, Quotas)";

describe(unifiedEnginesIsolationSuiteName, () => {
  describe("Engine 5: checkDualChannelUi", () => {
    test("passes cleanly on high-contrast WCAG AA compliant theme pairs", () => {
      const result = checkDualChannelUi({
        themeElements: [
          {
            selector: "main.text",
            name: "Main Text",
            theme: "light",
            foregroundColor: "#000000",
            backgroundColor: "#ffffff",
            isLargeText: false,
          },
          {
            selector: "main.text",
            name: "Main Text",
            theme: "dark",
            foregroundColor: "#ffffff",
            backgroundColor: "#000000",
            isLargeText: false,
          },
        ],
      });
      expect(result.passed).toBe(true);
      expect(result.findings).toHaveLength(0);
    });

    test("detects low-contrast theme pairs failing WCAG AA", () => {
      const result = checkDualChannelUi({
        themeElements: [
          {
            selector: "failing.text",
            name: "Failing Text",
            theme: "light",
            foregroundColor: "#777777",
            backgroundColor: "#888888",
            isLargeText: false,
          },
        ],
      });
      expect(result.passed).toBe(false);
      expect(result.findings.some((f) => f.code === "DUAL_CHANNEL_CONTRAST_DEFECT")).toBe(true);
    });

    test("flags missing terminal ASCII or ANSI channels when required", () => {
      const result = checkDualChannelUi({
        asciiChannelSample: "",
        ansiChannelSample: "\x1b[32mOK\x1b[0m",
      });
      expect(result.passed).toBe(false);
      expect(result.findings.some((f) => f.code === "TERMINAL_ASCII_CHANNEL_MISSING")).toBe(true);
    });
  });

  describe("Engine 6: checkCognitiveValidatorCommandLock", () => {
    test("allows implementers to execute commands but blocks validator/critic roles", () => {
      const cleanResult = checkCognitiveValidatorCommandLock({
        grants: [{ id: "agent-impl", role: "implementer" }],
        commands: {
          cmd1: { id: "cmd1", agent_id: "agent-impl", command: "bun test" },
        },
      });
      expect(cleanResult.passed).toBe(true);
      expect(cleanResult.findings).toHaveLength(0);

      const violationResult = checkCognitiveValidatorCommandLock({
        grants: [
          { id: "agent-val", role: "validator" },
          { id: "agent-critic", role: "completeness-critic" },
        ],
        commands: {
          cmd1: { id: "cmd1", agent_id: "agent-val", command: "bun test" },
          cmd2: { id: "cmd2", agent_id: "agent-critic", command: "ls -la" },
        },
      });
      expect(violationResult.passed).toBe(false);
      expect(violationResult.findings).toHaveLength(2);
      expect(violationResult.findings.every((f) => f.severity === "ERROR")).toBe(true);
      expect(violationResult.findings[0]?.code).toBe("COGNITIVE_VALIDATOR_COMMAND_LOCK_VIOLATION");
    });
  });

  describe("Engine 7: checkRoleBoundaryInterlock", () => {
    test("detects supervisor zero-file-edit rule violations", () => {
      const result = checkRoleBoundaryInterlock({
        grants: [
          {
            id: "orch-1",
            role: "orchestrator",
            tools_used: ["write_to_file", "replace_file_content"],
          },
        ],
      });
      expect(result.passed).toBe(false);
      const finding = result.findings.find((f) => f.code === "ROLE_BOUNDARY_SUPERVISOR_CODE_EDIT");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("ERROR");
      expect(finding?.message).toContain("orch-1");
    });

    test("detects implementer planning graph mutations and self-approvals", () => {
      const result = checkRoleBoundaryInterlock({
        grants: [{ id: "impl-1", role: "implementer" }],
        events: [
          {
            name: "plan-brainstormed",
            actor: "impl-1",
            payload: { role: "implementer" },
          },
          {
            name: "task-satisfied",
            actor: "impl-1",
            payload: {
              task_id: "task-1",
              implementer_id: "impl-1",
              role: "implementer",
            },
          },
        ],
      });
      expect(result.passed).toBe(false);
      expect(
        result.findings.some((f) => f.code === "ROLE_BOUNDARY_IMPLEMENTER_PLAN_MUTATION"),
      ).toBe(true);
      expect(
        result.findings.some((f) => f.code === "ROLE_BOUNDARY_IMPLEMENTER_SELF_APPROVAL"),
      ).toBe(true);
    });
  });

  describe("Engine 8: checkPushbackQuotas", () => {
    test("enforces MIN_ADVERSARIAL_PROBES = 5 and MANDATORY_COGNITIVE_PUSHBACKS = 5", () => {
      expect(MIN_ADVERSARIAL_PROBES).toBe(5);
      expect(MANDATORY_COGNITIVE_PUSHBACKS).toBe(5);

      const passedResult = checkPushbackQuotas({
        tasks: {
          "task-done": {
            id: "task-done",
            status: "satisfied",
            adversarial_probes: [1, 2, 3, 4, 5],
            cognitive_pushbacks: [1, 2, 3, 4, 5],
          },
        },
      });
      expect(passedResult.passed).toBe(true);
      expect(passedResult.findings.filter((f) => f.severity === "ERROR")).toHaveLength(0);

      const failedResult = checkPushbackQuotas({
        tasks: {
          "task-deficit": {
            id: "task-deficit",
            status: "satisfied",
            adversarial_probes: [1, 2],
            cognitive_pushbacks: [1, 2, 3],
          },
        },
      });
      expect(failedResult.passed).toBe(false);
      expect(
        failedResult.findings.some((f) => f.code === "PUSHBACK_QUOTA_ADVERSARIAL_PROBES_DEFICIT"),
      ).toBe(true);
      expect(
        failedResult.findings.some((f) => f.code === "PUSHBACK_QUOTA_COGNITIVE_PUSHBACKS_DEFICIT"),
      ).toBe(true);
    });
  });
});
