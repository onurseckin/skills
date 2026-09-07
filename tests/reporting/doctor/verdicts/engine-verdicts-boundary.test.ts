import { describe, expect, test } from "bun:test";
import { checkDualChannelUi } from "../../../../olt/scripts/src/reporting/doctor.ts";
import {
  codesOf,
  collectEngineVerdicts,
  errorCodesOf,
  messagesOf,
  shapeCleanState,
  verdictOf,
} from "./harness.ts";

export const engineVerdictsBoundarySuiteName =
  "Doctor engine verdicts - role boundaries, command locks, policy and dual channel UI";

describe(engineVerdictsBoundarySuiteName, () => {
  test("checkCognitiveValidatorCommandLock reports a validator that executed a shell command", async () => {
    const verdicts = await collectEngineVerdicts({
      label: "validator-command",
      shape: (state) => {
        shapeCleanState(state);
        state.grants = [
          { id: "reviewer-socratic", role: "socratic-validator", tools_used: [] },
          { id: "implementer-alpha", role: "implementer", tools_used: [] },
        ];
        state.commands = {
          "C-0001": {
            id: "C-0001",
            agent_id: "implementer-alpha",
            command: "bun test tests/pure-module.test.ts",
          },
          "C-0002": {
            id: "C-0002",
            agent_id: "reviewer-socratic",
            command: "bun test tests/pure-module.test.ts",
          },
        };
      },
    });

    const lock = verdictOf(verdicts, "checkCognitiveValidatorCommandLock");
    expect(lock.passed).toBe(false);
    expect(errorCodesOf(verdicts, "checkCognitiveValidatorCommandLock")).toEqual([
      "COGNITIVE_VALIDATOR_COMMAND_LOCK_VIOLATION",
    ]);
    expect(messagesOf(verdicts, "checkCognitiveValidatorCommandLock")).toContain(
      "reviewer-socratic",
    );
    expect(messagesOf(verdicts, "checkCognitiveValidatorCommandLock")).not.toContain(
      "implementer-alpha",
    );

    expect(errorCodesOf(verdicts, "checkPolicyDoctor")).toContain(
      "COGNITIVE_VALIDATOR_COMMAND_LOCK_VIOLATION",
    );
  });

  test("checkCognitiveValidatorCommandLock reports an implementer running the whole suite", async () => {
    const verdicts = await collectEngineVerdicts({
      label: "implementer-whole-suite",
      shape: (state) => {
        shapeCleanState(state);
        state.commands = {
          "C-0001": {
            id: "C-0001",
            agent_id: "implementer-alpha",
            command: "bun test",
          },
        };
      },
    });

    expect(verdictOf(verdicts, "checkCognitiveValidatorCommandLock").passed).toBe(false);
    expect(errorCodesOf(verdicts, "checkCognitiveValidatorCommandLock")).toEqual([
      "IMPLEMENTER_COMMAND_LOCK_VIOLATION",
    ]);
    expect(messagesOf(verdicts, "checkCognitiveValidatorCommandLock")).toContain(
      "whole-suite test command",
    );
  });

  test("checkRoleBoundaryInterlock reports supervisor code edits and implementer self approval", async () => {
    const verdicts = await collectEngineVerdicts({
      label: "role-boundary-breach",
      shape: (state) => {
        shapeCleanState(state);
        state.grants = [
          { id: "orchestrator-one", role: "orchestrator", tools_used: ["write_to_file"] },
        ];
        state.tasks = {
          "task-self": {
            id: "task-self",
            status: "satisfied",
            assigned_agent: "implementer-self",
            validator_agent: "implementer-self",
            dependencies: [],
            adversarial_probes: [1, 2, 3, 4, 5],
            cognitive_pushbacks: [1, 2, 3, 4, 5],
          },
        };
      },
    });

    const boundary = verdictOf(verdicts, "checkRoleBoundaryInterlock");
    expect(boundary.passed).toBe(false);
    expect(codesOf(verdicts, "checkRoleBoundaryInterlock")).toContain(
      "ROLE_BOUNDARY_SUPERVISOR_CODE_EDIT",
    );
    expect(codesOf(verdicts, "checkRoleBoundaryInterlock")).toContain(
      "ROLE_BOUNDARY_IMPLEMENTER_SELF_APPROVAL",
    );
    expect(messagesOf(verdicts, "checkRoleBoundaryInterlock")).toContain("write_to_file");
  });

  test("checkPolicyDoctor reports a corrupted repository policy document", async () => {
    const verdicts = await collectEngineVerdicts({
      label: "policy-corrupt",
      repoFiles: { ".olt/policy.json": '{ "schema_version": ' },
    });

    const policy = verdictOf(verdicts, "checkPolicyDoctor");
    expect(policy.passed).toBe(false);
    expect(errorCodesOf(verdicts, "checkPolicyDoctor")).toEqual(["POLICY_CORRUPT"]);
    expect(messagesOf(verdicts, "checkPolicyDoctor")).toContain("corrupted or invalid");

    expect(verdictOf(verdicts, "checkPushbackQuotas").passed).toBe(true);
  });

  test("checkDualChannelUi reports contrast defects and missing terminal channels", () => {
    const defective = checkDualChannelUi({
      themeElements: [
        {
          selector: "button.primary",
          name: "Primary Button",
          theme: "dark",
          foregroundColor: "#7a7a7a",
          backgroundColor: "#6b6b6b",
          isLargeText: false,
        },
      ],
      asciiChannelSample: "",
      ansiChannelSample: "",
    });

    expect(defective.passed).toBe(false);
    const codes = defective.findings.map((finding) => finding.code);
    expect(codes).toContain("DUAL_CHANNEL_CONTRAST_DEFECT");
    expect(codes).toContain("TERMINAL_ASCII_CHANNEL_MISSING");
    expect(codes).toContain("TERMINAL_ANSI_CHANNEL_MISSING");
    expect(defective.findings[0]?.message).toContain("button.primary");
  });

  test("checkDualChannelUi passes on compliant contrast with both terminal channels present", () => {
    const compliant = checkDualChannelUi({
      themeElements: [
        {
          selector: "button.primary",
          name: "Primary Button",
          theme: "dark",
          foregroundColor: "#ffffff",
          backgroundColor: "#111111",
          isLargeText: false,
        },
        {
          selector: "button.primary",
          name: "Primary Button",
          theme: "light",
          foregroundColor: "#111111",
          backgroundColor: "#ffffff",
          isLargeText: false,
        },
      ],
      asciiChannelSample: "[ OK ] gate satisfied",
      ansiChannelSample: "[32m[ OK ][0m gate satisfied",
    });

    expect(compliant.passed).toBe(true);
    expect(compliant.findings).toEqual([]);
  });
});
