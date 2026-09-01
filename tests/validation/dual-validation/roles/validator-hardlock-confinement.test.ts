import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { findCommand } from "../../../../olt/scripts/src/cli/registry/index.ts";
import type { CommandSpec } from "../../../../olt/scripts/src/cli/registry/types.ts";
import type { Flags } from "../../../../olt/scripts/src/cli/options.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  isCognitiveValidatorRole,
  isMechanicValidatorRole,
  isExecutionCommand,
  isExecutionToolCategory,
  isProhibitedCognitiveTool,
  validateHierarchicalSpawning,
  assertHierarchicalSpawning,
  assertCognitiveValidatorHardlock,
  assertRoleMayInvoke,
  assertGrantedCommand,
} from "../../../../olt/scripts/src/packets/command-authority.ts";
import {
  auditSingleRole,
  createRoleBoundaryWatchdog,
  validateParentChildSupervision,
  assertParentChildBoundary,
  type RoleBoundaryAction,
} from "../../../../olt/scripts/src/mind/auditing/roles/index.ts";
import {
  isBoundaryLeakViolation,
  validateBoundaryIntegrity,
  assertNoBoundaryLeak,
  type BoundaryLeakCheck,
} from "../../../../olt/scripts/src/validation/anti-leak/index.ts";
import { transact } from "../../../../olt/scripts/src/engine/store/index.ts";
import { emptyGrantRun } from "../../../packets/validation/grants/grant-run-fixture.ts";
import type { DynamicRoleSpec } from "../../../../olt/scripts/src/mind/roles/dynamic/index.ts";

function spec(invocation: string): CommandSpec {
  const found = findCommand(invocation);
  if (!found) throw new Error(`Registry has no command named ${invocation}`);
  return found;
}

