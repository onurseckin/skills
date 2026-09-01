import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as yaml from "js-yaml";
import {
  ANTI_MAKEWORK_PILLARS,
  PRODUCT_CRAFT_PILLARS,
  SUPERVISORY_ROLE_BOUNDARIES,
  THREE_STRIKE_CONTAINMENT_RULES,
  getAllRoleBoundaryProfiles,
  getRoleBoundaryProfile,
  isSupervisoryRole,
  normalizeSupervisoryRole,
} from "../../../olt/scripts/src/authority/persona/index.ts";
import { loadAgentManifest } from "../../../olt/scripts/src/authority/manifest/index.ts";

interface GoalEntry {
  readonly id: string;
  readonly statement: string;
}

interface CharterBlock {
  readonly identity: string;
  readonly goals: readonly GoalEntry[];
  readonly cognitive_pillars?: readonly string[] | undefined;
  readonly non_goals: readonly string[];
  readonly repo_roots: readonly string[];
  readonly prohibitions: string;
  readonly escalation?: string | undefined;
}

interface AgentYamlStructure {
  readonly name: string;
  readonly role: string;
  readonly tier: number | "independent";
  readonly provider: readonly string[];
  readonly tools: {
    readonly enable_subagent_tools?: boolean | undefined;
    readonly enable_write_tools?: boolean | undefined;
  };
  readonly interface?: {
    readonly display_name?: string | undefined;
    readonly short_description?: string | undefined;
  };
  readonly charter?: CharterBlock | undefined;
  readonly communication_contract?: {
    readonly protocol: string;
    readonly mailbox_path: string;
    readonly lock_path: string;
    readonly allowed_channels: readonly string[];
  };
  readonly permissions?: {
    readonly may?: readonly string[] | undefined;
    readonly must_not?: readonly string[] | undefined;
    readonly commands?: readonly string[] | undefined;
    readonly spawns?: readonly string[] | undefined;
  };
  readonly invariants?: readonly string[] | undefined;
  readonly protocol?: {
    readonly role_contract?: string | undefined;
    readonly cli?: string | undefined;
    readonly zero_json?: boolean | undefined;
  };
  readonly instructions?: string | undefined;
}

