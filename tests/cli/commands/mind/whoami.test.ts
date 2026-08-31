import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  identifyExecutionContext,
  MAIN_THREAD_ADVISORY,
  recordDefect,
  type DefectRecord,
} from "../../../../olt/scripts/src/authority/thread/index.ts";
import { whoamiCommand } from "../../../../olt/scripts/src/cli/commands/whoami.ts";
import { commandInvocations, findCommand } from "../../../../olt/scripts/src/cli/registry/index.ts";
import { cleanupRoots } from "../fixtures/full-lifecycle-fixture.ts";
import { setupCompiledRun } from "../fixtures/task-ops-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("Thread Authority Identifier", () => {
  test("defaults to Tier 3 (fail-closed) rather than Tier 0 when no identity signal is present", () => {
    const identified = identifyExecutionContext({
      pid: 1001,
      ppid: 1000,
      env: {},
    });

    expect(identified.tier).toBe(3);
    expect(identified.tier_name).toBe(
      "Tier 3: Implementer / Validator / Repairer / Completeness Critic",
    );
    expect(identified.is_main_thread).toBeFalse();
    expect(identified.compliance_state).toBe("compliant");
    expect(identified.advisory).toBeNull();
    expect(identified.defect).toBeNull();
  });

  test("identifies Tier 1 Autonomous Orchestrator from environment", () => {
    const fromEnvTier = identifyExecutionContext({
      pid: 2001,
      ppid: 2000,
      env: { HARNESS_EXECUTION_TIER: "1" },
    });
    expect(fromEnvTier.tier).toBe(1);
    expect(fromEnvTier.tier_name).toBe(
      "Tier 1: Orchestrator Lead (Plan Supervisor & Release Manager)",
    );
    expect(fromEnvTier.role).toBe("orchestrator");
    expect(fromEnvTier.is_main_thread).toBeFalse();

    const fromTierString = identifyExecutionContext({
      pid: 2002,
      ppid: 2000,
      env: { HARNESS_EXECUTION_TIER: "tier-1" },
    });
    expect(fromTierString.tier).toBe(1);

    const fromRole = identifyExecutionContext({
      pid: 2003,
      ppid: 2000,
      env: { AGENT_ROLE: "orchestrator" },
    });
    expect(fromRole.tier).toBe(1);
    expect(fromRole.role).toBe("orchestrator");

    const fromAgentId = identifyExecutionContext({
      pid: 2004,
      ppid: 2000,
      env: { AGENT_ID: "orch-master-pulse" },
    });
    expect(fromAgentId.tier).toBe(1);
    expect(fromAgentId.role).toBe("orchestrator");
  });

  test("identifies Tier 2 Background Coordinator from environment", () => {
    const fromEnvTier = identifyExecutionContext({
      pid: 3001,
      ppid: 3000,
      env: { HARNESS_EXECUTION_TIER: "2" },
    });
    expect(fromEnvTier.tier).toBe(2);
    expect(fromEnvTier.tier_name).toBe("Tier 2: Coordinator Lead (Wave Execution & Lease Manager)");
    expect(fromEnvTier.role).toBe("coordinator");
    expect(fromEnvTier.is_main_thread).toBeFalse();

    const fromTierString = identifyExecutionContext({
      pid: 3002,
      ppid: 3000,
      env: { HARNESS_EXECUTION_TIER: "coordinator" },
    });
    expect(fromTierString.tier).toBe(2);

    const fromRole = identifyExecutionContext({
      pid: 3003,
      ppid: 3000,
      env: { AGENT_ROLE: "coordinator" },
    });
    expect(fromRole.tier).toBe(2);
    expect(fromRole.role).toBe("coordinator");

    const fromPrefixedRole = identifyExecutionContext({
      pid: 3004,
      ppid: 3000,
      env: { AGENT_ROLE: "coordinator-lead" },
    });
    expect(fromPrefixedRole.tier).toBe(2);

    const fromAgentId = identifyExecutionContext({
      pid: 3005,
      ppid: 3000,
      env: { AGENT_ID: "coordinator-wave-lead" },
    });
    expect(fromAgentId.tier).toBe(2);
    expect(fromAgentId.role).toBe("coordinator");
  });

  test("identifies Tier 3 Background Implementer / Validator / Critic from environment", () => {
    const fromEnvTier = identifyExecutionContext({
      pid: 4001,
      ppid: 4000,
      env: { HARNESS_EXECUTION_TIER: "3" },
    });
    expect(fromEnvTier.tier).toBe(3);
    expect(fromEnvTier.tier_name).toBe(
      "Tier 3: Implementer / Validator / Repairer / Completeness Critic",
    );
    expect(fromEnvTier.is_main_thread).toBeFalse();

    const fromTierString = identifyExecutionContext({
      pid: 4002,
      ppid: 4000,
      env: { HARNESS_EXECUTION_TIER: "implementer" },
    });
    expect(fromTierString.tier).toBe(3);

    const implementer = identifyExecutionContext({
      pid: 4003,
      ppid: 4000,
      env: { AGENT_ROLE: "implementer", AGENT_ID: "impl-auth" },
    });
    expect(implementer.tier).toBe(3);
    expect(implementer.role).toBe("implementer");
    expect(implementer.agent_id).toBe("impl-auth");

    const validator = identifyExecutionContext({
      pid: 4004,
      ppid: 4000,
      env: { AGENT_ROLE: "validator", AGENT_ID: "val-auth" },
    });
    expect(validator.tier).toBe(3);
    expect(validator.role).toBe("validator");

    const critic = identifyExecutionContext({
      pid: 4005,
      ppid: 4000,
      env: { AGENT_ROLE: "completeness-critic", AGENT_ID: "critic-gate" },
    });
    expect(critic.tier).toBe(3);
    expect(critic.role).toBe("completeness-critic");

    const repairer = identifyExecutionContext({
      pid: 4006,
      ppid: 4000,
      env: { AGENT_ID: "repairer-task-1" },
    });
    expect(repairer.tier).toBe(3);
    expect(repairer.role).toBe("repairer");
  });

  test("identifies Main Interactive Agent Thread and raises containment advisory", () => {
    const identified = identifyExecutionContext({
      pid: 5001,
      ppid: 5000,
      env: {
        SESSION_ID: "session-main-12345",
        INTERACTIVE_MAIN_THREAD: "1",
      },
    });

    expect(identified.is_main_thread).toBeTrue();
    expect(identified.tier_name).toBe("Main Interactive Agent Thread");
    expect(identified.compliance_state).toBe("restrained");
    expect(identified.advisory).toBe(MAIN_THREAD_ADVISORY);
    expect(identified.defect).toBeNull();
  });

  test("records defect records to run directory when available", async () => {
    const dir = await mkdtemp(join(tmpdir(), "harness-defect-test-"));
    roots.push(dir);

    const defect: DefectRecord = {
      id: "defect-test-1",
      type: "main_thread_boundary_violation",
      severity: "critical",
      timestamp: new Date().toISOString(),
      pid: 6001,
      ppid: 6000,
      agent_id: "test-agent",
      observation: "Direct file editing on main thread",
      remediation: "Dispatch Tier 3 Implementer",
      context: {
        cwd: dir,
        indicators: {},
      },
    };

    const recorded = recordDefect(defect, { runRoot: dir });
    expect(recorded.id).toBe("defect-test-1");

    const defectsFile = join(dir, "defects.jsonl");
    expect(existsSync(defectsFile)).toBeTrue();
    const contents = readFileSync(defectsFile, "utf8");
    expect(contents).toContain("defect-test-1");
  });
});

