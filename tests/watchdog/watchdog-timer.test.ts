import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AutonomicWatchdog,
  BootGateEnforcer,
  DEFAULT_HEALTH_AUDIT_INTERVAL_MS,
  DEFAULT_PROCESS_HEALTH_CHECK_INTERVAL_MS,
  DEFAULT_WATCHDOG_HEARTBEAT_INTERVAL_MS,
  DEFAULT_WATCHDOG_TIMEOUT_MS,
  MANDATORY_BOOT_GATES,
  type LiveCliProof,
  type WatchdogEvent,
  type WatchdogHealthAuditReport,
  type WatchdogTickReport,
} from "../../olt/scripts/src/watchdog/index.ts";
import {
  assertSupervisorRoleConfinement,
  auditSupervisorCodeContamination,
  DOCTOR_SUPERVISOR_CODE_CONTAMINATION,
  isSourceCodeFile,
  type TierConfinementFinding,
} from "../../olt/scripts/src/reporting/doctor/tier-confinement/index.ts";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import type {
  AgentGrantRecord,
  CommandRecord,
  JsonObject,
} from "../../olt/scripts/src/core/contracts/index.ts";
import type { TaskRecord } from "../../olt/scripts/src/workflow/types.ts";

function makeCmd(actor: string, argv: string[], mutated = false): CommandRecord {
  const hashA = "aaaa111122223333444455556666777788889999000011112222333344445555";
  const hashB = mutated
    ? "bbbb111122223333444455556666777788889999000011112222333344445555"
    : hashA;
  return {
    id: "cmd-1",
    argv,
    cwd: ".",
    cwd_relative: ".",
    repository_root: "/repo",
    status: "succeeded",
    task_id: null,
    gate_id: null,
    started_at: "2026-08-22T00:00:00.000Z",
    finished_at: "2026-08-22T00:00:01.000Z",
    exit_code: 0,
    signal: null,
    fingerprint: "fp1",
    attempt_signing_public_key: "pk1",
    record_path: "cmd.json",
    actor,
    repository_before: {
      schema: "harness.repository-binding",
      version: 1,
      content_sha256: hashA,
      file_count: 10,
      total_bytes: 5000,
      inspection_sha256: "insp1",
      git_identity_sha256: "git1",
    },
    repository_after: {
      schema: "harness.repository-binding",
      version: 1,
      content_sha256: hashB,
      file_count: 10,
      total_bytes: 5000,
      inspection_sha256: "insp2",
      git_identity_sha256: "git2",
    },
  };
}

function makeTask(actor: string, role: string): TaskRecord {
  return {
    id: "task-1",
    status: "leased",
    requirement_ids: [],
    write_scope: ["src/core"],
    dependencies: [],
    attempts: [],
    history: [],
    repair_round: 0,
    lease: {
      agent_id: actor,
      role,
      issued_at: "2026-08-22T00:00:00.000Z",
      expires_at: "2026-08-22T00:20:00.000Z",
      heartbeat_at: "2026-08-22T00:00:00.000Z",
      duration_seconds: 1200,
      token_digest: "tok1",
      write_scope: ["src/core"],
      resource_scope: [],
    },
  };
}

