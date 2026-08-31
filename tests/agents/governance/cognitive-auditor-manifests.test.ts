import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseUnifiedAgentManifest,
  validateUnifiedAgentManifest,
} from "../../../olt/scripts/src/authority/manifest-schema.ts";

import { resolve } from "node:path";
const REPO_ROOT = resolve(import.meta.dir, "../../..");
const AGENTS_DIR = join(REPO_ROOT, "olt/agents");
const AGENTS_MD_PATH = join(REPO_ROOT, "AGENTS.md");
const SKILL_MD_PATH = join(REPO_ROOT, "olt/SKILL.md");

describe("Cognitive Auditor Manifests (mind-auditor.yaml & skill-auditor.yaml)", () => {
  describe("mind-auditor.yaml", () => {
    const filePath = join(AGENTS_DIR, "mind-auditor.yaml");
    const rawYaml = readFileSync(filePath, "utf-8");

    it("parses correctly as a Tier 0 out-of-band observer", () => {
      const manifest = parseUnifiedAgentManifest(rawYaml, filePath);

      expect(manifest.name).toBe("mind-auditor");
      expect(manifest.role).toBe("mind-auditor");
      expect(manifest.tier).toBe(0);
      expect(manifest.tools.enable_subagent_tools).toBe(false);
      expect(manifest.tools.enable_write_tools).toBe(false);
      expect(manifest.interface.display_name).toBe("Mind Auditor");
      expect(manifest.interface.short_description).toBe(
        "Tier 0 Out-of-Band Stagnation & Mind Pulse Auditor",
      );

      expect(manifest.permissions.may).toContain("detect idle mind >120s");
      expect(manifest.permissions.may).toContain("inject verbatim role prompt");
      expect(manifest.permissions.may).toContain("record stagnation defects");

      expect(manifest.permissions.must_not).toContain("file edit");
      expect(manifest.permissions.must_not).toContain("edit files");
      expect(manifest.permissions.must_not).toContain("write repository code");
      expect(manifest.permissions.must_not).toContain("0 code edits");
      expect(manifest.permissions.must_not).toContain("0 test runs");

      expect(manifest.permissions.commands).toContain("mind:audit:live");
      expect(manifest.permissions.commands).toContain("mind:pulse");
      expect(manifest.permissions.commands).toContain("doctor");
      expect(manifest.permissions.commands).toContain("whoami");
      expect(manifest.permissions.spawns).toEqual([]);

      expect(manifest.invariants).toContain("SUPERVISOR_ZERO_CODE_EDITS");
      expect(manifest.invariants).toContain("ANTI_STAGNATION_120S_WATCHDOG");
      expect(manifest.invariants).toContain("TIER_0_OUT_OF_BAND_OBSERVER");

      expect(manifest.protocol.cli).toBe("bun ~/.agents/skills/olt/scripts/harness.ts");
      expect(manifest.protocol.zero_json).toBe(true);
    });

    it("passes schema validation", () => {
      const manifest = parseUnifiedAgentManifest(rawYaml, filePath);
      const validation = validateUnifiedAgentManifest(manifest);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toEqual([]);
    });
  });

  describe("skill-auditor.yaml", () => {
    const filePath = join(AGENTS_DIR, "skill-auditor.yaml");
    const rawYaml = readFileSync(filePath, "utf-8");

    it("parses correctly as a Tier 0 out-of-band observer", () => {
      const manifest = parseUnifiedAgentManifest(rawYaml, filePath);

      expect(manifest.name).toBe("skill-auditor");
      expect(manifest.role).toBe("skill-auditor");
      expect(manifest.tier).toBe(0);
      expect(manifest.tools.enable_subagent_tools).toBe(false);
      expect(manifest.tools.enable_write_tools).toBe(false);
      expect(manifest.interface.display_name).toBe("Skill Auditor");
      expect(manifest.interface.short_description).toBe(
        "Tier 0 Out-of-Band Skill Compliance & Telemetry Auditor",
      );

      expect(manifest.permissions.may).toContain("audit delta events against cognitive contracts");
      expect(manifest.permissions.may).toContain("route framework defects upstream");
      expect(manifest.permissions.may).toContain("enforce Brent work/span concurrency");

      expect(manifest.permissions.must_not).toContain("file edit");
      expect(manifest.permissions.must_not).toContain("edit files");
      expect(manifest.permissions.must_not).toContain("write repository code");
      expect(manifest.permissions.must_not).toContain("0 code edits");
      expect(manifest.permissions.must_not).toContain("0 test runs");

      expect(manifest.permissions.commands).toContain("skill:audit:live");
      expect(manifest.permissions.commands).toContain("meta-audit");
      expect(manifest.permissions.commands).toContain("whoami");
      expect(manifest.permissions.spawns).toEqual([]);

      expect(manifest.invariants).toContain("SUPERVISOR_ZERO_CODE_EDITS");
      expect(manifest.invariants).toContain("DELTA_EVENT_FORENSICS");
      expect(manifest.invariants).toContain("SPLIT_CHANNEL_DEFECT_ROUTING");
      expect(manifest.invariants).toContain("TIER_0_OUT_OF_BAND_OBSERVER");

      expect(manifest.protocol.cli).toBe("bun ~/.agents/skills/olt/scripts/harness.ts");
      expect(manifest.protocol.zero_json).toBe(true);
    });

    it("passes schema validation", () => {
      const manifest = parseUnifiedAgentManifest(rawYaml, filePath);
      const validation = validateUnifiedAgentManifest(manifest);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toEqual([]);
    });
  });

  describe("Security and Role Boundaries Invariants", () => {
    it("enforces zero tool authority and zero spawns for all Tier 0 cognitive auditors", () => {
      const files = ["mind-auditor.yaml", "skill-auditor.yaml"];

      for (const file of files) {
        const filePath = join(AGENTS_DIR, file);
        const rawYaml = readFileSync(filePath, "utf-8");
        const manifest = parseUnifiedAgentManifest(rawYaml, filePath);

        expect(manifest.tier).toBe(0);
        expect(manifest.tools.enable_write_tools).toBe(false);
        expect(manifest.tools.enable_subagent_tools).toBe(false);
        expect(manifest.permissions.spawns).toEqual([]);
        expect(manifest.invariants).toContain("SUPERVISOR_ZERO_CODE_EDITS");
        expect(manifest.invariants).toContain("TIER_0_OUT_OF_BAND_OBSERVER");
      }
    });
  });

  describe("Documentation Synchronization (AGENTS.md & SKILL.md)", () => {
    it("verifies AGENTS.md and SKILL.md include Step Machines G, H, I and policy-discovery Tier 0 definition", () => {
      const agentsMd = readFileSync(AGENTS_MD_PATH, "utf-8");
      const skillMd = readFileSync(SKILL_MD_PATH, "utf-8");

      // Step Machine G: Tier 0 Policy Discovery Protocol
      expect(agentsMd).toContain(
        "### G. Tier 0 Policy Discovery & Toolchain Bootstrapping Step-Machine",
      );
      expect(agentsMd).toContain("TIER 0 POLICY DISCOVERY & TOOLCHAIN BOOTSTRAPPING STEP-MACHINE");
      expect(agentsMd).toContain("Tier 0 Policy Discovery");
      expect(skillMd).toContain("Tier 0 Policy Discovery");
      expect(skillMd).toContain("policy:init");

      // Step Machine H: Mandatory Companion Auditors
      expect(agentsMd).toContain(
        "### H. Mandatory Companion Auditor Lifecycle & Doctor Health Check Step-Machine",
      );
      expect(agentsMd).toContain("MANDATORY COMPANION AUDITORS & DOCTOR HEALTH CHECK STEP-MACHINE");
      expect(agentsMd).toContain("Mandatory Companion Auditor");
      expect(skillMd).toContain("Mandatory Companion Auditors");
      expect(skillMd).toContain("mind-auditor");
      expect(skillMd).toContain("skill-auditor");

      // Step Machine I: Live Host-Aware Quota Telemetry
      expect(agentsMd).toContain(
        "### I. Live Host-Aware Quota Telemetry & Circuit-Breaker Step-Machine",
      );
      expect(agentsMd).toContain("LIVE HOST-AWARE QUOTA TELEMETRY & CIRCUIT-BREAKER STEP-MACHINE");
      expect(agentsMd).toContain("Live Host-Aware Quota Telemetry");
      expect(skillMd).toContain("Live Host-Aware Quota Telemetry");
      expect(skillMd).toContain(".olt/telemetry.jsonl");

      // policy-discovery Tier 0 definition
      expect(agentsMd).toContain("policy-discovery");
      expect(agentsMd).toContain(
        "Elevation of Policy Discovery to Tier 0 Autonomous Governance Bootstrapper",
      );
      expect(agentsMd).toContain("| **`policy-discovery`**      |  0   |");
      expect(skillMd).toContain("| `policy-discovery` (0)");
      expect(skillMd).toContain("`policy-discovery` (Tier 0)");
    });
  });
});
