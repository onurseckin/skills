import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { dirname, join, resolve } from "node:path";

const mockFs = await import("node:fs");
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

const fileCache = new Map<string, string>();
function getFileContent(filePath: string): string {
  let content = fileCache.get(filePath);
  if (content === undefined) {
    content = mockFs.readFileSync(filePath, "utf-8");
    fileCache.set(filePath, content);
  }
  return content;
}

describe("Dual UI Validators & Governance Manifests", () => {
  beforeEach(() => {
    const vfs = setupVirtualAgentsFS();
    for (const [p, content] of fileCache) {
      vfs.mkdirSync(dirname(p), { recursive: true });
      vfs.writeFileSync(p, content);
    }
  });

  afterEach(() => {
    cleanupVirtualAgentsFS();
  });
  describe("ui-headless-validator.yaml", () => {
    it("validates ui-headless-validator manifest structure and invariants", () => {
      const filePath = join(AGENTS_DIR, "ui-headless-validator.yaml");
      const rawYaml = getFileContent(filePath);
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
  });

  describe("ui-optical-validator.yaml", () => {
    it("validates ui-optical-validator manifest zero commands and Socratic focus", () => {
      const filePath = join(AGENTS_DIR, "ui-optical-validator.yaml");
      const rawYaml = getFileContent(filePath);
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
  });

  describe("Governance Documentation Parity", () => {
    it("verifies AGENTS.md and SKILL.md contain Dual UI Validator separation and companion bootstrapping", () => {
      const agentsMd = getFileContent(AGENTS_MD_PATH);
      const skillMd = getFileContent(SKILL_MD_PATH);

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
      const ch3 = getFileContent(join(BOOK_DIR, "03-tier-0-governance-and-autonomous-mind.md"));
      const ch4 = getFileContent(join(BOOK_DIR, "04-toolchain-discovery-and-policy-engine.md"));
      const ch5 = getFileContent(join(BOOK_DIR, "05-mandatory-companion-auditors.md"));
      const ch8 = getFileContent(join(BOOK_DIR, "08-verification-and-socratic-gating.md"));

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