describe("Autonomic Watchdog 3-Minute Heartbeat Loop (p47)", () => {
  it("initializes with 3-minute standard cadence and detects stalled agents exceeding 6-minute timeout", async () => {
    const watchdog = new AutonomicWatchdog({ heartbeatIntervalMs: 180_000, timeoutMs: 360_000 });
    expect(watchdog.heartbeatIntervalMs).toBe(180_000);
    expect(watchdog.timeoutMs).toBe(360_000);
    expect(watchdog.healthAuditIntervalMs).toBe(180_000);
    expect(watchdog.processHealthCheckIntervalMs).toBe(60_000);
    expect(DEFAULT_WATCHDOG_HEARTBEAT_INTERVAL_MS).toBe(180_000);
    expect(DEFAULT_WATCHDOG_TIMEOUT_MS).toBe(360_000);
    expect(DEFAULT_HEALTH_AUDIT_INTERVAL_MS).toBe(180_000);
    expect(DEFAULT_PROCESS_HEALTH_CHECK_INTERVAL_MS).toBe(60_000);
    expect(MANDATORY_BOOT_GATES).toEqual(["whoami", "doctor"]);

    let hbReport: WatchdogTickReport | null = null;
    let auditReport: WatchdogHealthAuditReport | null = null;
    const monitoredWd = new AutonomicWatchdog({
      heartbeatIntervalMs: 180_000,
      timeoutMs: 360_000,
      onHeartbeat: (r) => {
        hbReport = r;
      },
      onHealthAudit: (r) => {
        auditReport = r;
      },
    });
    const now = 1700000000000;
    const tick1 = await monitoredWd.tick(now);
    expect(tick1.tickCount).toBe(1);
    expect(hbReport).not.toBeNull();
    expect(auditReport).not.toBeNull();

    monitoredWd.registerSubagent(
      { agentId: "impl-stalled-01", role: "implementer", taskId: "task-01" },
      now,
    );
    monitoredWd.recordWhoami("impl-stalled-01", now);
    monitoredWd.recordDoctor("impl-stalled-01", now);

    const stallEvents: WatchdogEvent[] = [];
    monitoredWd.on("stall_detected", (e) => stallEvents.push(e));

    const audit1 = await monitoredWd.runHealthAudit(now + 180_000);
    expect(audit1.healthy).toBe(true);

    const audit2 = await monitoredWd.runHealthAudit(now + 390_000);
    expect(audit2.healthy).toBe(false);
    expect(audit2.stalledAgentsCount).toBe(1);
    expect(stallEvents.length).toBe(1);

    monitoredWd.recordHeartbeat("impl-stalled-01", "task-01", now + 400_000);
    expect((await monitoredWd.runHealthAudit(now + 410_000)).healthy).toBe(true);
  });

  it("supports start, stop, and dispose lifecycle cleanly", () => {
    const watchdog = new AutonomicWatchdog({ heartbeatIntervalMs: 100 });
    expect(watchdog.isRunning()).toBe(false);
    watchdog.start();
    expect(watchdog.isRunning()).toBe(true);
    watchdog.stop();
    expect(watchdog.isRunning()).toBe(false);
    watchdog.start();
    watchdog.dispose();
    expect(watchdog.getBootGateEnforcer().getAllRecords().length).toBe(0);
  });
});

describe("Mandatory Subagent Pre-Flight Boot Gates (whoami & doctor)", () => {
  it("enforces both whoami and doctor before task execution and detects them in command argv", () => {
    const enforcer = new BootGateEnforcer();
    const agent = enforcer.registerSpawnedSubagent({
      agentId: "impl-wave-01",
      role: "implementer",
      taskId: "task-p47",
    });
    expect(agent.bootGatePassed).toBe(false);
    expect(() => enforcer.assertBootGatesPassed("impl-wave-01", "claiming task")).toThrow(
      HarnessError,
    );

    enforcer.recordWhoamiExecution("impl-wave-01");
    expect(enforcer.verifyBootGates("impl-wave-01").missingGates).toEqual(["doctor"]);
    expect(() => enforcer.assertBootGatesPassed("impl-wave-01", "writing files")).toThrow(
      HarnessError,
    );

    enforcer.recordDoctorExecution("impl-wave-01");
    expect(enforcer.verifyBootGates("impl-wave-01").passed).toBe(true);
    expect(() => enforcer.assertBootGatesPassed("impl-wave-01", "claiming task")).not.toThrow();

    const argvEnforcer = new BootGateEnforcer();
    argvEnforcer.registerSpawnedSubagent({ agentId: "val-agent-02", role: "validator" });
    argvEnforcer.recordCommandExecution("val-agent-02", ["bun", "scripts/harness.ts", "whoami"]);
    argvEnforcer.recordCommandExecution("val-agent-02", [
      "bun",
      "scripts/harness.ts",
      "doctor",
      "--run",
      "capsule",
    ]);
    expect(argvEnforcer.getRecord("val-agent-02")?.bootGatePassed).toBe(true);
  });

  it("audits boot gate compliance across capsule state and generates structured findings", () => {
    const enforcer = new BootGateEnforcer();
    const state: JsonObject = {
      agents: [
        {
          id: "impl-compliant",
          role: "implementer",
          parent_agent_id: "coord-01",
          granted_at: "2026-08-22T00:00:00.000Z",
        },
        {
          id: "impl-rogue",
          role: "implementer",
          parent_agent_id: "coord-01",
          granted_at: "2026-08-22T00:01:00.000Z",
        },
      ],
      commands: {
        "cmd-01": {
          id: "cmd-01",
          actor: "impl-compliant",
          argv: ["bun", "harness.ts", "whoami"],
          started_at: "2026-08-22T00:00:10.000Z",
        },
        "cmd-02": {
          id: "cmd-02",
          actor: "impl-compliant",
          argv: ["bun", "harness.ts", "doctor"],
          started_at: "2026-08-22T00:00:20.000Z",
        },
      },
    };
    const records = enforcer.auditSubagentBootGatesFromState(state);
    expect(records.length).toBe(2);
    expect(enforcer.getRecord("impl-compliant")?.bootGatePassed).toBe(true);
    expect(enforcer.getRecord("impl-rogue")?.bootGatePassed).toBe(false);
    const findings = enforcer.auditFindings(records);
    expect(findings.length).toBe(1);
    expect(findings[0]?.agentId).toBe("impl-rogue");
  });
});

