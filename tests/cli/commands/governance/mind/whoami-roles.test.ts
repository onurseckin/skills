import { afterEach, describe, expect, test } from "bun:test";
import { MAIN_THREAD_ADVISORY } from "../../../../../olt/scripts/src/authority/thread/index.ts";
import { whoamiCommand } from "../../../../../olt/scripts/src/cli/commands/whoami.ts";
import {
  commandInvocations,
  findCommand,
} from "../../../../../olt/scripts/src/cli/registry/index.ts";
import { cleanupRoots } from "../../fixtures/full-lifecycle-fixture.ts";
import { setupCompiledRun } from "../../fixtures/task-ops-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

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
