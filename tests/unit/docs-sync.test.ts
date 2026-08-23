import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = process.cwd();
const ROLES_DIR = join(REPO_ROOT, "olt", "roles");
const AGENTS_DIR = join(REPO_ROOT, "olt", "agents");
const SKILL_MD_PATH = join(REPO_ROOT, "olt", "SKILL.md");
const AGENTS_MD_PATH = join(REPO_ROOT, "AGENTS.md");
const SKILL_AGENTS_MD_PATH = join(REPO_ROOT, "olt", "AGENTS.md");

describe("Canonical Codification & Global Documentation Sync Test Suite", () => {
  describe("1. Target Files Existence & Baseline Integrity", () => {
    it("verifies all canonical documentation and agent specifications exist", () => {
      expect(existsSync(SKILL_MD_PATH)).toBeTrue();
      expect(existsSync(AGENTS_MD_PATH)).toBeTrue();
      expect(existsSync(SKILL_AGENTS_MD_PATH)).toBeTrue();

      const roles = [
        "mind.md",
        "orchestrator.md",
        "coordinator.md",
        "validator.md",
        "mechanic-validator.md",
        "implementer.md",
      ];
      for (const role of roles) {
        expect(existsSync(join(ROLES_DIR, role))).toBeTrue();
      }

      const agents = [
        "mind.yaml",
        "orchestrator.yaml",
        "coordinator.yaml",
        "validator.yaml",
        "mechanic_validator.yaml",
        "implementer.yaml",
      ];
      for (const agent of agents) {
        expect(existsSync(join(AGENTS_DIR, agent))).toBeTrue();
      }
    });
  });

  describe("2. Infinite Mind Product Owner Mode & Atomic Admission-to-Dispatch Chaining", () => {
    it("asserts mind.md codifies Product Owner mode, zero paused admitted items, and atomic dispatch", () => {
      const mindMd = readFileSync(join(ROLES_DIR, "mind.md"), "utf-8");
      expect(mindMd).toContain("Infinite Mind Product Owner");
      expect(mindMd).toContain("Atomic Admission-to-Dispatch");
      expect(mindMd).toContain("zero paused admitted");
      expect(mindMd).toContain("Anti-Batching Rule");
      expect(mindMd).toContain("Mode A");
      expect(mindMd).toContain("Mode B");
      expect(mindMd).toContain("multi-orchestrator pre-planning");
    });

    it("asserts mind.yaml codifies Product Owner invariants and laws", () => {
      const mindYaml = readFileSync(join(AGENTS_DIR, "mind.yaml"), "utf-8");
      expect(mindYaml).toContain("infinite_product_owner_mode: true");
      expect(mindYaml).toContain("atomic_admission_to_dispatch_chaining: true");
      expect(mindYaml).toContain("zero_paused_admitted_items: true");
      expect(mindYaml).toContain("anti_batching_isolation: true");
      expect(mindYaml).toContain("Product Owner");
      expect(mindYaml).toContain("Atomic Admission-to-Dispatch");
    });

    it("asserts SKILL.md and AGENTS.md codify Product Owner mode and atomic admission invariants", () => {
      const skillMd = readFileSync(SKILL_MD_PATH, "utf-8");
      const agentsMd = readFileSync(AGENTS_MD_PATH, "utf-8");
      const skillAgentsMd = readFileSync(SKILL_AGENTS_MD_PATH, "utf-8");

      expect(skillMd).toContain("Infinite Mind Product Owner Mode");
      expect(skillMd).toContain("Atomic Admission-to-Dispatch Chaining");
      expect(skillMd).toContain("ZERO paused admitted items");

      for (const doc of [agentsMd, skillAgentsMd]) {
        expect(doc).toContain("Infinite Mind Product Owner Mode");
        expect(doc).toContain("Atomic Admission-to-Dispatch Chaining");
        expect(doc).toContain("ZERO paused admitted items");
        expect(doc).toContain("Anti-Batching Rule");
      }
    });
  });

  describe("3. Active 4-Tier Hierarchical Parent-Child Supervision", () => {
    it("asserts all role contracts codify strict 4-tier boundaries and direct parent supervision", () => {
      const mindMd = readFileSync(join(ROLES_DIR, "mind.md"), "utf-8");
      const orchMd = readFileSync(join(ROLES_DIR, "orchestrator.md"), "utf-8");
      const coordMd = readFileSync(join(ROLES_DIR, "coordinator.md"), "utf-8");
      const valMd = readFileSync(join(ROLES_DIR, "validator.md"), "utf-8");
      const mechMd = readFileSync(join(ROLES_DIR, "mechanic-validator.md"), "utf-8");
      const implMd = readFileSync(join(ROLES_DIR, "implementer.md"), "utf-8");

      expect(mindMd).toMatch(/tier:\s*0/);
      expect(mindMd).toContain("4-Tier Hierarchical");
      expect(mindMd).toContain("orchestrator");

      expect(orchMd).toMatch(/tier:\s*1/);
      expect(orchMd).toContain("4-Tier Hierarchical");
      expect(orchMd).toContain("coordinator");

      expect(coordMd).toMatch(/tier:\s*2/);
      expect(coordMd).toContain("4-Tier Hierarchical");

      expect(valMd).toMatch(/tier:\s*3/);
      expect(valMd).toContain("4-Tier Hierarchical");

      expect(mechMd).toMatch(/tier:\s*3/);
      expect(mechMd).toContain("4-Tier Hierarchical");

      expect(implMd).toMatch(/tier:\s*3/);
      expect(implMd).toContain("4-tier hierarchy");
    });

    it("asserts agent specifications declare hierarchical supervision invariants", () => {
      const mindYaml = readFileSync(join(AGENTS_DIR, "mind.yaml"), "utf-8");
      const orchYaml = readFileSync(join(AGENTS_DIR, "orchestrator.yaml"), "utf-8");
      const coordYaml = readFileSync(join(AGENTS_DIR, "coordinator.yaml"), "utf-8");
      const valYaml = readFileSync(join(AGENTS_DIR, "validator.yaml"), "utf-8");
      const mechYaml = readFileSync(join(AGENTS_DIR, "mechanic_validator.yaml"), "utf-8");

      expect(mindYaml).toContain("hierarchical_parent_child_supervision: true");
      expect(orchYaml).toContain("hierarchical_parent_child_supervision: true");
      expect(coordYaml).toContain("hierarchical_parent_child_supervision: true");
      expect(valYaml).toContain("hierarchical_parent_child_supervision: true");
      expect(mechYaml).toContain("hierarchical_parent_child_supervision: true");
    });

    it("asserts SKILL.md and AGENTS.md codify the 4-tier architecture and supervision rules", () => {
      const skillMd = readFileSync(SKILL_MD_PATH, "utf-8");
      const agentsMd = readFileSync(AGENTS_MD_PATH, "utf-8");

      expect(skillMd).toContain("Active 4-Tier Hierarchical Parent-Child Supervision");
      expect(agentsMd).toContain("4-TIER AGENT ARCHITECTURE");
      expect(agentsMd).toContain("Active 4-Tier Hierarchical Parent-Child Supervision");
    });
  });

  describe("4. Cognitive Validator Hard-Lock Interlock", () => {
    it("asserts validator.md and validator.yaml enforce Cognitive Validator Hard-Lock Interlock (0 commands)", () => {
      const valMd = readFileSync(join(ROLES_DIR, "validator.md"), "utf-8");
      const valYaml = readFileSync(join(AGENTS_DIR, "validator.yaml"), "utf-8");

      expect(valMd).toContain("Cognitive Validator Hard-Lock Interlock");
      expect(valMd).toContain("ZERO command execution privileges");
      expect(valMd).toContain("0 `run:exec`");

      expect(valYaml).toContain("cognitive_validator_hardlock: true");
      expect(valYaml).toContain("Cognitive Validator Hard-Lock Interlock");
      expect(valYaml).toContain("0 command privileges");
    });

    it("asserts mechanic-validator.md and mechanic_validator.yaml retain test execution authority", () => {
      const mechMd = readFileSync(join(ROLES_DIR, "mechanic-validator.md"), "utf-8");
      const mechYaml = readFileSync(join(AGENTS_DIR, "mechanic_validator.yaml"), "utf-8");

      expect(mechMd).toContain("Cognitive Validator Hard-Lock Interlock");
      expect(mechMd).toContain("Mechanic Validator retains test execution and shell authority");

      expect(mechYaml).toContain("mechanic_test_execution_authority: true");
      expect(mechYaml).toContain("cognitive_validator_hardlock_interlock: true");
      expect(mechYaml).toContain("run:exec");
    });

    it("asserts SKILL.md and AGENTS.md codify Cognitive Validator Hard-Lock Interlock", () => {
      const skillMd = readFileSync(SKILL_MD_PATH, "utf-8");
      const agentsMd = readFileSync(AGENTS_MD_PATH, "utf-8");

      expect(skillMd).toContain("Cognitive Validator Hard-Lock Interlock");
      expect(agentsMd).toContain("Cognitive Validator Hard-Lock Interlock");
    });
  });

  describe("5. Script-Backed Scheduler Diagnostics Engine", () => {
    it("asserts roles and agents codify script-backed diagnostics engine and live CLI receipts", () => {
      const mindMd = readFileSync(join(ROLES_DIR, "mind.md"), "utf-8");
      const orchMd = readFileSync(join(ROLES_DIR, "orchestrator.md"), "utf-8");
      const coordMd = readFileSync(join(ROLES_DIR, "coordinator.md"), "utf-8");

      expect(mindMd).toContain("Script-Backed Scheduler Diagnostics Engine");
      expect(mindMd).toContain("doctor");
      expect(mindMd).toContain("health");
      expect(mindMd).toContain("dag:view");
      expect(mindMd).toContain("report:unified");
      expect(mindMd).toContain("SHA-256");

      expect(orchMd).toContain("Script-Backed Scheduler Diagnostics Engine");
      expect(coordMd).toContain("Script-Backed Scheduler Diagnostics Engine");

      const mindYaml = readFileSync(join(AGENTS_DIR, "mind.yaml"), "utf-8");
      const orchYaml = readFileSync(join(AGENTS_DIR, "orchestrator.yaml"), "utf-8");
      const coordYaml = readFileSync(join(AGENTS_DIR, "coordinator.yaml"), "utf-8");

      expect(mindYaml).toContain("script_backed_scheduler_diagnostics: true");
      expect(orchYaml).toContain("script_backed_scheduler_diagnostics: true");
      expect(coordYaml).toContain("script_backed_scheduler_diagnostics: true");
    });

    it("asserts SKILL.md and AGENTS.md codify script-backed diagnostics engine", () => {
      const skillMd = readFileSync(SKILL_MD_PATH, "utf-8");
      const agentsMd = readFileSync(AGENTS_MD_PATH, "utf-8");

      expect(skillMd).toContain("Script-Backed Scheduler Diagnostics Engine");
      expect(agentsMd).toContain("Script-Backed Scheduler Diagnostics Engine");
      expect(agentsMd).toContain("SHA-256");
    });
  });
});
