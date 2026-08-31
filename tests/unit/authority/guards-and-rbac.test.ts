import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RootDirectoryHygieneGuard } from "../../../olt/scripts/src/authority/guards/root-hygiene.ts";
import {
  acquireAuditorLeaseLock,
  assertSingletonSkillAuditor,
  defaultIsPidAlive,
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
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("Authority Guards, Host Bindings, RBAC Authorizer & Verbatim Injector Comprehensive", () => {
  test("RootDirectoryHygieneGuard blocks loose root files and runtime files in static package", () => {
    const scratch = scratchRoot(import.meta.path, "root-hygiene-test");

    // Allowed root file
    expect(() =>
      RootDirectoryHygieneGuard.assertAllowedWritePath(scratch, "package.json"),
    ).not.toThrow();
    // Disallowed loose root file
    expect(() =>
      RootDirectoryHygieneGuard.assertAllowedWritePath(scratch, "loose-temp-script.ts"),
    ).toThrow(/ROOT_HYGIENE_VIOLATION/);

    // Allowed dir
    expect(() =>
      RootDirectoryHygieneGuard.assertAllowedWritePath(scratch, "src/app.ts"),
    ).not.toThrow();
    // Disallowed loose dir
    expect(() =>
      RootDirectoryHygieneGuard.assertAllowedWritePath(scratch, "random_loose_dir/file.txt"),
    ).toThrow(/ROOT_HYGIENE_VIOLATION/);

    // Static package olt/ with runtime file
    expect(() =>
      RootDirectoryHygieneGuard.assertAllowedWritePath(scratch, "olt/events.jsonl"),
    ).toThrow(/Cannot write runtime file/);
    expect(() =>
      RootDirectoryHygieneGuard.assertAllowedWritePath(scratch, "olt/coverage/lcov.info"),
    ).toThrow(/Cannot write runtime file/);

    rmSync(scratch, { recursive: true, force: true });
  });

  test("Singleton Auditor Guard lease acquisition, renewal, and cleanup lifecycle", () => {
    const scratch = scratchRoot(import.meta.path, "singleton-auditor-test");
    const lockPath = join(scratch, ".olt", "locks", "skill_auditor.lock");

    expect(readAuditorLeaseLock(lockPath)).toBeNull();

    // Acquire lock
    const lease = acquireAuditorLeaseLock({
      customLockPath: lockPath,
      auditor_id: "auditor-1",
      pid: process.pid,
      leaseDurationMs: 60_000,
    });
    expect(lease.auditor_id).toBe("auditor-1");
    expect(lease.pid).toBe(process.pid);

    // Re-acquire fails with lock collision for another auditor
    expect(() =>
      acquireAuditorLeaseLock({
        customLockPath: lockPath,
        auditor_id: "auditor-2",
        pid: process.pid + 1,
        isPidAliveFn: () => true,
      }),
    ).toThrow(/SINGLETON_AUDITOR_COLLISION/);

    // Re-acquire same auditor & pid renews lease
    const renewed = acquireAuditorLeaseLock({
      customLockPath: lockPath,
      auditor_id: "auditor-1",
      pid: process.pid,
      leaseDurationMs: 120_000,
    });
    expect(renewed.auditor_id).toBe("auditor-1");

    // Release lease
    const released = releaseAuditorLeaseLock({ customLockPath: lockPath, auditor_id: "auditor-1" });
    expect(released).toBe(true);
    expect(readAuditorLeaseLock(lockPath)).toBeNull();

    rmSync(scratch, { recursive: true, force: true });
  });

  test("Spawn Validator rejects duplicate active auditor spawns", () => {
    const scratch = scratchRoot(import.meta.path, "spawn-validator-test");
    const lockPath = join(scratch, "auditor.lock");

    // Non-auditor role spawn is allowed
    expect(validateSubagentSpawnRequest({ role: "implementer" }).allowed).toBe(true);

    // Auditor with active non-expired lease is rejected
    const activeLease = {
      auditor_id: "auditor-active",
      pid: process.pid,
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

    rmSync(scratch, { recursive: true, force: true });
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
    const scratch = scratchRoot(import.meta.path, "verbatim-injector-test");
    const agentsDir = join(scratch, "agents");
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

    // buildInjectionPrompt Mode A & Mode B
    const promptModeA = VerbatimRoleInjector.buildInjectionPrompt(scratch, "mind", {
      role: "mind",
      agentId: "mind_1",
      idleDurationSeconds: 150,
      pendingBacklogCount: 0,
      unresolvedDefectCount: 0,
    });
    expect(promptModeA).toContain("MODE A: AUTONOMOUS SELF-EVOLUTION MANDATE");

    const promptModeB = VerbatimRoleInjector.buildInjectionPrompt(scratch, "mind", {
      role: "mind",
      agentId: "mind_1",
      idleDurationSeconds: 150,
      pendingBacklogCount: 5,
      unresolvedDefectCount: 0,
    });
    expect(promptModeB).toContain("MODE B: ACTIVE INTAKE & WORK/SPAN SCALING MANDATE");

    // buildMindInitializationPrompt
    const mindInit = VerbatimRoleInjector.buildMindInitializationPrompt(scratch, {
      mindId: "mind_1",
      generation: 1,
    });
    expect(mindInit).toContain("MIND_INITIALIZATION_VERBATIM_MANIFEST_INJECTION");

    // buildInitializationPrompt for non-mind
    const coordInit = VerbatimRoleInjector.buildInitializationPrompt(scratch, "coordinator", {
      agentId: "coordinator_1",
    });
    expect(coordInit).toContain("SUPERVISORY ROLE INITIALIZATION: COORDINATOR");

    // buildSubagentSystemPrompt and buildSubagentDispatchPrompt
    const sysPrompt = VerbatimRoleInjector.buildSubagentSystemPrompt(scratch, "implementer", {
      customInstructions: "Work carefully",
    });
    expect(sysPrompt).toContain("SUBAGENT_VERBATIM_SYSTEM_PROMPT: IMPLEMENTER");
    expect(sysPrompt).toContain("Work carefully");

    const dispatchPrompt = VerbatimRoleInjector.buildSubagentDispatchPrompt(
      scratch,
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

    rmSync(scratch, { recursive: true, force: true });
  });

  test("RBAC command authorizer verifyCommandAuthorization and executeShieldedCommand", async () => {
    expect(verifyCommandAuthorization("coordinator", []).authorized).toBe(false);
    expect(verifyCommandAuthorization("coordinator", ["bun", "test"]).authorized).toBe(false);
    expect(verifyCommandAuthorization("coordinator", ["git", "checkout", "main"]).authorized).toBe(
      false,
    );
    expect(verifyCommandAuthorization("coordinator", ["rm", "-rf", "src"]).authorized).toBe(false);

    expect(
      verifyCommandAuthorization("implementer", ["bun", "test", "tests/unit/a.test.ts"]).authorized,
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