describe("Watchdog Live CLI Integration & Process Health Auditing (p56)", () => {
  it("captures, verifies, rejects invalid proofs, audits process health, and formats reports", async () => {
    const enforcer = new BootGateEnforcer();
    enforcer.registerSpawnedSubagent({ agentId: "impl-live-cli", role: "implementer", pid: 45678 });
    const whoamiProof: LiveCliProof = {
      gate: "whoami",
      actor: "impl-live-cli",
      argv: ["bun", "harness.ts", "whoami"],
      exitCode: 0,
      executedAt: "2026-08-22T05:00:00.000Z",
      pid: 45678,
      fingerprint: "fp-01",
      verified: true,
    };
    const doctorProof: LiveCliProof = {
      gate: "doctor",
      actor: "impl-live-cli",
      argv: ["bun", "harness.ts", "doctor"],
      exitCode: 0,
      executedAt: "2026-08-22T05:00:05.000Z",
      pid: 45678,
      fingerprint: "fp-02",
      verified: true,
    };
    enforcer.recordCliProof(whoamiProof);
    enforcer.recordCliProof(doctorProof);
    expect(enforcer.verifyBootGates("impl-live-cli", true).passed).toBe(true);

    const failEnforcer = new BootGateEnforcer();
    failEnforcer.registerSpawnedSubagent({ agentId: "impl-failing-cli", role: "implementer" });
    failEnforcer.recordCliProof({
      gate: "doctor",
      actor: "impl-failing-cli",
      argv: ["bun", "harness.ts", "doctor"],
      exitCode: 1,
      executedAt: "2026-08-22T05:00:00.000Z",
      verified: false,
    });
    expect(failEnforcer.auditFindings().length).toBe(1);
    expect(() =>
      failEnforcer.assertBootGatesPassed("impl-failing-cli", "running gate", true),
    ).toThrow(HarnessError);

    const livePids = new Set<number>([1111]);
    const watchdog = new AutonomicWatchdog({ processLivenessChecker: (pid) => livePids.has(pid) });
    const now = 1700000000000;
    watchdog.registerSubagent({ agentId: "impl-live", role: "implementer", pid: 1111 }, now);
    watchdog.recordWhoami("impl-live", now);
    watchdog.recordDoctor("impl-live", now);
    watchdog.registerSubagent({ agentId: "impl-dead", role: "implementer", pid: 3333 }, now);
    watchdog.recordWhoami("impl-dead", now);
    watchdog.recordDoctor("impl-dead", now);

    const audit = await watchdog.runHealthAudit(now);
    expect(audit.healthy).toBe(false);
    expect(audit.deadProcessesCount).toBe(1);

    const report = await watchdog.renderCliStatusReport(now);
    expect(report).toContain("Autonomic Watchdog Status & Boot-Gate Enforcer");
  });
});

