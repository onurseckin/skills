import { describe, expect, test } from "bun:test";
import {
  CANONICAL_COORDINATOR_RULES,
  DEFECT_REF,
  KNOWN_MISSING_COORDINATOR_BEHAVIOR_MODULE,
  UNRESOLVED_MODULE_IMPORT_IN_REPORTING,
  UnresolvedBehavioralModuleError,
  assertBehavioralAuditorDependencies,
  auditBehavioralModuleTree,
  createDefaultCoordinatorBehaviorRules,
  resolveCoordinatorBehaviorRules,
  validateBehavioralAuditorDependencies,
  type CoordinatorBehaviorRuleDefinition,
} from "../../../olt/scripts/src/validation/defect-reporting-behavioral-auditor-missing-coordinator-behavior.ts";

describe("Task 1.4: Defect Remediation - Reporting Behavioral Auditor Missing Coordinator Behavior", () => {
  test("1. defect constants and error codes are correctly specified", () => {
    expect(DEFECT_REF).toBe(
      "defect-reporting-behavioral-auditor-missing-coordinator-behavior",
    );
    expect(KNOWN_MISSING_COORDINATOR_BEHAVIOR_MODULE).toBe(
      "./doctor/rules/behavioral/coordinator-behavior.ts",
    );
    expect(UNRESOLVED_MODULE_IMPORT_IN_REPORTING).toBe(
      "UNRESOLVED_MODULE_IMPORT_IN_REPORTING",
    );
  });

  test("2. CANONICAL_COORDINATOR_RULES contains all 5 canonical coordinator rules", () => {
    expect(CANONICAL_COORDINATOR_RULES.length).toBe(5);
    const ruleIds = CANONICAL_COORDINATOR_RULES.map((r) => r.id);
    expect(ruleIds).toContain("coordinator_no_file_edit_tools");
    expect(ruleIds).toContain("coordinator_no_file_edit_commands");
    expect(ruleIds).toContain("coordinator_no_full_test_suites");
    expect(ruleIds).toContain("coordinator_no_direct_task_leases");
    expect(ruleIds).toContain("coordinator_enforce_subagent_delegation");
  });

  test("3. CANONICAL_COORDINATOR_RULES is frozen and has correct structure", () => {
    expect(Object.isFrozen(CANONICAL_COORDINATOR_RULES)).toBe(true);
    for (const rule of CANONICAL_COORDINATOR_RULES) {
      expect(typeof rule.id).toBe("string");
      expect(typeof rule.name).toBe("string");
      expect(typeof rule.description).toBe("string");
      expect(typeof rule.remediation).toBe("string");
      expect(typeof rule.category).toBe("string");
      expect(rule.enabled).toBe(true);
      expect(["critical", "important", "minor"]).toContain(rule.severity);
    }
  });

  test("4. createDefaultCoordinatorBehaviorRules returns fresh independent copies", () => {
    const rules1 = createDefaultCoordinatorBehaviorRules();
    const rules2 = createDefaultCoordinatorBehaviorRules();
    expect(rules1).not.toBe(rules2);
    expect(rules1.length).toBe(CANONICAL_COORDINATOR_RULES.length);
    rules1[0] = { ...rules1[0]!, enabled: false };
    expect(rules2[0]!.enabled).toBe(true);
    expect(CANONICAL_COORDINATOR_RULES[0]!.enabled).toBe(true);
  });

  test("5. createDefaultCoordinatorBehaviorRules applies partial overrides for existing rule ids", () => {
    const rules = createDefaultCoordinatorBehaviorRules([
      {
        id: "coordinator_no_file_edit_tools",
        severity: "important",
        enabled: false,
      },
    ]);
    const toolRule = rules.find((r) => r.id === "coordinator_no_file_edit_tools");
    expect(toolRule).toBeDefined();
    expect(toolRule?.severity).toBe("important");
    expect(toolRule?.enabled).toBe(false);
    expect(toolRule?.name).toBe("Coordinator File Edit Tool Ban");
  });

  test("6. createDefaultCoordinatorBehaviorRules appends custom rules for unknown ids", () => {
    const customRule: Partial<CoordinatorBehaviorRuleDefinition> = {
      id: "coordinator_custom_checkpoint_rule",
      name: "Custom Checkpoint Rule",
      description: "Custom rule description",
      severity: "minor",
      category: "custom_category",
      remediation: "Apply custom remediation",
      enabled: true,
    };
    const rules = createDefaultCoordinatorBehaviorRules([customRule]);
    expect(rules.length).toBe(CANONICAL_COORDINATOR_RULES.length + 1);
    const added = rules.find((r) => r.id === "coordinator_custom_checkpoint_rule");
    expect(added).toBeDefined();
    expect(added?.name).toBe("Custom Checkpoint Rule");
  });

  test("7. resolveCoordinatorBehaviorRules returns canonical rules when called with no arguments", () => {
    const rules = resolveCoordinatorBehaviorRules();
    expect(rules.length).toBe(5);
    expect(rules.map((r) => r.id)).toEqual(
      CANONICAL_COORDINATOR_RULES.map((r) => r.id),
    );
  });

  test("8. resolveCoordinatorBehaviorRules resolves known missing module via canonical fallback", () => {
    const rules = resolveCoordinatorBehaviorRules(
      KNOWN_MISSING_COORDINATOR_BEHAVIOR_MODULE,
    );
    expect(rules.length).toBe(5);
    expect(rules[0]?.id).toBe("coordinator_no_file_edit_tools");
  });

  test("9. resolveCoordinatorBehaviorRules respects custom rules provided in options", () => {
    const customRules: readonly CoordinatorBehaviorRuleDefinition[] = [
      {
        id: "custom_rule_alpha",
        name: "Custom Rule Alpha",
        description: "Alpha rule description",
        severity: "minor",
        category: "alpha",
        remediation: "Alpha remediation",
        enabled: false,
      },
    ];
    const resolved = resolveCoordinatorBehaviorRules({ customRules });
    expect(resolved.length).toBe(1);
    expect(resolved[0]?.id).toBe("custom_rule_alpha");
    expect(resolved[0]?.enabled).toBe(false);
  });

  test("10. resolveCoordinatorBehaviorRules enables all rules when enableAll is true", () => {
    const customRules: readonly CoordinatorBehaviorRuleDefinition[] = [
      {
        id: "custom_disabled_rule",
        name: "Disabled Rule",
        description: "Disabled rule description",
        severity: "important",
        category: "policy",
        remediation: "Enable when ready",
        enabled: false,
      },
    ];
    const resolved = resolveCoordinatorBehaviorRules({
      customRules,
      enableAll: true,
    });
    expect(resolved[0]?.enabled).toBe(true);
  });

  test("11. resolveCoordinatorBehaviorRules throws when fallback is disabled for unknown module", () => {
    expect(() =>
      resolveCoordinatorBehaviorRules({
        modulePath: "./doctor/rules/behavioral/non-existent-rule.ts",
        fallbackToCanonical: false,
      }),
    ).toThrow(UnresolvedBehavioralModuleError);
  });

  test("12. UnresolvedBehavioralModuleError instantiates with correct codes and metadata", () => {
    const error = new UnresolvedBehavioralModuleError(
      "./path/to/missing.ts",
      "Custom error explanation",
    );
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("UnresolvedBehavioralModuleError");
    expect(error.code).toBe(UNRESOLVED_MODULE_IMPORT_IN_REPORTING);
    expect(error.defectRef).toBe(DEFECT_REF);
    expect(error.modulePath).toBe("./path/to/missing.ts");
    expect(error.message).toBe("Custom error explanation");
  });

  test("13. validateBehavioralAuditorDependencies passes for standard behavioral auditor modules", () => {
    const report = validateBehavioralAuditorDependencies();
    expect(report.allResolved).toBe(true);
    expect(report.missingModules.length).toBe(0);
    expect(report.checkedModules.length).toBeGreaterThanOrEqual(8);
    expect(report.fallbackApplied).toBe(false);
  });

  test("14. validateBehavioralAuditorDependencies identifies missing/unresolved modules correctly", () => {
    const report = validateBehavioralAuditorDependencies([
      "olt/scripts/src/reporting/behavioral-auditor/types.ts",
      KNOWN_MISSING_COORDINATOR_BEHAVIOR_MODULE,
      "olt/scripts/src/reporting/behavioral-auditor/non-existent-file.ts",
    ]);
    expect(report.allResolved).toBe(false);
    expect(report.missingModules).toContain(
      KNOWN_MISSING_COORDINATOR_BEHAVIOR_MODULE,
    );
    expect(report.missingModules).toContain(
      "olt/scripts/src/reporting/behavioral-auditor/non-existent-file.ts",
    );
    expect(report.fallbackApplied).toBe(true);
  });

  test("15. assertBehavioralAuditorDependencies executes cleanly on valid modules", () => {
    expect(() => assertBehavioralAuditorDependencies()).not.toThrow();
  });

  test("16. assertBehavioralAuditorDependencies throws UnresolvedBehavioralModuleError on missing modules", () => {
    expect(() =>
      assertBehavioralAuditorDependencies([
        KNOWN_MISSING_COORDINATOR_BEHAVIOR_MODULE,
      ]),
    ).toThrow(UnresolvedBehavioralModuleError);
  });

  test("17. auditBehavioralModuleTree generates a complete audit receipt confirming remediation", () => {
    const audit = auditBehavioralModuleTree();
    expect(audit.defectRef).toBe(DEFECT_REF);
    expect(audit.errorCode).toBe(UNRESOLVED_MODULE_IMPORT_IN_REPORTING);
    expect(audit.resolved).toBe(true);
    expect(audit.canonicalRulesCount).toBe(5);
    expect(audit.knownMissingModule).toBe(
      KNOWN_MISSING_COORDINATOR_BEHAVIOR_MODULE,
    );
    expect(audit.fallbackApplied).toBe(true);
    expect(audit.verifiedModules.length).toBeGreaterThanOrEqual(8);
    expect(audit.ruleIds.length).toBe(5);
    expect(typeof audit.timestamp).toBe("string");
  });
});