describe("Cognitive Charters & Supervisory Authority Invariants", () => {
  const rootDir = process.cwd();
  const mindPath = join(rootDir, "olt/agents/mind.yaml");
  const mindAuditorPath = join(rootDir, "olt/agents/mind-auditor.yaml");
  const skillAuditorPath = join(rootDir, "olt/agents/skill-auditor.yaml");

  describe("Manifest File Presence and YAML Parsing", () => {
    it("loads and parses olt/agents/mind.yaml cleanly", () => {
      expect(existsSync(mindPath)).toBe(true);
      const raw = readFileSync(mindPath, "utf-8");
      const parsed = yaml.load(raw) as AgentYamlStructure;

      expect(parsed.name).toBe("mind");
      expect(parsed.role).toBe("mind");
      expect(parsed.tier).toBe(0);
      expect(parsed.tools.enable_subagent_tools).toBe(true);
      expect(parsed.charter).toBeDefined();
    });

    it("loads and parses olt/agents/mind-auditor.yaml cleanly", () => {
      expect(existsSync(mindAuditorPath)).toBe(true);
      const raw = readFileSync(mindAuditorPath, "utf-8");
      const parsed = yaml.load(raw) as AgentYamlStructure;

      expect(parsed.name).toBe("mind-auditor");
      expect(parsed.role).toBe("mind-auditor");
      expect(parsed.tier).toBe(0);
      expect(parsed.tools.enable_write_tools).toBe(false);
      expect(parsed.invariants).toBeDefined();
    });

    it("loads and parses olt/agents/skill-auditor.yaml cleanly", () => {
      expect(existsSync(skillAuditorPath)).toBe(true);
      const raw = readFileSync(skillAuditorPath, "utf-8");
      const parsed = yaml.load(raw) as AgentYamlStructure;

      expect(parsed.name).toBe("skill-auditor");
      expect(parsed.role).toBe("skill-auditor");
      expect(parsed.tier).toBe(0);
      expect(parsed.tools.enable_write_tools).toBe(false);
      expect(parsed.invariants).toBeDefined();
    });

    it("loads manifests via authority loader loader.ts", () => {
      const mindManifest = loadAgentManifest("mind");
      expect(mindManifest.name).toBe("mind");
      expect(mindManifest.tier).toBe(0);

      const mindAuditorManifest = loadAgentManifest("mind-auditor");
      expect(mindAuditorManifest.name).toBe("mind-auditor");
      expect(mindAuditorManifest.tier).toBe(0);

      const skillAuditorManifest = loadAgentManifest("skill-auditor");
      expect(skillAuditorManifest.name).toBe("skill-auditor");
      expect(skillAuditorManifest.tier).toBe(0);
    });
  });

  describe("Cognitive Charter Structure & Mandatory Sections", () => {
    it("validates mind.yaml cognitive charter sections: goals, cognitive pillars, non-goals, prohibitions", () => {
      const raw = readFileSync(mindPath, "utf-8");
      const parsed = yaml.load(raw) as AgentYamlStructure;
      const charter = parsed.charter;

      expect(charter).toBeDefined();
      if (!charter) return;

      // Identity
      expect(charter.identity.length).toBeGreaterThan(20);

      // Goals G1 - G5
      expect(charter.goals.length).toBeGreaterThanOrEqual(5);
      const goalIds = charter.goals.map((g) => g.id);
      expect(goalIds).toContain("G1");
      expect(goalIds).toContain("G2");
      expect(goalIds).toContain("G3");
      expect(goalIds).toContain("G4");
      expect(goalIds).toContain("G5");

      // Cognitive Pillars (23 Pillars)
      expect(charter.cognitive_pillars).toBeDefined();
      expect(charter.cognitive_pillars?.length).toBeGreaterThanOrEqual(20);
      const pillarsText = charter.cognitive_pillars?.join("\n") ?? "";
      expect(pillarsText).toContain("Cumulative Dialectical Socratic Laddering");
      expect(pillarsText).toContain("Pre-Declared Pareto Arbitration");
      expect(pillarsText).toContain("Three-Strike Mechanical Supervisory Containment");
      expect(pillarsText).toContain("Anti-Make-Work 5 Pillars of Genuine Value");
      expect(pillarsText).toContain("70/20/10 Innovation Portfolio");

      // Non-goals
      expect(charter.non_goals.length).toBeGreaterThanOrEqual(3);
      const nonGoalsText = charter.non_goals.join("\n");
      expect(nonGoalsText).toContain("Cosmetic churn");
      expect(nonGoalsText).toContain("Abstraction bloat");
      expect(nonGoalsText).toContain("Speculative refactoring");

      // Prohibitions
      expect(charter.prohibitions).toContain("Never use TypeScript `any`");
      expect(charter.prohibitions).toContain("Supervisor Zero Code Edits & Zero Test Runs");
      expect(charter.prohibitions).toContain("Never commit cosmetic churn");
    });

    it("validates mandatory cognitive invariants across mind, mind-auditor, and skill-auditor", () => {
      const mind = yaml.load(readFileSync(mindPath, "utf-8")) as AgentYamlStructure;
      const mindAuditor = yaml.load(readFileSync(mindAuditorPath, "utf-8")) as AgentYamlStructure;
      const skillAuditor = yaml.load(readFileSync(skillAuditorPath, "utf-8")) as AgentYamlStructure;

      // Core invariants in Mind
      const mindInvariants = mind.invariants ?? [];
      expect(mindInvariants).toContain("SUPERVISOR_ZERO_CODE_EDITS");
      expect(mindInvariants).toContain("SUPERVISOR_ZERO_TEST_RUNS");
      expect(mindInvariants).toContain("THREE_STRIKE_MECHANICAL_CONTAINMENT");
      expect(mindInvariants).toContain("ANTI_MAKEWORK_GENUINE_VALUE");
      expect(mindInvariants).toContain("CUMULATIVE_SOCRATIC_PROGRESSION");
      expect(mindInvariants).toContain("PRE_DECLARED_PARETO_ARBITRATION");
      expect(mindInvariants).toContain("INNOVATION_PORTFOLIO_70_20_10");
      expect(mindInvariants).toContain("ERGONOMIC_WALKTHROUGH_AUDITING");
      expect(mindInvariants).toContain("HIERARCHICAL_PARENT_CHILD_SUPERVISION");
      expect(mindInvariants).toContain("INFINITE_MIND_CADENCE");
      expect(mindInvariants).toContain("ANTI_BATCHING_ISOLATION");
      expect(mindInvariants).toContain("QUOTA_FREEZE_ZERO_KILL_RESUME");
      expect(mindInvariants).toContain("ALWAYS_ALIVE_NON_TERMINATING_AUDITOR");

      // Core invariants in Mind Auditor
      const maInvariants = mindAuditor.invariants ?? [];
      expect(maInvariants).toContain("SUPERVISOR_ZERO_CODE_EDITS");
      expect(maInvariants).toContain("SUPERVISOR_ZERO_TEST_RUNS");
      expect(maInvariants).toContain("ANTI_STAGNATION_120S_WATCHDOG");
      expect(maInvariants).toContain("MIND_CREATIVE_STAGNATION_DETECTION");
      expect(maInvariants).toContain("ZERO_DELTA_MESSAGE_SUPPRESSION");
      expect(maInvariants).toContain("ALWAYS_ALIVE_NON_TERMINATING_AUDITOR");
      expect(maInvariants).toContain("CUMULATIVE_SOCRATIC_PROGRESSION");
      expect(maInvariants).toContain("HISTORICAL_DEBATE_MEMORY");
      expect(maInvariants).toContain("SYNTHETIC_CHURN_REJECTION");
      expect(maInvariants).toContain("ANTI_MAKEWORK_GENUINE_VALUE");
      expect(maInvariants).toContain("PRE_DECLARED_PARETO_ARBITRATION");

      // Core invariants in Skill Auditor
      const saInvariants = skillAuditor.invariants ?? [];
      expect(saInvariants).toContain("SUPERVISOR_ZERO_CODE_EDITS");
      expect(saInvariants).toContain("SUPERVISOR_ZERO_TEST_RUNS");
      expect(saInvariants).toContain("THREE_STRIKE_MECHANICAL_CONTAINMENT");
      expect(saInvariants).toContain("MOMENTUM_WATCHDOG_ZOMBIE_RECYCLING");
      expect(saInvariants).toContain("SUSPENDED_ANIMATION_QUOTA_ELASTICITY");
      expect(saInvariants).toContain("ANTI_MAKEWORK_GENUINE_VALUE");
      expect(saInvariants).toContain("ANTI_MAKEWORK_SUPERVISORY_PURITY");
      expect(saInvariants).toContain("ALWAYS_ALIVE_NON_TERMINATING_AUDITOR");
    });
  });

  describe("Authority Persona Profiles & Boundaries", () => {
    it("validates SUPERVISORY_ROLE_BOUNDARIES for mind, orchestrator, and coordinator", () => {
      const mindProfile = getRoleBoundaryProfile("mind");
      expect(mindProfile).toBeDefined();
      expect(mindProfile?.role).toBe("mind");
      expect(mindProfile?.tier).toBe(0);
      expect(mindProfile?.permittedSpawns).toEqual(["orchestrator"]);
      expect(mindProfile?.forbiddenActions).toContain("write_file");
      expect(mindProfile?.forbiddenActions).toContain("edit_file");
      expect(mindProfile?.forbiddenActions).toContain("cosmetic_churn");
      expect(mindProfile?.forbiddenActions).toContain("abstraction_bloat");
      expect(mindProfile?.forbiddenActions).toContain("speculative_refactoring");
      expect(mindProfile?.mandatoryCadence.supervisoryScheduleCron).toBe("*/5 * * * *");

      const orchProfile = getRoleBoundaryProfile("orchestrator");
      expect(orchProfile).toBeDefined();
      expect(orchProfile?.tier).toBe(1);
      expect(orchProfile?.permittedSpawns).toEqual(["coordinator"]);
      expect(orchProfile?.forbiddenActions).toContain("write_file");
      expect(orchProfile?.forbiddenActions).toContain("spawn_tier_3_worker");

      const coordProfile = getRoleBoundaryProfile("coordinator");
      expect(coordProfile).toBeDefined();
      expect(coordProfile?.tier).toBe(2);
      expect(coordProfile?.permittedSpawns).toContain("implementer");
      expect(coordProfile?.permittedSpawns).toContain("validator");
      expect(coordProfile?.forbiddenActions).toContain("write_file");
    });

    it("verifies isSupervisoryRole, normalizeSupervisoryRole, and getAllRoleBoundaryProfiles helpers", () => {
      expect(isSupervisoryRole("mind")).toBe(true);
      expect(isSupervisoryRole("orchestrator")).toBe(true);
      expect(isSupervisoryRole("coordinator")).toBe(true);
      expect(isSupervisoryRole("implementer")).toBe(false);
      expect(isSupervisoryRole("validator")).toBe(false);

      expect(normalizeSupervisoryRole("tier-0")).toBe("mind");
      expect(normalizeSupervisoryRole("orch")).toBe("orchestrator");
      expect(normalizeSupervisoryRole("coord")).toBe("coordinator");
      expect(normalizeSupervisoryRole("implementer")).toBeNull();

      const allProfiles = getAllRoleBoundaryProfiles();
      expect(allProfiles).toHaveLength(3);
    });

    it("verifies THREE_STRIKE_CONTAINMENT_RULES structure and definitions", () => {
      expect(THREE_STRIKE_CONTAINMENT_RULES).toHaveLength(3);

      expect(THREE_STRIKE_CONTAINMENT_RULES[0]?.strike).toBe(1);
      expect(THREE_STRIKE_CONTAINMENT_RULES[0]?.name).toBe("Intercept & Force Delegation");

      expect(THREE_STRIKE_CONTAINMENT_RULES[1]?.strike).toBe(2);
      expect(THREE_STRIKE_CONTAINMENT_RULES[1]?.name).toBe("Hard Capability Revocation");

      expect(THREE_STRIKE_CONTAINMENT_RULES[2]?.strike).toBe(3);
      expect(THREE_STRIKE_CONTAINMENT_RULES[2]?.name).toBe("Persona Re-Spawn");
    });

    it("verifies ANTI_MAKEWORK_PILLARS and PRODUCT_CRAFT_PILLARS authority constants", () => {
      expect(ANTI_MAKEWORK_PILLARS).toHaveLength(5);
      const makeworkNames = ANTI_MAKEWORK_PILLARS.map((p) => p.name);
      expect(makeworkNames).toContain("Functional Utility");
      expect(makeworkNames).toContain("Structural Simplification");
      expect(makeworkNames).toContain("Performance & Efficiency");
      expect(makeworkNames).toContain("Empirical Reliability & Type Safety");
      expect(makeworkNames).toContain("Radical Observability");

      expect(PRODUCT_CRAFT_PILLARS).toHaveLength(5);
      const craftNames = PRODUCT_CRAFT_PILLARS.map((p) => p.name);
      expect(craftNames).toContain("Functional Completeness & Error Resilience");
      expect(craftNames).toContain("Visual Hierarchy & Aesthetic Polish");
      expect(craftNames).toContain("Interaction Ergonomics & Zero Latency");
      expect(craftNames).toContain("Multi-Viewport Cohesion");
      expect(craftNames).toContain("Radical Delight & Contextual Intelligence");
    });
  });
});
