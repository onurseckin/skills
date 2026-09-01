import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RootDirectoryHygieneGuard } from "../../../olt/scripts/src/authority/guards/root-hygiene.ts";
import {
  acquireAuditorLeaseLock,
  readAuditorLeaseLock,
  releaseAuditorLeaseLock,
} from "../../../olt/scripts/src/authority/guards/singleton-auditor-guard.ts";
import {
  rejectDuplicateAuditorSpawn,
  validateSubagentSpawnRequest,
} from "../../../olt/scripts/src/authority/guards/spawn-validator.ts";
import {
  normalizeRoleKey,
  resolveAgentHostConfiguration,
} from "../../../olt/scripts/src/authority/host-bindings.ts";
import {
  executeShieldedCommand,
  verifyCommandAuthorization,
} from "../../../olt/scripts/src/authority/rbac/command-authorizer.ts";
import { VerbatimRoleInjector } from "../../../olt/scripts/src/authority/verbatim-role-injector.ts";
import { cleanupVirtualAuthorityFS, setupVirtualAuthorityFS } from "../fixture.ts";

describe("Authority Guards, Host Bindings, RBAC Authorizer & Verbatim Injector Comprehensive", () => {
  beforeEach(() => {
    setupVirtualAuthorityFS();
  });
  afterEach(() => {
    cleanupVirtualAuthorityFS();
  });

  test("RootDirectoryHygieneGuard blocks loose root files and runtime files in static package", () => {
    const sandbox = "/virtual/guards-rbac/hygiene";
    expect(() =>
      RootDirectoryHygieneGuard.assertAllowedWritePath(sandbox, "package.json"),
    ).not.toThrow();
    expect(() =>
      RootDirectoryHygieneGuard.assertAllowedWritePath(sandbox, "loose-temp-script.ts"),
    ).toThrow(/ROOT_HYGIENE_VIOLATION/);

    expect(() =>
      RootDirectoryHygieneGuard.assertAllowedWritePath(sandbox, "src/app.ts"),
    ).not.toThrow();
    expect(() =>
      RootDirectoryHygieneGuard.assertAllowedWritePath(sandbox, "random_loose_dir/file.txt"),
    ).toThrow(/ROOT_HYGIENE_VIOLATION/);

    expect(() =>
      RootDirectoryHygieneGuard.assertAllowedWritePath(sandbox, "olt/events.jsonl"),
    ).toThrow(/Cannot write runtime file/);
    expect(() =>
      RootDirectoryHygieneGuard.assertAllowedWritePath(sandbox, "olt/coverage/lcov.info"),
    ).toThrow(/Cannot write runtime file/);
  });

  test("Singleton Auditor Guard lease acquisition, renewal, and cleanup lifecycle", () => {
    const sandbox = "/virtual/guards-rbac/auditor";
    mkdirSync(join(sandbox, ".olt", "locks"), { recursive: true });
    const lockPath = join(sandbox, ".olt", "locks", "skill_auditor.lock");

    expect(readAuditorLeaseLock(lockPath)).toBeNull();

    const lease = acquireAuditorLeaseLock({
      customLockPath: lockPath,
      auditor_id: "auditor-1",
      pid: process.pid,
      leaseDurationMs: 60_000,
    });
    expect(lease.auditor_id).toBe("auditor-1");
    expect(lease.pid).toBe(process.pid);

    expect(() =>
      acquireAuditorLeaseLock({
        customLockPath: lockPath,
        auditor_id: "auditor-2",
        pid: process.pid + 1,
        isPidAliveFn: () => true,
      }),
    ).toThrow(/SINGLETON_AUDITOR_COLLISION/);

    const renewed = acquireAuditorLeaseLock({
      customLockPath: lockPath,
      auditor_id: "auditor-1",
      pid: process.pid,
      leaseDurationMs: 120_000,
    });
    expect(renewed.auditor_id).toBe("auditor-1");

    const released = releaseAuditorLeaseLock({ customLockPath: lockPath, auditor_id: "auditor-1" });
    expect(released).toBe(true);
    expect(readAuditorLeaseLock(lockPath)).toBeNull();
  });

  test("Spawn Validator rejects duplicate active auditor spawns", () => {
    const sandbox = "/virtual/guards-rbac/spawn";
    const lockPath = join(sandbox, "auditor.lock");

    expect(validateSubagentSpawnRequest({ role: "implementer" }).allowed).toBe(true);

    const activeLease = {
      auditor_id: "skill_auditor",
      pid: process.pid,
      acquired_at: new Date().toISOString(),
      lock_token: "tok_test_lock",
      host_type: "antigravity",
      lease_acquired_at: new Date().toISOString(),
      lease_expires_at: new Date(Date.now() + 100_000).toISOString(),
      conversation_id: "conv-1",
    };

    const res = validateSubagentSpawnRequest(
      { role: "skill_auditor" },
      {
        customLockPath: lockPath,
        activeLeaseReader: () => activeLease,
        isPidAliveFn: () => true,
        now: Date.now(),
      },
    );
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain("DUPLICATE_SINGLETON_AUDITOR_ERROR");

    expect(() =>
      rejectDuplicateAuditorSpawn(
        { role: "skill_auditor" },
        {
          customLockPath: lockPath,
          activeLeaseReader: () => activeLease,
          isPidAliveFn: () => true,
          now: Date.now(),
        },
      ),
    ).toThrow(/DUPLICATE_SINGLETON_AUDITOR_ERROR/);
  });

  test("normalizeRoleKey and resolveAgentHostConfiguration", () => {
    expect(normalizeRoleKey("")).toBe("");
    expect(normalizeRoleKey("coordinator")).toBe("coordinator");
    expect(normalizeRoleKey("mind-supervisor")).toBe("mind_supervisor");
    expect(normalizeRoleKey("validator-code-quality")).toBe("validator_code_quality");

    const hostConfig = resolveAgentHostConfiguration("coordinator", "claude_code");
    expect(hostConfig).toBeDefined();
    expect(hostConfig.thinking_effort).toBeDefined();

    expect(() => resolveAgentHostConfiguration("")).toThrow("Role name must be a non-empty string");
    expect(() => resolveAgentHostConfiguration("non-existent-role-xyz")).toThrow(
      "Cannot resolve agent role",
    );
  });

  test("VerbatimRoleInjector buildSupervisoryPrompt, buildImplementerPrompt, buildValidatorPrompt", () => {
    const sandbox = "/virtual/guards-rbac/verbatim";
    const agentsDir = join(sandbox, "agents");
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, "mind.yaml"), "name: mind\nrole: mind\ntier: 0\n", "utf-8");
    writeFileSync(
      join(agentsDir, "coordinator.yaml"),
      "name: coordinator\nrole: coordinator\ntier: 2\n",
      "utf-8",
    );
    writeFileSync(
      join(agentsDir, "implementer.yaml"),
      "name: implementer\nrole: implementer\ntier: 3\n",
      "utf-8",
    );

    const promptModeA = VerbatimRoleInjector.buildInjectionPrompt(sandbox, "mind", {
      role: "mind",
      agentId: "mind_1",
      idleDurationSeconds: 150,
      pendingBacklogCount: 0,
      pendingPlanCount: 0,
      unresolvedDefectCount: 0,
    });
    expect(promptModeA).toContain("MODE A: AUTONOMOUS SELF-EVOLUTION MANDATE");

    const promptModeB = VerbatimRoleInjector.buildInjectionPrompt(sandbox, "mind", {
      role: "mind",
      agentId: "mind_1",
      idleDurationSeconds: 150,
      pendingBacklogCount: 5,
      pendingPlanCount: 0,
      unresolvedDefectCount: 0,
    });
    expect(promptModeB).toContain("MODE B: ACTIVE INTAKE & WORK/SPAN SCALING MANDATE");

    const mindInit = VerbatimRoleInjector.buildMindInitializationPrompt(sandbox, {
      mindId: "mind_1",
      generation: 1,
    });
    expect(mindInit).toContain("MIND_INITIALIZATION_VERBATIM_MANIFEST_INJECTION");

    const coordInit = VerbatimRoleInjector.buildInitializationPrompt(sandbox, "coordinator", {
      agentId: "coordinator_1",
    });
    expect(coordInit).toContain("SUPERVISORY ROLE INITIALIZATION: COORDINATOR");

    const sysPrompt = VerbatimRoleInjector.buildSubagentSystemPrompt(sandbox, "implementer", {
      customInstructions: "Work carefully",
    });
    expect(sysPrompt).toContain("SUBAGENT_VERBATIM_SYSTEM_PROMPT: IMPLEMENTER");
    expect(sysPrompt).toContain("Work carefully");

    const dispatchPrompt = VerbatimRoleInjector.buildSubagentDispatchPrompt(
      sandbox,
      "implementer",
      "Implement feature A",
      {
        agentId: "implementer_task-1",
        taskId: "task-1",
        writeScope: ["src/a.ts"],
      },
    );
    expect(dispatchPrompt).toContain("SUBAGENT_DISPATCH_MANDATE: IMPLEMENTER");
    expect(dispatchPrompt).toContain("src/a.ts");
  });

  test("RBAC command authorizer verifyCommandAuthorization and executeShieldedCommand", async () => {
    expect(verifyCommandAuthorization("coordinator", []).authorized).toBe(false);
    expect(verifyCommandAuthorization("coordinator", ["bun", "test"]).authorized).toBe(false);
    expect(verifyCommandAuthorization("coordinator", ["git", "checkout", "main"]).authorized).toBe(
      false,
    );
    expect(verifyCommandAuthorization("coordinator", ["rm", "-rf", "src"]).authorized).toBe(false);

    expect(
      verifyCommandAuthorization("implementer", ["bun", "test", "tests/authority/rbac/a.test.ts"])
        .authorized,
    ).toBe(true);

    const execRes = await executeShieldedCommand("implementer-1", [
      process.execPath,
      "-e",
      "console.log('hello')",
    ]);
    expect(execRes.authorized).toBe(true);
    expect(execRes.success).toBe(true);
    expect(execRes.stdout.trim()).toBe("hello");

    const deniedExec = await executeShieldedCommand("coordinator-1", ["bun", "test"]);
    expect(deniedExec.authorized).toBe(false);
    expect(deniedExec.success).toBe(false);
  });
});