describe("whoami CLI command", () => {
  test("returns structured thread authority information", () => {
    const result = whoamiCommand({
      pid: "7001",
      ppid: "7000",
      agent: "impl-whoami",
    });

    expect(result.pid).toBe(7001);
    expect(result.ppid).toBe(7000);
    expect(result.agent_id).toBe("impl-whoami");
    expect(result.tier).toBe(3);
    expect(result.compliance_state).toBe("compliant");
    expect(typeof result.markdown).toBe("string");
    expect(String(result.markdown)).toContain("### Thread Authority Identification (`whoami`)");
    expect(String(result.markdown)).toContain("PID / PPID");
  });

  test("inspects run capsule active grants and leases when --run is provided", async () => {
    const { run } = await setupCompiledRun("whoami-run-test", roots);

    const result = whoamiCommand({
      run,
      agent: "planner",
      pid: "8001",
      ppid: "8000",
    });

    expect(result.run_root).toBe(run);
    expect(Array.isArray(result.active_grants)).toBeTrue();
    expect(Array.isArray(result.active_leases)).toBeTrue();
    expect(String(result.markdown)).toContain("Run Root");
  });

  test("surfaces main thread restraint advisory in command output", () => {
    const originalEnv = process.env.INTERACTIVE_MAIN_THREAD;
    try {
      process.env.INTERACTIVE_MAIN_THREAD = "1";
      const result = whoamiCommand({
        pid: "9001",
        ppid: "9000",
      });

      expect(result.is_main_thread).toBeTrue();
      expect(result.compliance_state).toBe("restrained");
      expect(result.advisory).toBe(MAIN_THREAD_ADVISORY);
      expect(String(result.markdown)).toContain("[MAIN THREAD RESTRAINT ACTIVE]");
    } finally {
      if (originalEnv === undefined) {
        delete process.env.INTERACTIVE_MAIN_THREAD;
      } else {
        process.env.INTERACTIVE_MAIN_THREAD = originalEnv;
      }
    }
  });

  test("dispatches via spec handler for whoami invocation", async () => {
    const whoamiSpec = findCommand("whoami");
    expect(whoamiSpec).toBeDefined();
    if (!whoamiSpec) throw new Error("whoami spec not found");

    const whoamiResult = await whoamiSpec.handler(
      { agent: "val-checker", pid: "1111", ppid: "1110" },
      {},
      [],
    );
    expect(whoamiResult.agent_id).toBe("val-checker");
    expect(whoamiResult.pid).toBe(1111);

    expect(findCommand("thread:identify")).toBeUndefined();
    expect(findCommand("authority:whoami")).toBeUndefined();
  });
});

