import { beforeEach, describe, expect, it } from "bun:test";
import {
  DynamicRoleRegistry,
  resetGlobalRoleRegistry,
  synthesizeDynamicRole,
  type DynamicRoleSpec,
} from "../../../../olt/scripts/src/mind/roles/dynamic/index.ts";
import {
  auditDynamicRoles,
  auditSingleRole,
  calculatePersonaSimilarity,
  computePersonaSignature,
  findSimilarPersonas,
  formatNonDuplicatePersonaSummary,
  formatRoleAuditMarkdown,
  renderRoleAuditAsciiTable,
  runAutonomousMindRoleAudit,
  synthesizeNonDuplicatePersona,
} from "../../../../olt/scripts/src/mind/auditing/roles/index.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";


describe("Mind Autonomous Role Auditing & Non-Duplicate Persona Synthesis", () => {
  beforeEach(() => {
    resetGlobalRoleRegistry();
  });

  describe("Persona Signature Computation (computePersonaSignature)", () => {
    it("computes deterministic SHA256 signature for a dynamic role spec", () => {
      const spec: DynamicRoleSpec = {
        name: "test-worker",
        archetype: "tier_3_implementer",
        tier: 3,
        title: "Test Worker",
        summary: "Executes assigned work within write scope.",
        domain: "code-quality",
        grantedCommands: ["task:claim", "task:submit"],
        permittedActivities: ["Claim task", "Submit task"],
        prohibitedActions: ["Touch out of scope files"],
        invariants: ["Zero any discipline"],
        spawns: [],
        cognitivePillars: ["Zero-Any Discipline", "Write Scope Isolation"],
        writeScopePolicy: "lease_bounded",
      };

      const sig1 = computePersonaSignature(spec);
      const sig2 = computePersonaSignature(spec);

      expect(sig1.signatureHash).toBe(sig2.signatureHash);
      expect(sig1.signatureHash).toMatch(/^[a-f0-9]{64}$/);
      expect(sig1.archetype).toBe("tier_3_implementer");
      expect(sig1.tier).toBe(3);
      expect(sig1.domain).toBe("code-quality");
      expect(sig1.writeScopePolicy).toBe("lease_bounded");
    });

    it("changes signature when commands, domain, or archetype change", () => {
      const base = synthesizeDynamicRole({
        name: "base-role",
        archetype: "tier_3_implementer",
        domain: "security",
        grantedCommands: ["task:claim", "task:submit"],
      });

      const changedDomain = synthesizeDynamicRole({
        name: "diff-domain",
        archetype: "tier_3_implementer",
        domain: "performance",
        grantedCommands: ["task:claim", "task:submit"],
      });

      const changedArchetype = synthesizeDynamicRole({
        name: "diff-archetype",
        archetype: "tier_3_validator",
        domain: "security",
      });

      const sigBase = computePersonaSignature(base);
      const sigDomain = computePersonaSignature(changedDomain);
      const sigArchetype = computePersonaSignature(changedArchetype);

      expect(sigBase.signatureHash).not.toBe(sigDomain.signatureHash);
      expect(sigBase.signatureHash).not.toBe(sigArchetype.signatureHash);
    });
  });

  describe("Persona Similarity Calculation (calculatePersonaSimilarity & findSimilarPersonas)", () => {
    it("returns exactMatch and 1.0 similarity for identical role configurations", () => {
      const role1 = synthesizeDynamicRole({
        name: "role-alpha",
        archetype: "tier_3_implementer",
        domain: "code-quality",
        grantedCommands: ["task:claim", "task:submit"],
        cognitivePillars: ["Pillar A", "Pillar B"],
      });

      const role2 = synthesizeDynamicRole({
        name: "role-beta",
        archetype: "tier_3_implementer",
        domain: "code-quality",
        grantedCommands: ["task:claim", "task:submit"],
        cognitivePillars: ["Pillar A", "Pillar B"],
      });

      const metrics = calculatePersonaSimilarity(role1, role2);
      expect(metrics.exactMatch).toBe(true);
      expect(metrics.similarityScore).toBe(1.0);
      expect(metrics.sameArchetype).toBe(true);
      expect(metrics.sameDomain).toBe(true);
      expect(metrics.sameWritePolicy).toBe(true);
    });

    it("calculates partial similarity for roles sharing archetype and domain but differing in commands", () => {
      const role1 = synthesizeDynamicRole({
        name: "worker-1",
        archetype: "tier_3_implementer",
        domain: "performance",
        grantedCommands: ["task:claim", "task:submit", "run:exec"],
      });

      const role2 = synthesizeDynamicRole({
        name: "worker-2",
        archetype: "tier_3_implementer",
        domain: "performance",
        grantedCommands: ["task:claim", "task:submit", "doctor"],
      });

      const metrics = calculatePersonaSimilarity(role1, role2);
      expect(metrics.exactMatch).toBe(false);
      expect(metrics.similarityScore).toBeGreaterThan(0.7);
      expect(metrics.similarityScore).toBeLessThan(1.0);
      expect(metrics.sharedCommandsCount).toBe(2);
    });

    it("finds similar personas in a catalog above threshold", () => {
      const target = synthesizeDynamicRole({
        name: "target-impl",
        archetype: "tier_3_implementer",
        domain: "ui-design",
        grantedCommands: ["task:claim", "task:submit"],
      });

      const similar = synthesizeDynamicRole({
        name: "similar-impl",
        archetype: "tier_3_implementer",
        domain: "ui-design",
        grantedCommands: ["task:claim", "task:submit"],
      });

      const different = synthesizeDynamicRole({
        name: "different-coord",
        archetype: "tier_2_coordinator",
        domain: "system-design",
      });

      const matches = findSimilarPersonas(target, [similar, different], 0.8);
      expect(matches).toHaveLength(1);
      expect(matches[0]?.roleB).toBe("similar-impl");
    });
  });

  describe("Non-Duplicate Persona Synthesis (synthesizeNonDuplicatePersona)", () => {
    it("synthesizes new dynamic persona when no collision or duplicate exists", () => {
      const registry = new DynamicRoleRegistry();
      const result = synthesizeNonDuplicatePersona(
        {
          name: "unique-tester",
          archetype: "tier_3_implementer",
          domain: "type-safety",
        },
        registry,
      );

      expect(result.action).toBe("synthesized_new");
      expect(result.deduplicated).toBe(false);
      expect(result.contract.role).toBe("unique-tester");
      expect(registry.has("unique-tester")).toBe(true);
    });

    it("reuses existing identical persona contract when duplicate signature is detected", () => {
      const registry = new DynamicRoleRegistry();

      const first = synthesizeNonDuplicatePersona(
        {
          name: "standard-repairer",
          archetype: "tier_3_repairer",
          domain: "general",
          grantedCommands: ["task:claim", "task:submit", "recover"],
        },
        registry,
      );

      expect(first.action).toBe("synthesized_new");

      // Attempt to synthesize another persona with identical characteristics under a different name
      const second = synthesizeNonDuplicatePersona(
        {
          name: "redundant-repairer",
          archetype: "tier_3_repairer",
          domain: "general",
          grantedCommands: ["task:claim", "task:submit", "recover"],
        },
        registry,
      );

      expect(second.action).toBe("reused_existing");
      expect(second.deduplicated).toBe(true);
      expect(second.contract.role).toBe("standard-repairer");
      expect(second.duplicateOfRole).toBe("standard-repairer");
      expect(registry.count()).toBe(1);
    });

    it("auto-disambiguates name collisions when specifications differ", () => {
      const registry = new DynamicRoleRegistry();

      synthesizeNonDuplicatePersona(
        {
          name: "lead-optimizer",
          archetype: "tier_3_implementer",
          domain: "performance",
          grantedCommands: ["task:claim", "task:submit"],
        },
        registry,
      );

      const disambiguated = synthesizeNonDuplicatePersona(
        {
          name: "lead-optimizer",
          archetype: "tier_3_implementer",
          domain: "performance",
          grantedCommands: ["task:claim", "task:submit", "doctor", "run:exec"],
          autoDisambiguate: true,
        },
        registry,
      );

      expect(disambiguated.action).toBe("synthesized_disambiguated");
      expect(disambiguated.contract.role).toBe("lead-optimizer-v2");
      expect(disambiguated.disambiguatedFrom).toBe("lead-optimizer");
      expect(registry.count()).toBe(2);
      expect(registry.has("lead-optimizer-v2")).toBe(true);
    });

    it("throws HarnessError on name collision when autoDisambiguate is disabled", () => {
      const registry = new DynamicRoleRegistry();

      synthesizeNonDuplicatePersona(
        {
          name: "strict-role",
          archetype: "tier_3_implementer",
          domain: "security",
        },
        registry,
      );

      expect(() =>
        synthesizeNonDuplicatePersona(
          {
            name: "strict-role",
            archetype: "tier_3_implementer",
            domain: "security",
            grantedCommands: ["task:claim", "task:submit", "doctor"],
            autoDisambiguate: false,
          },
          registry,
        ),
      ).toThrow(HarnessError);
    });
  });
});
