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
import { emptyGrantRun } from "../../../packets/validation/grants/grant-run-fixture.ts";

function spec(invocation: string): CommandSpec {
  const found = findCommand(invocation);
  if (!found) throw new Error(`The registry has no command named ${invocation}`);
  return found;
}


describe("Validator Specialization - Domains & Command Bans", () => {
  describe("1. Strict Command-Running Ban on Regular & Cognitive Validators", () => {
    const cognitiveRoles = [
      "validator",
      "ui-validator",
      "validator-code-quality",
      "validator-ui-design",
      "validator-security",
      "validator-product",
      "validator-system-design",
    ] as const;

    const nonCognitiveRoles = [
      "mechanic-validator",
      "ui-mechanic-validator",
      "implementer",
      "repairer",
      "coordinator",
      "orchestrator",
      "mind",
    ] as const;

    it("correctly identifies all cognitive validator roles", () => {
      for (const role of cognitiveRoles) {
        expect(isCognitiveValidatorRole(role)).toBe(true);
      }
      for (const role of nonCognitiveRoles) {
        expect(isCognitiveValidatorRole(role)).toBe(false);
      }
    });

    it("prohibits cognitive validators from invoking run:exec via assertRoleMayInvoke", () => {
      const execSpec = spec("run:exec");
      expect(isExecutionCommand(execSpec)).toBe(true);

      const testAgentIds = [
        "validator_task-1",
        "ui-validator_task-1",
        "validator-code-quality_task-1",
        "validator-ui-design_task-1",
        "validator-security_task-1",
        "validator-product_task-1",
        "validator-system-design_task-1",
      ];

      for (const agentId of testAgentIds) {
        expect(() => assertRoleMayInvoke("validator", execSpec, agentId)).toThrow(
          "cognitive validators are strictly banned from executing bash/shell commands or running test suites (run:exec)",
        );
      }
    });

    it("enforces command-running ban on cognitive validators via assertGrantedCommand in active capsule ledger", async () => {
      const { run } = await emptyGrantRun("validator-spec-ban-");
      transact(run, "test-setup", "grant-agents", {}, (draft) => {
        draft.agents = [
          {
            id: "validator_task-1",
            role: "validator",
            parent_agent_id: null,
            parent_task_id: null,
            host: "claude-code",
            granted_at: new Date().toISOString(),
            status: "active",
          },
          {
            id: "ui-validator_task-2",
            role: "validator",
            parent_agent_id: null,
            parent_task_id: null,
            host: "claude-code",
            granted_at: new Date().toISOString(),
            status: "active",
          },
        ];
      });

      const flags1: Flags = { run, actor: "validator_task-1" };
      expect(() =>
        assertGrantedCommand(spec("run:exec"), flags1, {
          actor: "validator_task-1",
          verified: true,
        }),
      ).toThrow(
        "cognitive validators are strictly banned from executing bash/shell commands or running test suites (run:exec)",
      );

      const flags2: Flags = { run, actor: "ui-validator_task-2" };
      expect(() =>
        assertGrantedCommand(spec("run:exec"), flags2, {
          actor: "ui-validator_task-2",
          verified: true,
        }),
      ).toThrow(
        "cognitive validators are strictly banned from executing bash/shell commands or running test suites (run:exec)",
      );
    });

    it("blocks prohibited tool categories (shell, test-runner, build, package-manager) for cognitive validators", async () => {
      const { run } = await emptyGrantRun("validator-spec-toolcat-");
      transact(run, "test-setup", "grant-validator", {}, (draft) => {
        draft.agents = [
          {
            id: "validator_task-1",
            role: "validator",
            parent_agent_id: null,
            parent_task_id: null,
            host: "claude-code",
            granted_at: new Date().toISOString(),
            status: "active",
          },
        ];
      });

      const prohibitedCategories = ["shell", "test-runner", "build", "package-manager"];
      for (const cat of prohibitedCategories) {
        expect(isExecutionToolCategory(cat)).toBe(true);
        const flags: Flags = {
          run,
          validator: "validator_task-1",
          "tool-category": cat,
        };
        expect(() =>
          assertGrantedCommand(spec("task:probe"), flags, {
            actor: "validator_task-1",
            verified: true,
          }),
        ).toThrow("may not invoke execution tool category");
      }
    });

    it("permits authorized non-execution validation commands for cognitive validators", async () => {
      const { run } = await emptyGrantRun("validator-spec-permitted-");
      transact(run, "test-setup", "grant-validator", {}, (draft) => {
        draft.agents = [
          {
            id: "validator_task-1",
            role: "validator",
            parent_agent_id: null,
            parent_task_id: null,
            host: "claude-code",
            granted_at: new Date().toISOString(),
            status: "active",
          },
        ];
      });

      expect(isCognitiveValidatorRole("validator")).toBe(true);

      const permittedCommands = [
        "task:validate-start",
        "task:probe",
        "task:reject",
        "task:review",
        "finding:get",
        "report:get",
        "evidence:get",
      ];

      for (const cmdName of permittedCommands) {
        const cmdSpec = spec(cmdName);
        const flags: Flags = { run, validator: "validator_task-1", agent: "validator_task-1" };
        expect(() =>
          assertGrantedCommand(cmdSpec, flags, {
            actor: "validator_task-1",
            verified: true,
          }),
        ).not.toThrow();
      }
    });
  });

  describe("2. Mechanic Validator Gate Execution & Structured Test Receipts", () => {
    it("correctly identifies mechanic validator roles", () => {
      expect(isMechanicValidatorRole("mechanic-validator")).toBe(true);
      expect(isMechanicValidatorRole("ui-mechanic-validator")).toBe(true);
      expect(isMechanicValidatorRole("mechanic_validator")).toBe(true);

      expect(isMechanicValidatorRole("validator")).toBe(false);
      expect(isMechanicValidatorRole("ui-validator")).toBe(false);
      expect(isMechanicValidatorRole("implementer")).toBe(false);
    });

    it("permits mechanic-validator to invoke run:exec via assertRoleMayInvoke", () => {
      const execSpec = spec("run:exec");
      expect(() =>
        assertRoleMayInvoke("mechanic-validator", execSpec, "mechanic-validator_task-1"),
      ).not.toThrow();
    });

    it("allows mechanic validators to execute gate commands via assertGrantedCommand in active capsule", async () => {
      const { run } = await emptyGrantRun("mechanic-spec-exec-");
      transact(run, "test-setup", "grant-mechanic", {}, (draft) => {
        draft.agents = [
          {
            id: "mechanic-validator_task-1",
            role: "mechanic-validator",
            parent_agent_id: null,
            parent_task_id: null,
            host: "claude-code",
            granted_at: new Date().toISOString(),
            status: "active",
          },
        ];
      });

      const flags: Flags = { run, actor: "mechanic-validator_task-1" };
      expect(() =>
        assertGrantedCommand(spec("run:exec"), flags, {
          actor: "mechanic-validator_task-1",
          verified: true,
        }),
      ).not.toThrow();
    });

    it("validates mechanic-validator evidence schema structure including gate receipts and checks", () => {
      const schema = evidenceSchema("mechanic-validator");
      expect(schema.verdict).toBe("pass|reject");
      expect(Array.isArray(schema.requirement_ids)).toBe(true);
      expect(Array.isArray(schema.checks)).toBe(true);
      expect(Array.isArray(schema.gate_receipts)).toBe(true);
      expect(Array.isArray(schema.findings)).toBe(true);

      const gateReceipts = schema.gate_receipts as ReadonlyArray<Record<string, unknown>>;
      expect(gateReceipts.length).toBeGreaterThan(0);
      const sampleReceipt = gateReceipts[0]!;
      expect(sampleReceipt.gate_id).toBeDefined();
      expect(sampleReceipt.command_id).toBeDefined();
      expect(sampleReceipt.exit_code).toBe(0);
      expect(sampleReceipt.status).toBe("passed|failed");
    });
  });

});
