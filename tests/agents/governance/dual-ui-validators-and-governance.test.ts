import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  parseUnifiedAgentManifest,
  validateUnifiedAgentManifest,
} from "../../../olt/scripts/src/authority/manifest-schema.ts";
import { cleanupVirtualAgentsFS, setupVirtualAgentsFS } from "../fixture.ts";

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const AGENTS_DIR = join(REPO_ROOT, "olt/agents");
const AGENTS_MD_PATH = join(REPO_ROOT, "AGENTS.md");
const SKILL_MD_PATH = join(REPO_ROOT, "olt/SKILL.md");
const BOOK_DIR = join(REPO_ROOT, "docs/book");

describe("Dual UI Validators & Governance Manifests", () => {
  beforeEach(() => {
    setupVirtualAgentsFS();
  });

  afterEach(() => {
    cleanupVirtualAgentsFS();
  });
  describe("ui-headless-validator.yaml & ui-mechanic-validator.yaml", () => {
    it("validates ui-headless-validator manifest structure and invariants", () => {
      const filePath = join(AGENTS_DIR, "ui-headless-validator.yaml");
      const rawYaml = readFileSync(filePath, "utf-8");
      const manifest = parseUnifiedAgentManifest(rawYaml, filePath);

      expect(manifest.name).toBe("ui-headless-validator");
      expect(manifest.role).toBe("ui-headless-validator");
      expect(manifest.tier).toBe(3);
      expect(manifest.tools.enable_subagent_tools).toBe(false);
      expect(manifest.tools.enable_write_tools).toBe(false);

      expect(manifest.permissions.commands).toContain("run:exec");
      expect(manifest.permissions.commands).toContain("task:check");
      expect(manifest.permissions.commands).toContain("task:review");

      expect(manifest.invariants).toContain("ZERO_SOURCE_EDITS");
      expect(manifest.invariants).toContain("AUTOMATED_TESTS_ARE_HALF_THE_JOB");
      expect(manifest.invariants).toContain("MANDATORY_SCREENSHOT_CAPTURE_ALL_4_VIEWPORTS");
      expect(manifest.invariants).toContain("HITBOX_METRIC_VERIFICATION_44PT");
      expect(manifest.invariants).toContain("SUPERFICIAL_UI_APPROVAL_BAN");

      const validation = validateUnifiedAgentManifest(manifest);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toEqual([]);
    });

    it("validates ui-mechanic-validator manifest has hitbox metrics and invariants", () => {
      const filePath = join(AGENTS_DIR, "ui-mechanic-validator.yaml");
      const rawYaml = readFileSync(filePath, "utf-8");
      const manifest = parseUnifiedAgentManifest(rawYaml, filePath);

      expect(manifest.name).toBe("ui-mechanic-validator");
      expect(manifest.invariants).toContain("AUTOMATED_TESTS_ARE_HALF_THE_JOB");
      expect(manifest.invariants).toContain("MANDATORY_SCREENSHOT_CAPTURE_ALL_4_VIEWPORTS");
      expect(manifest.invariants).toContain("HITBOX_METRIC_VERIFICATION_44PT");
      expect(manifest.invariants).toContain("SUPERFICIAL_UI_APPROVAL_BAN");

      const validation = validateUnifiedAgentManifest(manifest);
      expect(validation.valid).toBe(true);
    });
  });

  describe("ui-optical-validator.yaml & ui-validator.yaml", () => {
    it("validates ui-optical-validator manifest zero commands and Socratic focus", () => {
      const filePath = join(AGENTS_DIR, "ui-optical-validator.yaml");
      const rawYaml = readFileSync(filePath, "utf-8");
      const manifest = parseUnifiedAgentManifest(rawYaml, filePath);

      expect(manifest.name).toBe("ui-optical-validator");
      expect(manifest.role).toBe("ui-optical-validator");
      expect(manifest.tier).toBe(3);

      expect(manifest.permissions.commands).not.toContain("run:exec");
      expect(manifest.permissions.commands).not.toContain("shell");
      expect(manifest.permissions.must_not).toContain(
        "Execute ANY bash, test, or terminal commands (0 command execution privileges, `can_execute_shell: false`)",
      );

      expect(manifest.invariants).toContain("COGNITIVE_VALIDATOR_ZERO_COMMANDS_HARDLOCK");
      expect(manifest.invariants).toContain("HEADFUL_VISUAL_SCREENSHOT_REVIEW_MANDATE");
      expect(manifest.invariants).toContain("SUPERFICIAL_UI_APPROVAL_BAN");
      expect(manifest.invariants).toContain("HUMAN_GRADE_COGNITIVE_CRITIQUE");

      const validation = validateUnifiedAgentManifest(manifest);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toEqual([]);
    });

    it("validates ui-validator manifest zero commands and human-grade cognitive critique", () => {
      const filePath = join(AGENTS_DIR, "ui-validator.yaml");
      const rawYaml = readFileSync(filePath, "utf-8");
      const manifest = parseUnifiedAgentManifest(rawYaml, filePath);

      expect(manifest.name).toBe("ui-validator");
      expect(manifest.invariants).toContain("COGNITIVE_VALIDATOR_ZERO_COMMANDS_HARDLOCK");
      expect(manifest.invariants).toContain("HEADFUL_VISUAL_SCREENSHOT_REVIEW_MANDATE");
      expect(manifest.invariants).toContain("SUPERFICIAL_UI_APPROVAL_BAN");
      expect(manifest.invariants).toContain("HUMAN_GRADE_COGNITIVE_CRITIQUE");

      const validation = validateUnifiedAgentManifest(manifest);
      expect(validation.valid).toBe(true);
    });
  });

  describe("Governance Documentation Parity", () => {
    it("verifies AGENTS.md and SKILL.md contain Dual UI Validator separation and companion bootstrapping", () => {
      const agentsMd = readFileSync(AGENTS_MD_PATH, "utf-8");
      const skillMd = readFileSync(SKILL_MD_PATH, "utf-8");

      expect(agentsMd).toContain("ui-headless-validator");
      expect(agentsMd).toContain("ui-optical-validator");
      expect(agentsMd).toContain("Dual UI Validator Separation");
      expect(agentsMd).toContain("DUAL UI VALIDATOR SEPARATION PIPELINE");
      expect(agentsMd).toContain("ONLY HALF OF THE JOB");
      expect(agentsMd).toContain("1-minute high-frequency tracking cadence");

      expect(skillMd).toContain("Dual UI Validator Separation");
      expect(skillMd).toContain("ui-headless-validator");
      expect(skillMd).toContain("ui-optical-validator");
      expect(skillMd).toContain(
        "Tier 0 Policy Discovery & Cold-Start Bootstrapping First Responder",
      );
      expect(skillMd).toContain("1-minute tracking cadence");
    });

    it("verifies book chapters 03, 04, 05, and 08 contain updated governance invariants", () => {
      const ch3 = readFileSync(
        join(BOOK_DIR, "03-tier-0-governance-and-autonomous-mind.md"),
        "utf-8",
      );
      const ch4 = readFileSync(
        join(BOOK_DIR, "04-toolchain-discovery-and-policy-engine.md"),
        "utf-8",
      );
      const ch5 = readFileSync(join(BOOK_DIR, "05-mandatory-companion-auditors.md"), "utf-8");
      const ch8 = readFileSync(join(BOOK_DIR, "08-verification-and-socratic-gating.md"), "utf-8");

      expect(ch3).toContain("Cold-Start Policy Awakening");
      expect(ch3).toContain("Idle-Trap Elimination & Human-Grade Cognitive Critique");

      expect(ch4).toContain("Zero-Config Toolchain Auto-Discovery & Cold-Start Bootstrapping");
      expect(ch4).toContain("cold-start first responder");

      expect(ch5).toContain("1-minute high-frequency tracking cadence");
      expect(ch5).toContain("Eliminates idle traps (>120s stagnation)");

      expect(ch8).toContain("Dual UI Validator Separation");
      expect(ch8).toContain("ui-headless-validator");
      expect(ch8).toContain("ui-optical-validator");
      expect(ch8).toContain("AUTOMATED_TESTS_ARE_HALF_THE_JOB");
    });
  });
});