describe("Registry integration", () => {
  test("exposes canonical whoami command and excludes legacy aliases", () => {
    const invocations = commandInvocations();
    expect(invocations).toContain("whoami");
    expect(invocations).not.toContain("thread:identify");
    expect(invocations).not.toContain("authority:whoami");

    const whoamiSpec = findCommand("whoami");
    expect(whoamiSpec).toBeDefined();
    expect(whoamiSpec?.name).toBe("whoami");
    expect(whoamiSpec?.aliases).toEqual([]);
    expect(whoamiSpec?.domain).toBe("authority");
    expect(whoamiSpec?.handler).toBeInstanceOf(Function);
  });

  test("declares valid command spec for whoami", () => {
    const whoamiSpec = findCommand("whoami");
    expect(whoamiSpec).toBeDefined();
    if (!whoamiSpec) throw new Error("whoami spec not found");

    expect(whoamiSpec.domain).toBe("authority");
    expect(whoamiSpec.summary.length).toBeGreaterThan(0);
    expect(whoamiSpec.description.length).toBeGreaterThan(0);
    expect(whoamiSpec.flags.length).toBeGreaterThan(0);
    expect(whoamiSpec.exitCodes.length).toBeGreaterThan(0);
    expect(whoamiSpec.examples.length).toBeGreaterThan(0);
  });
});

describe("Supervisory Persona Reminder Dynamic Injection (whoami CLI)", () => {
  test("injects Supervisory Persona Reminder for Tier 0 Mind", () => {
    const result = whoamiCommand({
      role: "mind",
      agent: "mind-lead",
      tier: "0",
    });

    expect(result.persona_reminder).toBeDefined();
    const reminder = result.persona_reminder as Record<string, unknown>;
    expect(reminder.role).toBe("mind");
    expect(reminder.tier).toBe(0);
    expect(String(result.markdown)).toContain("SUPERVISOR ROLE DETECTED");
    expect(String(result.markdown)).toContain("SUPERVISORY PERSONA");
    expect(String(result.markdown)).toContain(
      "Strict 4-Tier Spawning Hierarchy & Zero-File-Edit Invariant",
    );
    expect(Array.isArray(result.decision_protocols)).toBeTrue();
    expect(Array.isArray(result.checklist)).toBeTrue();
  });

  test("injects Supervisory Persona Reminder for Tier 1 Orchestrator", () => {
    const result = whoamiCommand({
      role: "orchestrator",
      agent: "orch-lead",
      tier: "1",
    });

    expect(result.persona_reminder).toBeDefined();
    const reminder = result.persona_reminder as Record<string, unknown>;
    expect(reminder.role).toBe("orchestrator");
    expect(reminder.tier).toBe(1);
    expect(String(result.markdown)).toContain("SUPERVISOR ROLE DETECTED");
    expect(String(result.markdown)).toContain("Orchestrator");
  });

  test("injects Supervisory Persona Reminder for Tier 2 Coordinator with active leases", async () => {
    const { run } = await setupCompiledRun("whoami-coord-reminder", roots);

    const result = whoamiCommand({
      run,
      role: "coordinator",
      agent: "coord-alpha",
      tier: "2",
    });

    expect(result.persona_reminder).toBeDefined();
    const reminder = result.persona_reminder as Record<string, unknown>;
    expect(reminder.role).toBe("coordinator");
    expect(reminder.tier).toBe(2);
    expect(String(result.markdown)).toContain("Coordinator");
    expect(String(result.markdown)).toContain("SUPERVISORY INVARIANTS");
  });

  test("injects Persona Reminder for Tier 3 Implementer", () => {
    const result = whoamiCommand({
      role: "implementer",
      agent: "worker-beta",
      tier: "3",
    });

    expect(result.persona_reminder).toBeDefined();
    const reminder = result.persona_reminder as Record<string, unknown>;
    expect(reminder.role).toBe("implementer");
    expect(reminder.tier).toBe(3);
    expect(String(result.markdown)).toContain("PERSONA REMINDER");
  });
});
