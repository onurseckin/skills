import { describe, expect, it, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import {
  isCognitiveValidatorRole,
  isMechanicValidatorRole,
  isExecutionCommand,
  isExecutionToolCategory,
  assertRoleMayInvoke,
  assertGrantedCommand,
} from "../../../../olt/scripts/src/packets/command-authority.ts";
import { findCommand } from "../../../../olt/scripts/src/cli/registry/index.ts";
import type { Flags } from "../../../../olt/scripts/src/cli/options.ts";
import type { CommandSpec } from "../../../../olt/scripts/src/cli/registry/types.ts";
import { evidenceSchema } from "../../../../olt/scripts/src/packets/evidence-schema.ts";
import {
  validateAgentNamingConvention,
  parseStandardAgentId,
  recommendStandardAgentId,
  agentIdToRole,
  agentIdToTier,
  roleToTier,
  AGENT_NAMING_STANDARDS,
} from "../../../../olt/scripts/src/authority/thread/index.ts";
import {
  loadAgentManifest,
  loadRoleContract,
  loadUnifiedAgentModel,
} from "../../../../olt/scripts/src/authority/manifest/index.ts";
import {
  SUPERFICIAL_PATTERNS,
  rejectSuperficialClaims,
  detectDomainBatching,
  auditTaskVerificationEvidence,
  createPushbackHistory,
  appendPushbackRound,
} from "../../../../olt/scripts/src/authority/review/index.ts";
import { findCycles, breakCycles } from "../../../../olt/scripts/src/graph/dag-forensics.ts";
import {
  CANONICAL_VIEWPORTS,
  DEFAULT_PRESETS,
} from "../../../../olt/scripts/src/capture/config/default-presets.ts";
import { createSyntheticPngBuffer } from "../../../../olt/scripts/src/capture/runners/live-capture-runner/index.ts";
import { transact } from "../../../../olt/scripts/src/engine/store/index.ts";
import { emptyGrantRun } from "../../packets/grant-run-fixture.ts";

function spec(invocation: string): CommandSpec {
  const found = findCommand(invocation);
  if (!found) throw new Error(`The registry has no command named ${invocation}`);
  return found;
}


describe("Validator Specialization - Split Architecture & Model", () => {
  describe("3. UI Validator Split Architecture (ui-mechanic-validator vs ui-validator)", () => {
    describe("Taxonomy and Naming Conventions", () => {
      it("recognizes ui-mechanic-validator and ui-validator in AGENT_NAMING_STANDARDS", () => {
        expect(AGENT_NAMING_STANDARDS["ui-mechanic-validator"]).toBeDefined();
        expect(AGENT_NAMING_STANDARDS["ui-mechanic-validator"]!.tier).toBe(3);
        expect(AGENT_NAMING_STANDARDS["ui-mechanic-validator"]!.bindingType).toBe("task");

        expect(AGENT_NAMING_STANDARDS["ui-validator"]).toBeDefined();
        expect(AGENT_NAMING_STANDARDS["ui-validator"]!.tier).toBe(3);
        expect(AGENT_NAMING_STANDARDS["ui-validator"]!.bindingType).toBe("task");

        expect(AGENT_NAMING_STANDARDS["mechanic-validator"]).toBeDefined();
        expect(AGENT_NAMING_STANDARDS["mechanic-validator"]!.tier).toBe(3);
      });

      it("validates naming convention for ui-mechanic-validator and ui-validator identifiers", () => {
        const mechRes = validateAgentNamingConvention(
          "ui-mechanic-validator_task-p48-viewport-matrix",
        );
        expect(mechRes.valid).toBe(true);
        expect(mechRes.role).toBe("ui-mechanic-validator");
        expect(mechRes.tier).toBe(3);
        expect(mechRes.parsedComponents?.taskId).toBe("task-p48");
        expect(mechRes.parsedComponents?.taskSlug).toBe("viewport-matrix");

        const cogRes = validateAgentNamingConvention("ui-validator_task-p48-viewport-matrix");
        expect(cogRes.valid).toBe(true);
        expect(cogRes.role).toBe("ui-validator");
        expect(cogRes.tier).toBe(3);
        expect(cogRes.parsedComponents?.taskId).toBe("task-p48");
        expect(cogRes.parsedComponents?.taskSlug).toBe("viewport-matrix");
      });

      it("parses standard agent IDs and generates standard recommendations", () => {
        const parsedMech = parseStandardAgentId("ui-mechanic-validator_task-1-dom-metrics");
        expect(parsedMech).not.toBeNull();
        expect(parsedMech?.role).toBe("ui-mechanic-validator");
        expect(parsedMech?.tier).toBe(3);
        expect(parsedMech?.taskId).toBe("task-1");
        expect(parsedMech?.taskSlug).toBe("dom-metrics");

        const parsedCog = parseStandardAgentId("ui-validator_task-1-visual-critique");
        expect(parsedCog).not.toBeNull();
        expect(parsedCog?.role).toBe("ui-validator");
        expect(parsedCog?.tier).toBe(3);
        expect(parsedCog?.taskId).toBe("task-1");
        expect(parsedCog?.taskSlug).toBe("visual-critique");

        expect(
          recommendStandardAgentId("ui-mechanic-validator", "task-p48", "viewport-matrix"),
        ).toBe("ui-mechanic-validator_task-p48-viewport-matrix");
        expect(recommendStandardAgentId("ui-validator", "task-p48", "viewport-matrix")).toBe(
          "ui-validator_task-p48-viewport-matrix",
        );
      });

      it("maps agent IDs to roles and execution tiers", () => {
        expect(agentIdToRole("ui-mechanic-validator_task-p48-matrix")).toBe(
          "ui-mechanic-validator",
        );
        expect(agentIdToRole("ui-validator_task-p48-critique")).toBe("ui-validator");
        expect(agentIdToRole("mechanic-validator_task-p47-watchdog")).toBe("mechanic-validator");

        expect(agentIdToTier("ui-mechanic-validator_task-p48-matrix")).toBe(3);
        expect(agentIdToTier("ui-validator_task-p48-critique")).toBe(3);
        expect(agentIdToTier("mechanic-validator_task-p47-watchdog")).toBe(3);

        expect(roleToTier("ui-mechanic-validator")).toBe(3);
        expect(roleToTier("ui-validator")).toBe(3);
        expect(roleToTier("mechanic-validator")).toBe(3);
      });
    });

    describe("Agent Unified Model Integration (Identity, Contract, Permissions)", () => {
      it("loads valid agent manifests for ui-mechanic-validator and ui-validator", () => {
        const mechId = loadAgentManifest("ui-mechanic-validator");
        expect(mechId.name).toBe("ui-mechanic-validator");
        expect(mechId.tier).toBe(3);
        expect(mechId.interface?.display_name).toBe("UI Mechanic Validator");
        expect(mechId.tools?.enable_write_tools).toBe(true);
        expect(mechId.filePath).toBeDefined();

        const cogId = loadAgentManifest("ui-validator");
        expect(cogId.name).toBe("ui-validator");
        expect(cogId.tier).toBe(3);
        expect(cogId.interface?.display_name).toBe("UI Cognitive Validator");
        expect(cogId.tools?.enable_write_tools).toBe(true);
        expect(cogId.filePath).toBeDefined();
      });

      it("loads valid role definition contracts for ui-mechanic-validator and ui-validator", () => {
        const mechDef = loadRoleContract("ui-mechanic-validator");
        expect(mechDef.tier).toBe(3);
        expect(mechDef.commands.includes("run:exec")).toBe(true);
        expect(mechDef.filePath).toBeDefined();

        const cogDef = loadRoleContract("ui-validator");
        expect(cogDef.tier).toBe(3);
        expect(cogDef.commands.includes("run:exec")).toBe(false);
        expect(cogDef.filePath).toBeDefined();
      });

      it("validates unified model consistency and synthesizes complete models for ui-mechanic-validator and ui-validator", () => {
        const mechModel = loadUnifiedAgentModel("ui-mechanic-validator");
        expect(mechModel.role).toBe("ui-mechanic-validator");
        expect(mechModel.tier).toBe(3);
        expect(mechModel.manifest).toBeDefined();
        expect(mechModel.contract).toBeDefined();
        expect(mechModel.commands.includes("run:exec")).toBe(true);

        const cogModel = loadUnifiedAgentModel("ui-validator");
        expect(cogModel.role).toBe("ui-validator");
        expect(cogModel.tier).toBe(3);
        expect(cogModel.manifest).toBeDefined();
        expect(cogModel.contract).toBeDefined();
        expect(cogModel.commands.includes("run:exec")).toBe(false);
      });
    });

    describe("Viewport Matrix Presets and Synthetic Evidence Support", () => {
      it("defines the canonical 4-tier Viewport Resolution Matrix", () => {
        expect(CANONICAL_VIEWPORTS["desktop-wide"]).toEqual({
          name: "desktop-wide",
          width: 1920,
          height: 1080,
          deviceScaleFactor: 1,
        });
        expect(CANONICAL_VIEWPORTS.desktop).toEqual({
          name: "desktop",
          width: 1440,
          height: 900,
          deviceScaleFactor: 1,
        });
        expect(CANONICAL_VIEWPORTS.tablet).toEqual({
          name: "tablet",
          width: 768,
          height: 1024,
          deviceScaleFactor: 2,
        });
        expect(CANONICAL_VIEWPORTS.mobile).toEqual({
          name: "mobile",
          width: 390,
          height: 844,
          deviceScaleFactor: 3,
        });

        const fullMatrixPreset = DEFAULT_PRESETS["full-matrix"];
        expect(fullMatrixPreset).toBeDefined();
        expect(fullMatrixPreset!.viewports.length).toBe(4);
      });

      it("generates valid synthetic PNG buffers meeting the 1024-byte minimum evidence floor", () => {
        const png = createSyntheticPngBuffer(100, 100, 2048);
        expect(png.byteLength).toBeGreaterThanOrEqual(2048);
        // Standard PNG signature: 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A
        expect(png[0]).toBe(0x89);
        expect(png[1]).toBe(0x50);
        expect(png[2]).toBe(0x4e);
        expect(png[3]).toBe(0x47);
      });
    });
  });

});