describe("Validator Hard-Lock - Confinement & Static Invariants", () => {
  describe("2. Cognitive Validator Hard-Lock Interlock", () => {
    const cognitiveValidatorRoles = [
      "validator",
      "ui-validator",
      "validator-code-quality",
      "validator-ui-design",
      "validator-security",
      "validator-product",
      "validator-system-design",
    ] as const;

    const mechanicValidatorRoles = [
      "mechanic-validator",
      "ui-mechanic-validator",
      "mechanic_validator",
    ] as const;

    it("correctly differentiates cognitive validators from mechanic validators", () => {
      for (const role of cognitiveValidatorRoles) {
        expect(isCognitiveValidatorRole(role)).toBe(true);
        expect(isMechanicValidatorRole(role)).toBe(false);
      }
      for (const role of mechanicValidatorRoles) {
        expect(isMechanicValidatorRole(role)).toBe(true);
        expect(isCognitiveValidatorRole(role)).toBe(false);
      }
    });

    it("prohibits cognitive validators from invoking run:exec via assertRoleMayInvoke", () => {
      const execSpec = spec("run:exec");
      expect(isExecutionCommand(execSpec)).toBe(true);
      for (const role of cognitiveValidatorRoles) {
        expect(() => assertRoleMayInvoke(role, execSpec, `${role}-agent`)).toThrow(
          "cognitive validators are strictly banned from executing bash/shell commands or running test suites",
        );
      }
      expect(() =>
        assertRoleMayInvoke("mechanic-validator", execSpec, "mechanic-validator-agent"),
      ).not.toThrow();
    });

    it("enforces Cognitive Validator Hard-Lock via assertCognitiveValidatorHardlock helper", () => {
      expect(() => assertCognitiveValidatorHardlock("validator", "run:exec", "val-1")).toThrow(
        "Cognitive Validator Hard-Lock Interlock",
      );
      expect(() => assertCognitiveValidatorHardlock("ui-validator", "shell", "ui-val-1")).toThrow(
        "Cognitive Validator Hard-Lock Interlock",
      );
      expect(() =>
        assertCognitiveValidatorHardlock("validator-security", "test-runner", "sec-val"),
      ).toThrow("Cognitive Validator Hard-Lock Interlock");
      expect(() =>
        assertCognitiveValidatorHardlock("validator-code-quality", "run_command", "cq-val"),
      ).toThrow("Cognitive Validator Hard-Lock Interlock");

      expect(() =>
        assertCognitiveValidatorHardlock("mechanic-validator", "run:exec", "mech-1"),
      ).not.toThrow();
      expect(() =>
        assertCognitiveValidatorHardlock("ui-mechanic-validator", "test-runner", "ui-mech"),
      ).not.toThrow();
    });

    it("blocks prohibited tool categories and execution tools in assertGrantedCommand", async () => {
      const { run } = await emptyGrantRun("validator-hardlock-tools-");
      transact(run, "test-setup", "grant-validator", {}, (draft) => {
        draft.agents = [
          {
            id: "val-cog-1",
            role: "validator",
            parent_agent_id: null,
            parent_task_id: null,
            host: "claude-code",
            granted_at: new Date().toISOString(),
            status: "active",
          },
          {
            id: "mech-val-1",
            role: "mechanic-validator",
            parent_agent_id: null,
            parent_task_id: null,
            host: "claude-code",
            granted_at: new Date().toISOString(),
            status: "active",
          },
        ];
      });

      const prohibitedCategories = [
        "shell",
        "test-runner",
        "build",
        "package-manager",
        "bash",
        "terminal",
      ];
      for (const cat of prohibitedCategories) {
        expect(isExecutionToolCategory(cat)).toBe(true);
        const flags: Flags = { run, validator: "val-cog-1", "tool-category": cat };
        expect(() =>
          assertGrantedCommand(spec("task:probe"), flags, { actor: "val-cog-1", verified: true }),
        ).toThrow("may not invoke execution tool category");
      }

      const prohibitedTools = ["run_command", "bash", "sh", "test_runner", "bun_test"];
      for (const tool of prohibitedTools) {
        expect(isProhibitedCognitiveTool(tool)).toBe(true);
        const flags: Flags = { run, validator: "val-cog-1", tool };
        expect(() =>
          assertGrantedCommand(spec("task:probe"), flags, { actor: "val-cog-1", verified: true }),
        ).toThrow("may not invoke execution tool");
      }

      const mechFlags: Flags = { run, actor: "mech-val-1", "tool-category": "test-runner" };
      expect(() =>
        assertGrantedCommand(spec("run:exec"), mechFlags, { actor: "mech-val-1", verified: true }),
      ).not.toThrow();
    });

    it("enforces Cognitive Validator Hard-Lock in validation/anti-leak", () => {
      const cogChecks: BoundaryLeakCheck[] = [
        { agent_id: "validator-1", role: "validator", action: "run:exec", task_id: "task-1" },
        {
          agent_id: "ui-validator-1",
          role: "ui-validator",
          action: "bun test tests/validation/auth.test.ts",
          task_id: "task-2",
        },
        {
          agent_id: "val-security",
          role: "validator-security",
          action: "task:probe",
          metadata: { tool_category: "shell" },
          task_id: "task-3",
        },
      ];

      for (const check of cogChecks) {
        expect(isBoundaryLeakViolation(check)).toBe(true);
        const res = validateBoundaryIntegrity(check);
        expect(res.valid).toBe(false);
        expect(res.violations.length).toBeGreaterThan(0);
        expect(res.violations[0]?.violation_type).toBe("validator_hardlock_violation");
        expect(res.violations[0]?.severity).toBe("critical");
        expect(res.violations[0]?.observation).toContain("Cognitive Validator Hard-Lock Violation");
        expect(() => assertNoBoundaryLeak(check)).toThrow(HarnessError);
      }

      const mechCheck: BoundaryLeakCheck = {
        agent_id: "mechanic-val-1",
        role: "mechanic-validator",
        action: "bun test tests/validation/auth.test.ts",
        task_id: "task-1",
      };
      expect(isBoundaryLeakViolation(mechCheck)).toBe(false);
      expect(validateBoundaryIntegrity(mechCheck).valid).toBe(true);
      expect(() => assertNoBoundaryLeak(mechCheck)).not.toThrow();
    });

    it("enforces Cognitive Validator Hard-Lock in RoleBoundaryWatchdog", () => {
      const watchdog = createRoleBoundaryWatchdog();

      const cogAction: RoleBoundaryAction = {
        agentId: "val-cog-1",
        role: "validator",
        actionType: "test_run",
        argv: ["bun", "test", "tests/validation/example.test.ts"],
      };

      const violation = watchdog.auditAction(cogAction);
      expect(violation).not.toBeNull();
      expect(violation?.invariant).toBe("validator_hardlock");
      expect(violation?.violationType).toBe("validator_hardlock_violation");
      expect(violation?.severity).toBe("CRITICAL");
      expect(violation?.observation).toContain("Cognitive Validator Hard-Lock Violation");

      const mechAction: RoleBoundaryAction = {
        agentId: "mech-val-1",
        role: "mechanic-validator",
        actionType: "command_exec",
        argv: ["bun", "test", "tests/validation/example.test.ts"],
      };
      expect(watchdog.auditAction(mechAction)).toBeNull();
    });
  });

  describe("3. Static Code Invariant Verification: Zero TypeScript any & Zero Suppressions", () => {
    const filesToAudit = [
      "olt/scripts/src/mind/auditing/roles/index.ts",
      "olt/scripts/src/packets/command-authority.ts",
      "olt/scripts/src/validation/anti-leak/index.ts",
    ];

    it("verifies zero TypeScript any and zero compiler/linter suppressions across touched files", () => {
      const anyTypeRegex = new RegExp(":\\s*any\\b|as\\s+any\\b|<any>|Record<string,\\s*any>");
      const suppressionRegex = new RegExp(
        [
          "@ts" + "-ignore",
          "@ts" + "-expect-error",
          "@ts" + "-nocheck",
          "eslint" + "-disable",
          "oxlint" + "-disable",
          "biome" + "-ignore",
        ].join("|"),
      );

      for (const relativePath of filesToAudit) {
        const content = readFileSync(relativePath, "utf8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (line.includes("anyTypeRegex") || line.includes("suppressionRegex")) continue;

          expect(anyTypeRegex.test(line)).toBe(false);
          expect(suppressionRegex.test(line)).toBe(false);
        }
      }
    });
  });
});
