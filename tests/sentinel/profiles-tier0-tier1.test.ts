import { describe, expect, test } from "bun:test";
import {
  mindAuditorProfile,
  mindProfile,
  orchestratorProfile,
  policyDiscoveryProfile,
  skillAuditorProfile,
} from "../../olt/scripts/src/sentinel/index.ts";

describe("Sentinel 20-Role Profiles: Tier 0 & Tier 1", () => {
  describe("mind profile (Tier 0)", () => {
    test("allows clean mind operations", () => {
      const violations = mindProfile.evaluate({
        agent_id: "mind_01",
        role: "mind",
        modified_files: ["docs/planning/ROADMAP.md"],
      });
      expect(violations).toHaveLength(0);
    });

    test("flags direct source code modifications", () => {
      const violations = mindProfile.evaluate({
        agent_id: "mind_01",
        role: "mind",
        modified_files: ["src/core/engine.ts"],
      });
      expect(violations.some((v) => v.code === "MIND_DIRECT_CODE_MUTATION")).toBe(true);
    });

    test("flags false concurrency when wave lanes >= 2 and concurrency < 2", () => {
      const violations = mindProfile.evaluate({
        agent_id: "mind_01",
        role: "mind",
        wave_lane_count: 3,
        wave_concurrency: 1,
      });
      expect(violations.some((v) => v.code === "CONCURRENCY_SLA_BREACH")).toBe(true);
    });

    test("flags defect-first prioritization breach", () => {
      const violations = mindProfile.evaluate({
        agent_id: "mind_01",
        role: "mind",
        pending_defects_count: 5,
      });
      expect(violations.some((v) => v.code === "DEFECT_FIRST_PRIORITIZATION_BREACH")).toBe(true);
    });
  });

  describe("skill-auditor profile (Tier 0)", () => {
    test("flags attempted implementation edits", () => {
      const violations = skillAuditorProfile.evaluate({
        agent_id: "auditor_01",
        role: "skill-auditor",
        modified_files: ["src/app/index.ts"],
      });
      expect(violations.some((v) => v.code === "AUDITOR_CODE_MUTATION")).toBe(true);
    });
  });

  describe("policy-discovery profile (Tier 0)", () => {
    test("flags source file mutations", () => {
      const violations = policyDiscoveryProfile.evaluate({
        agent_id: "discovery_01",
        role: "policy-discovery",
        modified_files: ["src/some_file.ts"],
      });
      expect(violations.some((v) => v.code === "POLICY_DISCOVERY_WRITE_BREACH")).toBe(true);
    });

    test("flags terminal shell commands", () => {
      const violations = policyDiscoveryProfile.evaluate({
        agent_id: "discovery_01",
        role: "policy-discovery",
        executed_commands: ["cat /etc/passwd"],
      });
      expect(violations.some((v) => v.code === "POLICY_DISCOVERY_SHELL_FORBIDDEN")).toBe(true);
    });
  });

  describe("orchestrator profile (Tier 1)", () => {
    test("flags direct source code edits", () => {
      const violations = orchestratorProfile.evaluate({
        agent_id: "orch_01",
        role: "orchestrator",
        modified_files: ["src/pipeline.ts"],
      });
      expect(violations.some((v) => v.code === "ORCHESTRATOR_DIRECT_CODE_MUTATION")).toBe(true);
    });
  });

  describe("mind-auditor profile (Tier 1)", () => {
    test("flags shell execution", () => {
      const violations = mindAuditorProfile.evaluate({
        agent_id: "mind_auditor_01",
        role: "mind-auditor",
        executed_commands: ["bun test"],
      });
      expect(violations.some((v) => v.code === "MIND_AUDITOR_SHELL_FORBIDDEN")).toBe(true);
    });

    test("flags mailbox starvation exceeding 300s", () => {
      const violations = mindAuditorProfile.evaluate({
        agent_id: "mind_auditor_01",
        role: "mind-auditor",
        mailbox_unpolled_duration_s: 350,
      });
      expect(violations.some((v) => v.code === "MAILBOX_STARVATION_DETECTED")).toBe(true);
    });
  });
});
