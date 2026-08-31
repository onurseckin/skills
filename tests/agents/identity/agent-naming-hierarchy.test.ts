import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  AGENT_NAMING_STANDARDS,
  agentIdToRole,
  agentIdToTier,
  isStandardAgentId,
  parseStandardAgentId,
  recommendStandardAgentId,
  roleToTier,
  validateAgentNamingConvention,
  type StandardAgentRole,
} from "../../../olt/scripts/src/authority/thread/index.ts";
import { identifyExecutionContext } from "../../../olt/scripts/src/authority/thread/index.ts";
import {
  findSkillRoot,
  loadAgentManifest,
  loadRoleContract,
} from "../../../olt/scripts/src/authority/manifest/index.ts";
import { whoamiCommand } from "../../../olt/scripts/src/cli/commands/whoami.ts";

describe("Agent Naming - Hierarchy & Manifests", () => {
  describe("End-to-End Skill Manifests & Role Contracts Standardization Audit", () => {
    test("every yaml file in olt/agents matches standard naming conventions", () => {
      const skillRoot = findSkillRoot();
      const agentsDir = join(skillRoot, "agents");
      const agentFiles = readdirSync(agentsDir)
        .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
        .filter(
          (f) =>
            !["antigravity", "claude", "codex", "cursor", "generic", "openai"].includes(
              f.replace(/\.ya?ml$/, ""),
            ),
        );

      expect(agentFiles.length).toBeGreaterThanOrEqual(13);

      for (const file of agentFiles) {
        const roleName = file.replace(/\.ya?ml$/, "");
        const manifest = loadAgentManifest(roleName);

        expect(manifest.name).toBe(roleName);
        expect([0, 1, 2, 3, "independent"]).toContain(manifest.tier);

        // If manifest has protocol instructions, verify it references standardized naming
        if (manifest.protocol?.instructions) {
          expect(manifest.protocol.instructions.length).toBeGreaterThan(0);
        }
      }
    });

    test("every unified agent manifest in olt/agents matches standard role contracts", () => {
      const skillRoot = findSkillRoot();
      const agentsDir = join(skillRoot, "agents");
      const agentFiles = readdirSync(agentsDir)
        .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
        .filter(
          (f) =>
            !["antigravity", "claude", "codex", "cursor", "generic", "openai"].includes(
              f.replace(/\.ya?ml$/, ""),
            ),
        );

      expect(agentFiles.length).toBeGreaterThanOrEqual(13);

      for (const file of agentFiles) {
        const roleName = file.replace(/\.ya?ml$/, "");
        const contract = loadRoleContract(roleName);

        expect([0, 1, 2, 3, "independent"]).toContain(contract.tier);
        expect(contract.may.length).toBeGreaterThan(0);
        expect(contract.mustNot.length).toBeGreaterThan(0);
      }
    });

    test("whoamiCommand and identifyExecutionContext seamlessly integrate with standardized agent IDs", () => {
      const testCases: Array<{
        agentId: string;
        expectedTier: ExecutionTier;
        expectedRole: string;
      }> = [
        { agentId: "mind_pulse-gen-1", expectedTier: 0, expectedRole: "mind" },
        { agentId: "orchestrator_wave-1", expectedTier: 1, expectedRole: "orchestrator" },
        { agentId: "mind-auditor_audit-1", expectedTier: 1, expectedRole: "mind-auditor" },
        { agentId: "coordinator_domain-cli", expectedTier: 2, expectedRole: "coordinator" },
        { agentId: "implementer_task-p54-naming", expectedTier: 3, expectedRole: "implementer" },
        { agentId: "validator_task-p54-naming", expectedTier: 3, expectedRole: "validator" },
        { agentId: "repairer_task-1-fix", expectedTier: 3, expectedRole: "repairer" },
        {
          agentId: "validator-code-quality_task-p54",
          expectedTier: 3,
          expectedRole: "validator-code-quality",
        },
        { agentId: "sub-implementer_subtask-1", expectedTier: 3, expectedRole: "sub-implementer" },
      ];

      for (const tc of testCases) {
        const ctx = identifyExecutionContext({ agentId: tc.agentId });
        expect(ctx.tier).toBe(tc.expectedTier);
        expect(ctx.role).toBe(tc.expectedRole);
        expect(ctx.agent_id).toBe(tc.agentId);

        const whoami = whoamiCommand({ agent: tc.agentId, pid: "1234", ppid: "1" });
        expect(whoami.tier).toBe(tc.expectedTier);
        expect(whoami.agent_id).toBe(tc.agentId);
      }
    });
  });

  describe("Invariants & TypeScript Strictness Audit", () => {
    test("zero TypeScript any and zero suppressions across thread-identifier files", () => {
      const sourceFiles = [
        join(__dirname, "../../../olt/scripts/src/authority/thread/index.ts"),
        join(__dirname, "../../../olt/scripts/src/authority/thread/naming.ts"),
        __filename,
      ];

      const anyAnnotation = new RegExp(":\\s*any\\b");
      const anyCast = new RegExp("as\\s+any\\b");
      const anyGeneric = new RegExp("<\\s*any\\s*>");
      const tsIgnore = "@" + "ts-ignore";
      const tsExpectError = "@" + "ts-expect-error";
      const tsNoCheck = "@" + "ts-nocheck";
      const lintSuppressionA = "es" + "lint-disable";
      const lintSuppressionB = "ox" + "lint-disable";

      for (const filePath of sourceFiles) {
        const content = readFileSync(filePath, "utf8");

        expect(content).not.toMatch(anyAnnotation);
        expect(content).not.toMatch(anyCast);
        expect(content).not.toMatch(anyGeneric);
        expect(content.includes(tsIgnore)).toBe(false);
        expect(content.includes(tsExpectError)).toBe(false);
        expect(content.includes(tsNoCheck)).toBe(false);
        expect(content.includes(lintSuppressionA)).toBe(false);
        expect(content.includes(lintSuppressionB)).toBe(false);
      }
    });
  });
});
