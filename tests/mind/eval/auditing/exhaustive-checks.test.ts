import { beforeEach, afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { setupVirtualMindFS, cleanupVirtualMindFS, scratchRoot } from "../../fixtures/index.ts";
import {
  auditDynamicRoles as auditDynamicRolesHierarchy,
  runAutonomousMindRoleAudit,
  formatRoleAuditMarkdown,
  renderRoleAuditAsciiTable,
  formatNonDuplicatePersonaSummary,
  isMindRole,
} from "../../../../olt/scripts/src/mind/auditing/roles/rules/hierarchy.ts";
import { auditSingleRole } from "../../../../olt/scripts/src/mind/auditing/roles/contract-auditor.ts";
import {
  auditDynamicRoles as auditDynamicRolesBatch,
  formatRoleAuditMarkdown as formatBatchMarkdown,
  renderRoleAuditAsciiTable as renderBatchAsciiTable,
  formatNonDuplicatePersonaSummary as formatBatchPersonaSummary,
} from "../../../../olt/scripts/src/mind/auditing/roles/batch-auditor.ts";
import { synthesizeNonDuplicatePersona } from "../../../../olt/scripts/src/mind/auditing/roles/synthesizer.ts";
import {
  getRoleName,
  computePersonaSignature,
  calculatePersonaSimilarity,
  findSimilarPersonas,
} from "../../../../olt/scripts/src/mind/auditing/roles/similarity.ts";
import {
  validateParentChildSupervision,
  assertParentChildBoundary,
  createRoleBoundaryWatchdog,
  verifyRoleBoundaryAction,
  auditRoleBoundaryActions,
} from "../../../../olt/scripts/src/mind/auditing/roles/auditor.ts";
import {
  checkValidatorHardLock,
  checkSpawning,
} from "../../../../olt/scripts/src/mind/auditing/roles/rules/leaf-checks.ts";
import { isFullTestSuiteCommand } from "../../../../olt/scripts/src/mind/auditing/roles/rules/matrix.ts";
import {
  checkNeverUnattendedActions,
  checkDeclinedCandidates,
} from "../../../../olt/scripts/src/mind/auditing/questionnaire/evaluator.ts";
import {
  checkAdmittedCandidateWitnesses,
  checkAdmittedCandidateGoals,
  checkValueConsistency,
} from "../../../../olt/scripts/src/mind/auditing/questionnaire/prompts.ts";
import {
  validateAuditAnswers,
  checkAuditBlocksPulse,
  assertAuditAllowsPulseOpen,
} from "../../../../olt/scripts/src/mind/auditing/questionnaire/reporter.ts";
import { analyzeRunForensics } from "../../../../olt/scripts/src/mind/auditing/meta/evaluator.ts";
import { parseEventsFile } from "../../../../olt/scripts/src/mind/auditing/meta/types.ts";
import {
  parseStateFile,
  parseManifestFile,
  extractToolCallsFromTranscripts,
  extractToolCallsFromEvents,
  calculateEfficiencyScore,
} from "../../../../olt/scripts/src/mind/auditing/meta/timeline.ts";
import { runExtendedForensicsHeuristics } from "../../../../olt/scripts/src/mind/auditing/meta/heuristics-extended.ts";
import { runForensicsHeuristics } from "../../../../olt/scripts/src/mind/auditing/meta/heuristics.ts";
import { auditMindPreplanningStagnation } from "../../../../olt/scripts/src/mind/auditing/mind-stagnation-auditor.ts";
import {
  executeStagnationShockRecovery,
  resolveStagnationIncidents,
} from "../../../../olt/scripts/src/mind/auditing/stagnation-recovery-interlock.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import { DynamicRoleRegistry } from "../../../../olt/scripts/src/mind/roles/dynamic/registry.ts";
import type { DynamicRoleSpec } from "../../../../olt/scripts/src/mind/roles/dynamic/types.ts";
import type { HarnessEvent, RunState } from "../../../../olt/scripts/src/core/contracts/index.ts";

beforeEach(() => {
  setupVirtualMindFS();
});

afterEach(() => {
  cleanupVirtualMindFS();
});

describe("Auditing & Roles Exhaustive Unit Test Suite", () => {
  describe("Hierarchy & Role Auditing Rules", () => {
    it("isMindRole matches mind patterns and rejects non-mind", () => {
      expect(isMindRole("mind")).toBe(true);
      expect(isMindRole("mind-1")).toBe(true);
      expect(isMindRole("tier0-mind-architect")).toBe(true);
      expect(isMindRole("orchestrator")).toBe(false);
      expect(isMindRole("implementer")).toBe(false);
    });

    it("audits dynamic roles with duplicate detection, summaries, and ascii tables", () => {
      const specA: DynamicRoleSpec = {
        name: "test-role-a",
        tier: 3,
        archetype: "tier_3_implementer",
        domain: "backend",
        writeScopePolicy: "lease_bounded",
        grantedCommands: ["task:claim"],
        invariants: ["inv-1"],
        cognitivePillars: ["pil-1"],
        permittedActivities: ["implement features"],
      };

      const specB: DynamicRoleSpec = {
        name: "test-role-b",
        tier: 3,
        archetype: "tier_3_implementer",
        domain: "backend",
        writeScopePolicy: "lease_bounded",
        grantedCommands: ["task:claim"],
        invariants: ["inv-1"],
        cognitivePillars: ["pil-1"],
        permittedActivities: ["implement features"],
      };

      const report = auditDynamicRolesHierarchy([specA, specB], {
        checkDuplicates: true,
        duplicateSimilarityThreshold: 0.8,
      });

      expect(report.summary.totalRolesAudited).toBe(2);
      expect(report.duplicatePairs.length).toBeGreaterThan(0);
      expect(report.markdownReport).toContain("Persona Deduplication");

      const asciiTable = renderRoleAuditAsciiTable(report);
      expect(asciiTable).toContain("test-role-a");
      expect(asciiTable).toContain("test-role-b");

      const emptyTable = renderRoleAuditAsciiTable({ ...report, checkedRoles: [] });
      expect(emptyTable).toBe("(no dynamic roles evaluated)");

      const cleanReport = auditDynamicRolesHierarchy([]);
      const cleanMd = formatRoleAuditMarkdown(cleanReport);
      expect(cleanMd).toContain("Zero role audit findings");

      const compactMd = formatRoleAuditMarkdown(report, { compact: true });
      expect(compactMd).toBeDefined();

      const nonDupSummary = formatNonDuplicatePersonaSummary({
        contract: { role: "test-role-c", tier: 3, spec: specA } as unknown as Record<
          string,
          unknown
        >,
        action: "synthesized_disambiguated",
        deduplicated: false,
        signature: { signatureHash: "1234567890abcdef1234" } as unknown as Record<string, unknown>,
        message: "Unique persona created",
        duplicateOfRole: "test-role-a",
        disambiguatedFrom: "test-role-a",
      });
      expect(nonDupSummary).toContain("Non-Duplicate Persona Synthesis");
      expect(nonDupSummary).toContain("Disambiguated From");
    });

    it("runs autonomous role audit using role registry", () => {
      const reg = new DynamicRoleRegistry();
      const spec: DynamicRoleSpec = {
        name: "auto-role",
        tier: 3,
        archetype: "tier_3_implementer",
        domain: "testing",
        writeScopePolicy: "lease_bounded",
        grantedCommands: ["task:claim"],
      };
      reg.register({ role: "auto-role", tier: 3, spec, sha256: "sha-auto" } as unknown as Record<
        string,
        unknown
      >);

      const report = runAutonomousMindRoleAudit(reg as unknown as Record<string, unknown>);
      expect(report.summary.totalRolesAudited).toBe(1);
    });
  });

  describe("Contract Auditor Rules & Cross-Tier Violations", () => {
    it("audits single role from string file path and string YAML content", () => {
      const roleDir = scratchRoot("exhaustive-roles", "test");
      const roleFile = join(roleDir, "sample-role.md");
      const yamlContent = `---
role: sample-file-role
tier: 3
archetype: tier_3_implementer
domain: core
writeScopePolicy: lease_bounded
grantedCommands:
  - task:claim
---
# Role Definition
`;
      fs.writeFileSync(roleFile, yamlContent);

      const findingsFromFile = auditSingleRole(roleFile);
      expect(findingsFromFile.length).toBe(0);

      const findingsFromYaml = auditSingleRole(yamlContent);
      expect(findingsFromYaml.length).toBe(0);
    });

    it("detects cross-tier spawning, invalid parent roles, forbidden commands, and validator write violations", () => {
      // Tier 0 spawning non-orchestrator
      const tier0Spec: DynamicRoleSpec = {
        name: "bad-mind",
        tier: 0,
        archetype: "tier_0_mind",
        spawns: ["implementer"],
      };
      const f0 = auditSingleRole(tier0Spec);
      expect(f0.some((f) => f.id.includes("FIND-HIER-SPAWN0"))).toBe(true);

      // Tier 1 spawning non-coordinator
      const tier1Spec: DynamicRoleSpec = {
        name: "bad-orch",
        tier: 1,
        archetype: "tier_1_orchestrator",
        spawns: ["implementer"],
        parentRole: "implementer", // invalid parent
      };
      const f1 = auditSingleRole(tier1Spec);
      expect(f1.some((f) => f.id.includes("FIND-HIER-SPAWN1"))).toBe(true);
      expect(f1.some((f) => f.id.includes("FIND-HIER-PARENT1"))).toBe(true);

      // Tier 2 spawning non-worker and invalid parent
      const tier2Spec: DynamicRoleSpec = {
        name: "bad-coord",
        tier: 2,
        archetype: "tier_2_coordinator",
        spawns: ["orchestrator"],
        parentRole: "mind", // invalid parent (must be orchestrator)
        grantedCommands: ["task:claim", "orchestrator:run"],
      };
      const f2 = auditSingleRole(tier2Spec);
      expect(f2.some((f) => f.id.includes("FIND-HIER-SPAWN2"))).toBe(true);
      expect(f2.some((f) => f.id.includes("FIND-HIER-PARENT2"))).toBe(true);
      expect(f2.some((f) => f.id.includes("FIND-CMD-SUPERCLAIM"))).toBe(true);
      expect(f2.some((f) => f.id.includes("FIND-CMD-ORCHRUN"))).toBe(true);

      // Tier 3 invalid parent and validator write policy
      const tier3ValSpec: DynamicRoleSpec = {
        name: "bad-val",
        tier: 3,
        archetype: "tier_3_validator",
        parentRole: "orchestrator", // invalid parent (must be coordinator)
        writeScopePolicy: "lease_bounded",
        permittedActivities: ["edit code files"],
        cognitivePillars: [],
      };
      const f3 = auditSingleRole(tier3ValSpec, { minCognitivePillars: 2 });
      expect(f3.some((f) => f.id.includes("FIND-HIER-PARENT3"))).toBe(true);
      expect(f3.some((f) => f.id.includes("FIND-LEAK-VALWRITE"))).toBe(true);
      expect(f3.some((f) => f.id.includes("FIND-PILLARS"))).toBe(true);
    });
  });
});
