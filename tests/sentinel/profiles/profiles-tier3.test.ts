import { describe, expect, test } from "bun:test";
import {
  implementerProfile,
  subImplementerProfile,
  subInvestigatorProfile,
  subValidatorProfile,
  uiHeadlessValidatorProfile,
  uiOpticalValidatorProfile,
  validatorProfile,
} from "../../../olt/scripts/src/sentinel/index.ts";

describe("Sentinel 20-Role Profiles: Tier 3", () => {
  describe("implementer profile", () => {
    test("allows clean in-scope modifications with tests", () => {
      const violations = implementerProfile.evaluate({
        agent_id: "impl_01",
        role: "implementer",
        write_scope: ["src/feature.ts"],
        modified_files: ["src/feature.ts"],
        task_status: "submitted",
        had_file_scoped_test_run: true,
      });
      expect(violations).toHaveLength(0);
    });

    test("flags out-of-scope write and missing test run on submit", () => {
      const violations = implementerProfile.evaluate({
        agent_id: "impl_01",
        role: "implementer",
        write_scope: ["src/feature.ts"],
        modified_files: ["src/other.ts"],
        task_status: "submitted",
        had_file_scoped_test_run: false,
      });
      expect(violations.some((v) => v.code === "OUT_OF_SCOPE_MODIFICATION")).toBe(true);
      expect(violations.some((v) => v.code === "MISSING_FILE_SCOPED_TEST_RUN")).toBe(true);
    });
  });

  describe("validator profile", () => {
    test("flags shell commands and source edits", () => {
      const violations = validatorProfile.evaluate({
        agent_id: "val_01",
        role: "validator",
        executed_commands: ["bun test"],
        modified_files: ["src/app.ts"],
      });
      expect(violations.some((v) => v.code === "VALIDATOR_SHELL_FORBIDDEN")).toBe(true);
      expect(violations.some((v) => v.code === "VALIDATOR_SOURCE_MUTATION")).toBe(true);
    });
  });

  describe("ui validator profiles", () => {
    test("ui-headless-validator flags source edits", () => {
      const violations = uiHeadlessValidatorProfile.evaluate({
        agent_id: "ui_h_01",
        role: "ui-headless-validator",
        modified_files: ["src/app.ts"],
      });
      expect(violations.some((v) => v.code === "UI_HEADLESS_SOURCE_MUTATION")).toBe(true);
    });

    test("ui-optical-validator flags approval without screenshot review", () => {
      const violations = uiOpticalValidatorProfile.evaluate({
        agent_id: "ui_opt_01",
        role: "ui-optical-validator",
        task_status: "approved",
        reviewed_screenshots: [],
      });
      expect(violations.some((v) => v.code === "UI_OPTICAL_VIOLATION")).toBe(true);
    });

    test("ui-optical-validator flags shell command attempt", () => {
      const violations = uiOpticalValidatorProfile.evaluate({
        agent_id: "ui_opt_01",
        role: "ui-optical-validator",
        executed_commands: ["ls -la"],
      });
      expect(violations.some((v) => v.code === "UI_OPTICAL_SHELL_FORBIDDEN")).toBe(true);
    });
  });

  describe("sub-worker profiles", () => {
    test("sub-implementer flags out-of-scope edits and broad tests", () => {
      const violations = subImplementerProfile.evaluate({
        agent_id: "sub_impl_01",
        role: "sub-implementer",
        write_scope: ["src/sub.ts"],
        modified_files: ["src/parent.ts"],
        executed_commands: ["bun test"],
      });
      expect(violations.some((v) => v.code === "SUB_IMPLEMENTER_OUT_OF_SCOPE")).toBe(true);
      expect(violations.some((v) => v.code === "SUB_IMPLEMENTER_BROAD_TEST_BREACH")).toBe(true);
    });

    test("sub-investigator flags file edits and shell commands", () => {
      const violations = subInvestigatorProfile.evaluate({
        agent_id: "sub_inv_01",
        role: "sub-investigator",
        modified_files: ["src/sub.ts"],
        executed_commands: ["bun test"],
      });
      expect(violations.some((v) => v.code === "SUB_INVESTIGATOR_WRITE_FORBIDDEN")).toBe(true);
      expect(violations.some((v) => v.code === "SUB_INVESTIGATOR_SHELL_FORBIDDEN")).toBe(true);
    });

    test("sub-validator allows evidence writes but flags source edits", () => {
      const cleanViolations = subValidatorProfile.evaluate({
        agent_id: "sub_val_01",
        role: "sub-validator",
        modified_files: [".olt/capsules/run1/evidence/proof.json"],
      });
      expect(cleanViolations).toHaveLength(0);

      const dirtyViolations = subValidatorProfile.evaluate({
        agent_id: "sub_val_01",
        role: "sub-validator",
        modified_files: ["src/app.ts"],
      });
      expect(dirtyViolations.some((v) => v.code === "SUB_VALIDATOR_SOURCE_MUTATION")).toBe(true);
    });
  });
});
