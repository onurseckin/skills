import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = process.cwd();
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

      const agents = [
        "mind.yaml",
        "orchestrator.yaml",
        "coordinator.yaml",
        "validator.yaml",
        "mechanic-validator.yaml",
        "implementer.yaml",
      ];
      for (const agent of agents) {
        expect(existsSync(join(AGENTS_DIR, agent))).toBeTrue();
      }
    });
  });

  describe("2. Infinite Mind Product Owner Mode & Atomic Admission-to-Dispatch Chaining", () => {
    it("asserts mind.yaml codifies Product Owner invariants and laws", () => {
      const mindYaml = readFileSync(join(AGENTS_DIR, "mind.yaml"), "utf-8");
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
    it("asserts agent specifications declare hierarchical supervision invariants", () => {
      const mindYaml = readFileSync(join(AGENTS_DIR, "mind.yaml"), "utf-8");
      const orchYaml = readFileSync(join(AGENTS_DIR, "orchestrator.yaml"), "utf-8");
      const coordYaml = readFileSync(join(AGENTS_DIR, "coordinator.yaml"), "utf-8");
      const valYaml = readFileSync(join(AGENTS_DIR, "validator.yaml"), "utf-8");
      const mechYaml = readFileSync(join(AGENTS_DIR, "mechanic-validator.yaml"), "utf-8");

      expect(mindYaml).toMatch(/tier:\s*0/);
      expect(orchYaml).toMatch(/tier:\s*1/);
      expect(coordYaml).toMatch(/tier:\s*2/);
      expect(valYaml).toMatch(/tier:\s*3/);
      expect(mechYaml).toMatch(/tier:\s*3/);
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
    it("asserts validator.yaml enforces Cognitive Validator Hard-Lock Interlock (0 commands)", () => {
      const valYaml = readFileSync(join(AGENTS_DIR, "validator.yaml"), "utf-8");

      expect(valYaml).toContain("Cognitive Validator Hard-Lock Interlock");
      expect(valYaml).toContain("commands: []");
    });

    it("asserts mechanic-validator.yaml retains test execution authority", () => {
      const mechYaml = readFileSync(join(AGENTS_DIR, "mechanic-validator.yaml"), "utf-8");

      expect(mechYaml).toContain("task:check");
    });

    it("asserts SKILL.md and AGENTS.md codify Cognitive Validator Hard-Lock Interlock", () => {
      const skillMd = readFileSync(SKILL_MD_PATH, "utf-8");
      const agentsMd = readFileSync(AGENTS_MD_PATH, "utf-8");

      expect(skillMd).toContain("Cognitive Validator Hard-Lock Interlock");
      expect(agentsMd).toContain("Cognitive Validator Hard-Lock Interlock");
    });
  });

  describe("5. Script-Backed Scheduler Diagnostics Engine", () => {
    it("asserts agents codify script-backed diagnostics engine and live CLI receipts", () => {
      const mindYaml = readFileSync(join(AGENTS_DIR, "mind.yaml"), "utf-8");
      const orchYaml = readFileSync(join(AGENTS_DIR, "orchestrator.yaml"), "utf-8");
      const coordYaml = readFileSync(join(AGENTS_DIR, "coordinator.yaml"), "utf-8");

      expect(mindYaml).toContain("doctor");
      expect(orchYaml).toContain("doctor");
      expect(coordYaml).toContain("doctor");
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