describe("DOCTOR_SUPERVISOR_CODE_CONTAMINATION Doctor Check Enforcement", () => {
  it("validates isSourceCodeFile and flags supervisor tool usage, command mutation, task leases, git diffs", () => {
    expect(DOCTOR_SUPERVISOR_CODE_CONTAMINATION).toBe("DOCTOR_SUPERVISOR_CODE_CONTAMINATION");
    expect(isSourceCodeFile("scripts/src/watchdog/autonomic-watchdog.ts")).toBe(true);
    expect(isSourceCodeFile("src/components/button.tsx")).toBe(true);
    expect(isSourceCodeFile("README.md")).toBe(false);
    expect(isSourceCodeFile(".olt/capsules/run-1/state.json")).toBe(false);

    const roleMap = new Map<string, string>([
      ["coord-01", "coordinator"],
      ["orch-01", "orchestrator"],
      ["impl-01", "implementer"],
    ]);
    const grants: AgentGrantRecord[] = [
      {
        id: "coord-01",
        run_id: "run-01",
        role: "coordinator",
        grant_issued_at: "2026-08-22T00:00:00.000Z",
        grant_expires_at: "2026-08-22T01:00:00.000Z",
        status: "active",
        tools_used: [
          {
            name: "write_to_file",
            category: "file-edit",
            first_used_at: "2026-08-22T00:05:00.000Z",
            last_used_at: "2026-08-22T00:05:00.000Z",
            count: 1,
          },
        ],
      },
    ];
    const f1: TierConfinementFinding[] = [];
    auditSupervisorCodeContamination(roleMap, grants, [], [], undefined, f1);
    expect(f1.length).toBe(1);
    expect(f1[0]?.violation_type).toBe("supervisor_code_contamination");

    const mutateCmd = makeCmd("orch-01", ["sed", "-i", "s/foo/bar/", "src/index.ts"], true);
    expect(auditSupervisorCodeContamination(roleMap, [], [mutateCmd], []).length).toBe(1);

    const taskLease = makeTask("coord-01", "coordinator");
    expect(auditSupervisorCodeContamination(roleMap, [], [], [taskLease]).length).toBe(1);

    const gitDiffs = [
      { path: "src/server/auth.ts", actor: "coord-01", role: "coordinator", status: "modified" },
      { path: "docs/readme.md", actor: "coord-01", role: "coordinator", status: "modified" },
    ];
    expect(auditSupervisorCodeContamination(roleMap, [], [], [], gitDiffs).length).toBe(1);

    const cleanGrants: AgentGrantRecord[] = [
      {
        id: "coord-01",
        run_id: "run-01",
        role: "coordinator",
        grant_issued_at: "2026-08-22T00:00:00.000Z",
        grant_expires_at: "2026-08-22T01:00:00.000Z",
        status: "active",
        tools_used: [
          {
            name: "invoke_subagent",
            category: "orchestration",
            first_used_at: "2026-08-22T00:01:00.000Z",
            last_used_at: "2026-08-22T00:01:00.000Z",
            count: 1,
          },
        ],
      },
    ];
    const cleanCmd = makeCmd("impl-01", ["bun", "harness.ts", "task:claim"], false);
    const cleanTask = makeTask("impl-01", "implementer");
    const cleanFindings = auditSupervisorCodeContamination(
      roleMap,
      cleanGrants,
      [cleanCmd],
      [cleanTask],
    );
    expect(cleanFindings.length).toBe(0);
    expect(() => assertSupervisorRoleConfinement(cleanFindings)).not.toThrow();

    const fatalFindings: TierConfinementFinding[] = [
      {
        agent_id: "coord-01",
        role: "coordinator",
        tier: 2,
        violation_type: "supervisor_code_contamination",
        severity: "critical",
        observation: `[${DOCTOR_SUPERVISOR_CODE_CONTAMINATION}] Tier 2 supervisor modified source files`,
        remediation: "Revert edits and delegate exclusively to Tier 3 Implementers.",
      },
    ];
    expect(() => assertSupervisorRoleConfinement(fatalFindings)).toThrow(HarnessError);
  });
});

describe("Invariants & Cleanliness Audit - Autonomic Watchdog (p47 & p56)", () => {
  it("zero TypeScript any and zero suppressions across all watchdog files", () => {
    const watchdogDir = join(__dirname, "../../../olt/scripts/src/watchdog");
    const autoDir = join(watchdogDir, "autonomic-watchdog");
    const bootDir = join(watchdogDir, "boot-gate-enforcer");
    const sourceFiles = [
      join(watchdogDir, "constants.ts"),
      join(watchdogDir, "types.ts"),
      join(watchdogDir, "index.ts"),
      join(autoDir, "activity-tracker.ts"),
      join(autoDir, "adaptive-timer.ts"),
      join(autoDir, "cli-reporter.ts"),
      join(autoDir, "event-emitter.ts"),
      join(autoDir, "health-auditor.ts"),
      join(autoDir, "reactive-dispatcher.ts"),
      join(autoDir, "types.ts"),
      join(autoDir, "watchdog-engine.ts"),
      join(autoDir, "index.ts"),
      join(bootDir, "enforcer.ts"),
      join(bootDir, "formatter.ts"),
      join(bootDir, "recorder.ts"),
      join(bootDir, "state-auditor.ts"),
      join(bootDir, "types.ts"),
      join(bootDir, "verifier.ts"),
      join(bootDir, "index.ts"),
      join(__dirname, "../../../olt/scripts/src/reporting/doctor/tier-confinement/index.ts"),
      __filename,
    ];
    for (const filePath of sourceFiles) {
      const c = readFileSync(filePath, "utf8");
      expect(c).not.toMatch(new RegExp(":\\s*any\\b|as\\s+any\\b|<\\s*any\\s*>"));
      expect(
        c.includes("@" + "ts-ignore") ||
          c.includes("@" + "ts-expect-error") ||
          c.includes("@" + "ts-nocheck"),
      ).toBe(false);
      expect(c.includes("eslint" + "-disable") || c.includes("oxlint" + "-disable")).toBe(false);
    }
  });
});
