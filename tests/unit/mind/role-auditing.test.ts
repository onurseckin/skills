import { beforeEach, describe, expect, it } from "bun:test";
import {
  DynamicRoleRegistry,
  resetGlobalRoleRegistry,
  synthesizeDynamicRole,
  type DynamicRoleSpec,
} from "../../../orchestrating-long-tasks/scripts/src/mind/dynamic-roles.ts";
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
} from "../../../orchestrating-long-tasks/scripts/src/mind/role-auditing.ts";
import { HarnessError } from "../../../orchestrating-long-tasks/scripts/src/errors/harness-error.ts";

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

  describe("Autonomous Single Role Auditing (auditSingleRole)", () => {
    it("passes clean, well-formed implementer and validator roles", () => {
      const impl = synthesizeDynamicRole({
        name: "clean-impl",
        archetype: "tier_3_implementer",
        cognitivePillars: [
          "Strict Zero-Any TypeScript Discipline",
          "Disjoint Write Scope Isolation",
        ],
      });

      const val = synthesizeDynamicRole({
        name: "clean-val",
        archetype: "tier_3_validator",
        cognitivePillars: ["Adversarial Gate Falsification", "Quantitative Proof Enforcement"],
      });

      const implFindings = auditSingleRole(impl);
      const valFindings = auditSingleRole(val);

      expect(implFindings).toHaveLength(0);
      expect(valFindings).toHaveLength(0);
    });

    it("flags Anti-Boundary-Leak violations on validators with write permissions", () => {
      const leakySpec: DynamicRoleSpec = {
        name: "leaky-val",
        archetype: "tier_3_validator",
        tier: 3,
        title: "Leaky Validator",
        summary: "Leaky validator summary",
        grantedCommands: ["gate:check"],
        permittedActivities: ["Execute gate", "Write emergency bug fix"],
        prohibitedActions: [],
        invariants: [],
        spawns: [],
        cognitivePillars: ["Pillar 1", "Pillar 2"],
        writeScopePolicy: "lease_bounded",
      };

      const findings = auditSingleRole(leakySpec);
      expect(findings.some((f) => f.category === "anti_boundary_leak")).toBe(true);
      expect(findings.some((f) => f.severity === "CRITICAL")).toBe(true);
    });

    it("flags spawning hierarchy violations (tier 3 leaf spawning or tier 0 cross-tier dispatch)", () => {
      const leafSpawner: DynamicRoleSpec = {
        name: "leaf-spawner",
        archetype: "tier_3_implementer",
        tier: 3,
        title: "Leaf Spawner",
        summary: "Summary",
        grantedCommands: ["task:claim"],
        permittedActivities: ["Claim"],
        prohibitedActions: ["Prohibit"],
        invariants: [],
        spawns: ["sub-worker"],
        cognitivePillars: ["Pillar 1", "Pillar 2"],
        writeScopePolicy: "lease_bounded",
      };

      const findings = auditSingleRole(leafSpawner);
      expect(findings.some((f) => f.category === "spawning_hierarchy")).toBe(true);
    });

    it("flags forbidden command 'orchestrator:run' and supervisory 'task:claim'", () => {
      const orchWithClaim: DynamicRoleSpec = {
        name: "bad-orch",
        archetype: "tier_1_orchestrator",
        tier: 1,
        title: "Bad Orchestrator",
        summary: "Summary",
        grantedCommands: ["orchestrator:run", "task:claim"],
        permittedActivities: ["Supervise"],
        prohibitedActions: ["Direct write"],
        invariants: [],
        spawns: ["coordinator"],
        cognitivePillars: ["Pillar 1", "Pillar 2"],
        writeScopePolicy: "forbidden",
      };

      const findings = auditSingleRole(orchWithClaim);
      expect(findings.some((f) => f.id.includes("FIND-CMD-ORCHRUN"))).toBe(true);
      expect(findings.some((f) => f.id.includes("FIND-CMD-SUPERCLAIM"))).toBe(true);
    });

    it("flags roles with insufficient cognitive pillars", () => {
      const lowPillarSpec: DynamicRoleSpec = {
        name: "low-pillar-worker",
        archetype: "tier_3_implementer",
        tier: 3,
        title: "Worker",
        summary: "Summary",
        grantedCommands: ["task:claim"],
        permittedActivities: ["Act"],
        prohibitedActions: ["Prohibit"],
        invariants: ["Strict Zero-Any TypeScript Discipline"],
        spawns: [],
        cognitivePillars: [],
        writeScopePolicy: "lease_bounded",
      };

      const findings = auditSingleRole(lowPillarSpec, { minCognitivePillars: 2 });
      expect(findings.some((f) => f.category === "cognitive_pillars")).toBe(true);
    });
  });

  describe("Autonomous Full Registry Auditing (auditDynamicRoles & runAutonomousMindRoleAudit)", () => {
    it("audits full catalog, detects cross-role duplicate clusters, and tallies summary", () => {
      const r1 = synthesizeDynamicRole({
        name: "clean-role-1",
        archetype: "tier_0_mind",
        cognitivePillars: ["Pillar 1", "Pillar 2"],
      });

      const r2 = synthesizeDynamicRole({
        name: "dup-role-a",
        archetype: "tier_3_implementer",
        domain: "ui-design",
        grantedCommands: ["task:claim", "task:submit"],
        cognitivePillars: ["Pillar A", "Pillar B"],
      });

      const r3 = synthesizeDynamicRole({
        name: "dup-role-b",
        archetype: "tier_3_implementer",
        domain: "ui-design",
        grantedCommands: ["task:claim", "task:submit"],
        cognitivePillars: ["Pillar A", "Pillar B"],
      });

      const report = auditDynamicRoles([r1, r2, r3]);

      expect(report.summary.totalRolesAudited).toBe(3);
      expect(report.duplicatePairs.length).toBeGreaterThan(0);
      expect(report.findings.some((f) => f.category === "duplicate_persona")).toBe(true);
      expect(report.markdownReport).toContain("Mind Autonomous Role Audit Report");
    });

    it("runs audit on global role registry singleton", () => {
      const reg = new DynamicRoleRegistry();
      reg.register(
        synthesizeDynamicRole({
          name: "reg-worker",
          archetype: "tier_3_implementer",
          cognitivePillars: ["Zero-Any Discipline", "Write Scope Isolation"],
        }),
      );

      const report = runAutonomousMindRoleAudit(reg);
      expect(report.summary.totalRolesAudited).toBe(1);
      expect(report.summary.overallPassed).toBe(true);
    });
  });

  describe("Formatting & Telemetry (Markdown, ASCII Table, Summary)", () => {
    it("renders ASCII audit table for empty and populated reports", () => {
      const emptyReport = auditDynamicRoles([]);
      expect(renderRoleAuditAsciiTable(emptyReport)).toBe("(no dynamic roles evaluated)");

      const role = synthesizeDynamicRole({
        name: "table-role",
        archetype: "tier_3_implementer",
        cognitivePillars: ["Pillar 1", "Pillar 2"],
      });
      const report = auditDynamicRoles([role]);
      const table = renderRoleAuditAsciiTable(report);

      expect(table).toContain("ROLE");
      expect(table).toContain("TIER");
      expect(table).toContain("table-role");
      expect(table).toContain("OK");
    });

    it("formats markdown summary and non-duplicate persona summary", () => {
      const role = synthesizeDynamicRole({
        name: "summary-role",
        archetype: "tier_2_coordinator",
        cognitivePillars: ["Pillar 1", "Pillar 2"],
      });
      const report = auditDynamicRoles([role]);
      const md = formatRoleAuditMarkdown(report);

      expect(md).toContain("Mind Autonomous Role Audit Report");
      expect(md).toContain("Roles Audited");

      const synthResult = synthesizeNonDuplicatePersona({
        name: "synth-summary-role",
        archetype: "tier_3_implementer",
      });
      const synthSummary = formatNonDuplicatePersonaSummary(synthResult);

      expect(synthSummary).toContain("Non-Duplicate Persona Synthesis");
      expect(synthSummary).toContain("synth-summary-role");
    });
  });
});
