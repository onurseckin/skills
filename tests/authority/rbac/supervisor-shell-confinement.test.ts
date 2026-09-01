import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { loadAgentManifest } from "../../../olt/scripts/src/authority/manifest/index.ts";
import {
  executeShieldedCommand,
  verifyCommandAuthorization,
} from "../../../olt/scripts/src/authority/rbac/index.ts";
import { inferCanExecute } from "../../../olt/scripts/src/authority/session/index.ts";
import { buildDefaultAgents } from "../../../olt/scripts/src/policy/generator/index.ts";
import { cleanupVirtualAuthorityFS, setupVirtualAuthorityFS } from "../fixture.ts";

describe("Supervisor and Validator Shell Confinement & Antigravity Enablement", () => {
  beforeEach(() => {
    setupVirtualAuthorityFS();
  });
  afterEach(() => {
    cleanupVirtualAuthorityFS();
  });

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

  it("ensures default policy configures can_execute_shell: true and can_edit_code: false for supervisors and validators", () => {
    const agents = buildDefaultAgents();
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
      const agent = agents[key];
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
    ];
    for (const role of mutatingRoles) {
      const perms = inferCanExecute(role);
      expect(perms.can_execute_shell).toBe(true);
      expect(perms.can_edit_files).toBe(true);
    }
  });

  it("blocks file modification tools and shell mutation commands under harness RBAC for supervisors and validators", () => {
    const mutatingTools = ["write_to_file", "replace_file_content", "apply_diff", "notebook_edit"];
    for (const tool of mutatingTools) {
      const auth = verifyCommandAuthorization("validator", [tool, "some/path.ts"]);
      expect(auth.authorized).toBe(false);
    }
    const mutatingShells = [
      ["rm", "-rf", "src"],
      ["cp", "a.ts", "b.ts"],
      ["mv", "a.ts", "b.ts"],
      ["git", "checkout", "main"],
      ["git", "reset", "--hard"],
      ["git", "clean", "-fd"],
      ["git", "rebase", "main"],
      ["sed", "-i", "s/a/b/g", "file.ts"],
    ];
    for (const cmd of mutatingShells) {
      const auth = verifyCommandAuthorization("validator", cmd);
      expect(auth.authorized).toBe(false);
    }
  });

  it("blocks test suite invocations under harness RBAC for supervisors and validators", () => {
    const testCommands = [
      ["bun", "test"],
      ["npm", "test"],
      ["pytest"],
      ["cargo", "test"],
      ["vitest"],
    ];
    for (const cmd of testCommands) {
      const auth = verifyCommandAuthorization("validator", cmd);
      expect(auth.authorized).toBe(false);
    }
  });

  it("authorizes read-only inspection commands and harness task commands for supervisors and validators", () => {
    const inspectionCommands = [
      ["git", "status"],
      ["git", "log", "-n", "5"],
      ["git", "diff", "HEAD~1"],
      ["ls", "-la"],
      ["cat", "package.json"],
      ["grep", "-rn", "pattern", "src/"],
      ["find", ".", "-name", "*.ts"],
      ["pwd"],
      ["echo", "hello"],
    ];
    for (const cmd of inspectionCommands) {
      const auth = verifyCommandAuthorization("validator", cmd);
      expect(auth.authorized).toBe(true);
    }
    const harnessCommands = [
      ["bun", "run", "olt/scripts/src/cli/index.ts", "task:check", "1"],
      ["bun", "run", "olt/scripts/src/cli/index.ts", "task:review", "1"],
      ["bun", "run", "olt/scripts/src/cli/index.ts", "task:review:submit", "1"],
      ["bun", "run", "olt/scripts/src/cli/index.ts", "mind:round:close", "1"],
    ];
    for (const cmd of harnessCommands) {
      const auth = verifyCommandAuthorization("validator", cmd);
      expect(auth.authorized).toBe(true);
    }
  });

  it("authorizes read-only inspection commands under shielded shell while blocking mutations", () => {
    const validResult = verifyCommandAuthorization("validator", ["git", "status"]);
    expect(validResult.authorized).toBe(true);

    const blockedResult = verifyCommandAuthorization("validator", [
      "rm",
      "-rf",
      "/virtual/forbidden",
    ]);
    expect(blockedResult.authorized).toBe(false);
    expect(blockedResult.reason).toBe("SUPERVISOR_ZERO_CODE_EDITS");
  });
});
