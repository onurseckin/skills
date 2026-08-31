import { describe, expect, it } from "bun:test";
import * as behavioralAuditorModule from "../../../../olt/scripts/src/reporting/behavioral-auditor/index.ts";
import * as doctorRulesModule from "../../../../olt/scripts/src/reporting/doctor/rules/index.ts";
import * as doctorBehavioralRulesModule from "../../../../olt/scripts/src/reporting/doctor/rules/behavioral/index.ts";
import {
  auditBehavioralHealth,
  boundedEvidenceCause,
  evidenceUnavailable,
  inferRole,
  isCoordinatorRole,
  isFullTestSuiteCommand,
  isImplementerRole,
  isOrchestratorRole,
  isSubagentRole,
  isValidatorRole,
} from "../../../../olt/scripts/src/reporting/behavioral-auditor/index.ts";

describe("Behavioral Health Auditor - Setup & Facades", () => {
  it("verifies clean facade exports from reporting/behavioral-auditor", () => {
    expect(typeof behavioralAuditorModule.auditBehavioralHealth).toBe("function");
    expect(typeof behavioralAuditorModule.auditCoordinatorCodeWriting).toBe("function");
    expect(typeof behavioralAuditorModule.auditOrchestratorDirectImplementation).toBe("function");
    expect(typeof behavioralAuditorModule.auditImplementerSelfGradingAndTopology).toBe("function");
    expect(typeof behavioralAuditorModule.auditSubagentPulseTermination).toBe("function");
    expect(typeof behavioralAuditorModule.summarizeBehavioralHealth).toBe("function");
    expect(typeof behavioralAuditorModule.formatBehavioralRoleHealthSection).toBe("function");
  });

  it("verifies doctor rules facades export coordinator behavior", () => {
    expect(typeof doctorRulesModule.auditCoordinatorCodeWriting).toBe("function");
    expect(typeof doctorBehavioralRulesModule.auditCoordinatorCodeWriting).toBe("function");
  });

  it("verifies role predicates and classifiers", () => {
    expect(isCoordinatorRole("coordinator")).toBe(true);
    expect(isCoordinatorRole("coordinator-custom")).toBe(true);
    expect(isCoordinatorRole("implementer")).toBe(false);

    expect(isOrchestratorRole("orchestrator")).toBe(true);
    expect(isOrchestratorRole("worker")).toBe(false);

    expect(isImplementerRole("implementer")).toBe(true);
    expect(isImplementerRole("repairer")).toBe(true);
    expect(isImplementerRole("worker")).toBe(true);
    expect(isImplementerRole("validator")).toBe(false);

    expect(isValidatorRole("validator")).toBe(true);
    expect(isValidatorRole("completeness-critic")).toBe(true);
    expect(isValidatorRole("mind-auditor")).toBe(true);

    expect(isSubagentRole("planner")).toBe(true);
    expect(isSubagentRole("sub-investigator")).toBe(true);
  });

  it("evaluates role inference and evidence causes", () => {
    const roleMap = new Map<string, string>([["agent-1", "coordinator"]]);
    expect(inferRole("agent-1", roleMap, {})).toBe("coordinator");
    expect(inferRole("coord-xyz", new Map(), {})).toBe("coordinator");
    expect(inferRole("impl-xyz", new Map(), {})).toBe("implementer");

    expect(boundedEvidenceCause("simple error message")).toBe("simple error message");
    const finding = evidenceUnavailable(new Error("Disk failure"));
    expect(finding.violation_type).toBe("behavioral_evidence_unavailable");
    expect(finding.observation).toContain("Disk failure");
  });

  it("verifies full test suite command detection", () => {
    expect(isFullTestSuiteCommand(["bun", "test"])).toBe(true);
    expect(isFullTestSuiteCommand(["bun", "run", "test:unit"])).toBe(true);
    expect(isFullTestSuiteCommand(["npm", "test"])).toBe(true);
    expect(isFullTestSuiteCommand(["bun", "test", "tests/unit/foo.test.ts"])).toBe(false);
  });

  it("runs auditBehavioralHealth with empty or clean state", () => {
    const emptyFindings = auditBehavioralHealth("", null);
    expect(emptyFindings).toEqual([]);

    const stateFindings = auditBehavioralHealth("", { tasks: {}, commands: {} });
    expect(stateFindings).toEqual([]);
  });
});
