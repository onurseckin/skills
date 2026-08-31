import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadAgentManifest } from "../../olt/scripts/src/authority/manifest/index.ts";
import {
  executeShieldedCommand,
  verifyCommandAuthorization,
} from "../../olt/scripts/src/authority/rbac/index.ts";
import { inferCanExecute } from "../../olt/scripts/src/authority/session/index.ts";
import { buildDefaultAgents } from "../../olt/scripts/src/policy/generator/index.ts";
import type { RepoPolicy } from "../../olt/scripts/src/policy/types/index.ts";

describe("Supervisor and Validator Shell Confinement & Antigravity Enablement", () => {
  it("enables write tools on all supervisory, critic, and validator manifests for host run_command binding", () => {
    const manifests = [
      "mind",
      "mind-auditor",
      "skill-auditor",
      "orchestrator",
      "coordinator",
      "planner",
      "independent-planner",
      "independent-planner-audit",
      "critic",
      "completeness-critic",
      "plan-validator",
      "sub-validator",
      "validator",
      "ui-validator",
      "mechanic-validator",
      "ui-mechanic-validator",
      "sub-investigator",
    ];

    for (const name of manifests) {
      const manifest = loadAgentManifest(name);
      expect(manifest.tools?.enable_write_tools).toBe(true);
    }
  });

  it("configures can_execute_shell: true and can_edit_code: false in default agents generator", () => {
    const agents = buildDefaultAgents();

    const supervisoryKeys = [
      "mind_supervisor",
      "mind_auditor",
      "skill_auditor",
      "autonomic_watchdog",
      "orchestrator",
      "coordinator",
      "completeness_critic",
      "validator_code_quality",
      "validator_ui_design",
      "validator_security",
      "validator_system_design",
      "validator_product",
    ];

    for (const key of supervisoryKeys) {
      const agent = agents[key];
      expect(agent).toBeDefined();
      expect(agent?.rbac?.can_execute_shell).toBe(true);
      expect(agent?.rbac?.can_edit_code).toBe(false);
    }

    expect(agents.implementer?.rbac?.can_execute_shell).toBe(true);
    expect(agents.implementer?.rbac?.can_edit_code).toBe(true);
    expect(agents.owner?.rbac?.can_execute_shell).toBe(true);
    expect(agents.owner?.rbac?.can_edit_code).toBe(true);
  });

  it("ensures policy.json persists can_execute_shell: true and can_edit_code: false for supervisors and validators", () => {
    const policyPath = join(process.cwd(), "olt", "policy.json");
    const rawPolicy = readFileSync(policyPath, "utf-8");
    const policy = JSON.parse(rawPolicy) as RepoPolicy;

    const supervisoryKeys = [
      "mind_supervisor",
      "orchestrator",
      "coordinator",
      "completeness_critic",
      "validator_code_quality",
      "validator_ui_design",
      "validator_security",
      "validator_system_design",
      "validator_product",
      "autonomic_watchdog",
    ];

    for (const key of supervisoryKeys) {
      const agent = policy.agents?.[key];
      expect(agent).toBeDefined();
      expect(agent?.rbac?.can_execute_shell).toBe(true);
      expect(agent?.rbac?.can_edit_code).toBe(false);
    }
  });

  it("infers can_execute_shell: true and can_edit_files: false for all supervisory and validator roles in session IO", () => {
    const nonMutatingRoles = [
      "mind",
      "mind_supervisor",
      "mind-supervisor",
      "mind_auditor",
      "mind-auditor",
      "skill_auditor",
      "skill-auditor",
      "orchestrator",
      "coordinator",
      "autonomic_watchdog",
      "autonomic-watchdog",
      "planner",
      "independent-planner",
      "validator",
      "cognitive-validator",
      "cognitive_validator",
      "validator-code-quality",
      "critic",
      "completeness-critic",
      "completeness_critic",
      "plan-validator",
      "plan_validator",
      "sub-validator",
      "sub-investigator",
      "ui-validator",
      "mechanic-validator",
    ];

    for (const role of nonMutatingRoles) {
      const perms = inferCanExecute(role);
      expect(perms.can_execute_shell).toBe(true);
      expect(perms.can_edit_files).toBe(false);
    }

    const mutatingRoles = [
      "implementer",
      "worker",
      "repairer",
      "owner",
      "sub-implementer",
      "sub_implementer",
      "sub-task-worker",
      "sub_task_worker",
      "implementer-core",
      "implementer_sub",
    ];

    for (const role of mutatingRoles) {
      const perms = inferCanExecute(role);
      expect(perms.can_execute_shell).toBe(true);
      expect(perms.can_edit_files).toBe(true);
    }
  });

  it("blocks file modification tools and shell mutation commands under harness RBAC for supervisors and validators", () => {
    const nonMutatingRoles = [
      "mind",
      "orchestrator",
      "coordinator",
      "mind-auditor",
      "skill-auditor",
      "validator",
      "critic",
      "completeness-critic",
      "ui-validator",
      "plan-validator",
    ];

    const fileMutationInvocations: readonly string[][] = [
      ["write_to_file", "src/auth.ts"],
      ["replace_file_content", "src/core.ts"],
      ["edit_file", "src/index.ts"],
      ["apply_diff", "diff.patch"],
      ["create_file", "new.ts"],
      ["delete_file", "old.ts"],
      ["Write", "app.ts"],
      ["Edit", "app.ts"],
      ["NotebookEdit", "nb.ipynb"],
      ["touch", "foo.txt"],
      ["truncate", "-s", "0", "bar.txt"],
      ["rm", "-rf", "dist"],
      ["mv", "a.ts", "b.ts"],
      ["cp", "a.ts", "b.ts"],
      ["mkdir", "-p", "newdir"],
      ["sed", "-i", "s/old/new/g", "foo.txt"],
      ["patch", "-p1", "<", "fix.patch"],
    ];

    for (const role of nonMutatingRoles) {
      for (const cmd of fileMutationInvocations) {
        const res = verifyCommandAuthorization(role, cmd);
        expect(res.authorized).toBe(false);
        expect(
          res.reason === "SUPERVISOR_ZERO_CODE_EDITS" || res.reason === "ROLE_BOUNDARY_DEVIATION",
        ).toBe(true);
      }
    }
  });

  it("blocks test suite invocations under harness RBAC for supervisors and validators", () => {
    const testRestrictedRoles = [
      "mind",
      "orchestrator",
      "coordinator",
      "mind-auditor",
      "skill-auditor",
      "validator",
      "critic",
      "completeness-critic",
      "ui-validator",
      "plan-validator",
    ];

    const testInvocations: readonly string[][] = [
      ["bun", "test"],
      ["bun", "test", "tests/unit/app.test.ts"],
      ["npm", "test"],
      ["vitest"],
      ["jest"],
      ["pytest"],
      ["cargo", "test"],
    ];

    for (const role of testRestrictedRoles) {
      for (const cmd of testInvocations) {
        const res = verifyCommandAuthorization(role, cmd);
        expect(res.authorized).toBe(false);
        expect(
          res.reason === "SUPERVISOR_ZERO_TEST_RUNS" ||
            res.reason === "WHOLE_SUITE_TEST_RUN_DENIED",
        ).toBe(true);
      }
    }
  });

  it("authorizes read-only inspection commands and harness task commands for supervisors and validators", () => {
    const activeRoles = [
      "mind",
      "orchestrator",
      "coordinator",
      "mind-auditor",
      "skill-auditor",
      "validator",
      "critic",
      "completeness-critic",
      "ui-validator",
      "plan-validator",
    ];

    const allowedInvocations: readonly string[][] = [
      ["git", "status"],
      ["git", "diff"],
      ["git", "diff", "--stat"],
      ["git", "log", "-n", "5"],
      ["ls", "-la"],
      ["cat", "package.json"],
      ["grep", "-rn", "export", "src"],
      ["find", "src", "-name", "*.ts"],
      ["bun", "harness.ts", "task:check", "--run", "run-1"],
      ["bun", "harness.ts", "task:probe", "--run", "run-1"],
      ["node", "-e", "console.log(process.version)"],
    ];

    for (const role of activeRoles) {
      for (const cmd of allowedInvocations) {
        const res = verifyCommandAuthorization(role, cmd);
        expect(res.authorized).toBe(true);
        expect(res.reason).toBeUndefined();
      }
    }
  });

  it("executes permitted CLI commands under shielded shell while blocking mutations", async () => {
    const allowed = await executeShieldedCommand(
      "val-1",
      ["node", "-e", "console.log('val-allowed')"],
      {
        actorRole: "validator",
      },
    );
    expect(allowed.authorized).toBe(true);
    expect(allowed.success).toBe(true);
    expect(allowed.stdout).toContain("val-allowed");

    const blocked = await executeShieldedCommand("val-1", ["rm", "test.ts"], {
      actorRole: "validator",
    });
    expect(blocked.authorized).toBe(false);
    expect(blocked.success).toBe(false);
    expect(blocked.reason).toBe("SUPERVISOR_ZERO_CODE_EDITS");
  });
});
