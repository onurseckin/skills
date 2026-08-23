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
  type ProcessHealthStatus,
  type WatchdogEvent,
  type WatchdogFinding,
  type WatchdogHealthAuditReport,
  type WatchdogTickReport,
} from "../../../olt/scripts/src/watchdog/index.ts";
import {
  assertSupervisorRoleConfinement,
  auditSupervisorCodeContamination,
  auditTierConfinement,
  DOCTOR_SUPERVISOR_CODE_CONTAMINATION,
  isSourceCodeFile,
  type TierConfinementFinding,
} from "../../../olt/scripts/src/doctor/tier-confinement.ts";
import { HarnessError } from "../../../olt/scripts/src/errors/harness-error.ts";
import type { AgentGrantRecord } from "../../../olt/scripts/src/contracts/agents.ts";
import type { CommandRecord } from "../../../olt/scripts/src/contracts/commands.ts";
import type { TaskRecord } from "../../../olt/scripts/src/workflow/types.ts";
import type { JsonObject } from "../../../olt/scripts/src/contracts/json.ts";

describe("Autonomic Watchdog 3-Minute Heartbeat Loop (p47)", () => {
  it("initializes with 3-minute standard cadence (180,000ms) and 6-minute timeout (360,000ms)", () => {
    const watchdog = new AutonomicWatchdog();
    expect(watchdog.heartbeatIntervalMs).toBe(180_000);
    expect(watchdog.timeoutMs).toBe(360_000);
    expect(watchdog.healthAuditIntervalMs).toBe(180_000);
    expect(watchdog.processHealthCheckIntervalMs).toBe(60_000);
    expect(DEFAULT_WATCHDOG_HEARTBEAT_INTERVAL_MS).toBe(180_000);
    expect(DEFAULT_WATCHDOG_TIMEOUT_MS).toBe(360_000);
    expect(DEFAULT_HEALTH_AUDIT_INTERVAL_MS).toBe(180_000);
    expect(DEFAULT_PROCESS_HEALTH_CHECK_INTERVAL_MS).toBe(60_000);
    expect(MANDATORY_BOOT_GATES).toEqual(["whoami", "doctor"]);
  });

  it("executes 3-minute heartbeat ticks and triggers periodic health audits", async () => {
    let heartbeatReport: WatchdogTickReport | null = null;
    let auditReport: WatchdogHealthAuditReport | null = null;

    const watchdog = new AutonomicWatchdog({
      heartbeatIntervalMs: 180_000,
      timeoutMs: 360_000,
      onHeartbeat: (report) => {
        heartbeatReport = report;
      },
      onHealthAudit: (report) => {
        auditReport = report;
      },
    });

    const now = 1700000000000;
    const tick1 = await watchdog.tick(now);

    expect(tick1.tickCount).toBe(1);
    expect(tick1.intervalMs).toBe(180_000);
    expect(tick1.health.healthy).toBe(true);
    expect(heartbeatReport).not.toBeNull();
    expect(auditReport).not.toBeNull();

    const tick2 = await watchdog.tick(now + 180_000);
    expect(tick2.tickCount).toBe(2);
    expect(tick2.elapsedMs).toBe(180_000);
  });

  it("detects stalled agents exceeding the 6-minute timeout threshold", async () => {
    const watchdog = new AutonomicWatchdog({
      timeoutMs: 360_000,
    });

    const startTime = 1700000000000;
    watchdog.registerSubagent(
      {
        agentId: "impl-stalled-01",
        role: "implementer",
        taskId: "task-01",
      },
      startTime,
    );

    // Provide whoami and doctor boot gates so only stall is tested
    watchdog.recordWhoami("impl-stalled-01", startTime);
    watchdog.recordDoctor("impl-stalled-01", startTime);

    const stallEvents: WatchdogEvent[] = [];
    watchdog.on("stall_detected", (e) => stallEvents.push(e));

    // At +3 minutes: still active (within 6-min timeout)
    const audit1 = await watchdog.runHealthAudit(startTime + 180_000);
    expect(audit1.healthy).toBe(true);
    expect(audit1.stalledAgentsCount).toBe(0);
    expect(stallEvents.length).toBe(0);

    // At +6.5 minutes (390,000ms): timeout exceeded -> stalled
    const audit2 = await watchdog.runHealthAudit(startTime + 390_000);
    expect(audit2.healthy).toBe(false);
    expect(audit2.stalledAgentsCount).toBe(1);
    expect(stallEvents.length).toBe(1);
    expect(stallEvents[0]?.type).toBe("stall_detected");
    if (stallEvents[0]?.type === "stall_detected") {
      expect(stallEvents[0].agentId).toBe("impl-stalled-01");
      expect(stallEvents[0].finding.violationType).toBe("stalled_agent");
    }

    // Fresh heartbeat recovers the agent
    watchdog.recordHeartbeat("impl-stalled-01", "task-01", startTime + 400_000);
    const audit3 = await watchdog.runHealthAudit(startTime + 410_000);
    expect(audit3.healthy).toBe(true);
    expect(audit3.stalledAgentsCount).toBe(0);
  });

  it("supports start, stop, and dispose lifecycle cleanly", () => {
    const watchdog = new AutonomicWatchdog({
      heartbeatIntervalMs: 100,
    });

    expect(watchdog.isRunning()).toBe(false);
    watchdog.start();
    expect(watchdog.isRunning()).toBe(true);

    // Redundant start is no-op
    watchdog.start();
    expect(watchdog.isRunning()).toBe(true);

    watchdog.stop();
    expect(watchdog.isRunning()).toBe(false);

    // Redundant stop is no-op
    watchdog.stop();
    expect(watchdog.isRunning()).toBe(false);

    watchdog.dispose();
    expect(watchdog.getBootGateEnforcer().getAllRecords().length).toBe(0);
  });
});

describe("Mandatory Subagent Pre-Flight Boot Gates (whoami & doctor)", () => {
  it("enforces both whoami and doctor execution before subagent can pass boot gates", () => {
    const enforcer = new BootGateEnforcer();
    const agent = enforcer.registerSpawnedSubagent({
      agentId: "impl-wave-01",
      role: "implementer",
      parentAgentId: "coord-wave-01",
      taskId: "task-p47-autonomic-watchdog",
    });

    expect(agent.whoamiExecuted).toBe(false);
    expect(agent.doctorExecuted).toBe(false);
    expect(agent.bootGatePassed).toBe(false);
    expect(agent.gateViolations.length).toBe(2);

    // Initial check: fails both gates
    const check1 = enforcer.verifyBootGates("impl-wave-01");
    expect(check1.passed).toBe(false);
    expect(check1.missingGates).toEqual(["whoami", "doctor"]);

    // Attempting task work without boot gates throws ROLE_CONFINEMENT_VIOLATION
    expect(() => enforcer.assertBootGatesPassed("impl-wave-01", "claiming task")).toThrow(
      HarnessError,
    );

    // Execute whoami only -> doctor still missing
    enforcer.recordWhoamiExecution("impl-wave-01");
    const check2 = enforcer.verifyBootGates("impl-wave-01");
    expect(check2.passed).toBe(false);
    expect(check2.missingGates).toEqual(["doctor"]);
    expect(check2.record?.whoamiExecuted).toBe(true);
    expect(check2.record?.doctorExecuted).toBe(false);
    expect(check2.record?.bootGatePassed).toBe(false);

    expect(() => enforcer.assertBootGatesPassed("impl-wave-01", "writing files")).toThrow(
      HarnessError,
    );

    // Execute doctor -> both gates passed!
    enforcer.recordDoctorExecution("impl-wave-01");
    const check3 = enforcer.verifyBootGates("impl-wave-01");
    expect(check3.passed).toBe(true);
    expect(check3.missingGates).toEqual([]);
    expect(check3.record?.whoamiExecuted).toBe(true);
    expect(check3.record?.doctorExecuted).toBe(true);
    expect(check3.record?.bootGatePassed).toBe(true);
    expect(check3.record?.gateViolations.length).toBe(0);

    // Now assertions pass cleanly
    expect(() => enforcer.assertBootGatesPassed("impl-wave-01", "claiming task")).not.toThrow();
  });

  it("automatically detects whoami and doctor in command execution argv", () => {
    const enforcer = new BootGateEnforcer();
    enforcer.registerSpawnedSubagent({
      agentId: "val-agent-02",
      role: "validator",
    });

    // Run whoami command
    enforcer.recordCommandExecution("val-agent-02", ["bun", "scripts/harness.ts", "whoami"]);

    let record = enforcer.getRecord("val-agent-02");
    expect(record?.whoamiExecuted).toBe(true);
    expect(record?.doctorExecuted).toBe(false);
    expect(record?.bootGatePassed).toBe(false);

    // Run doctor command
    enforcer.recordCommandExecution("val-agent-02", [
      "bun",
      "scripts/harness.ts",
      "doctor",
      "--run",
      ".capsules/run-01",
    ]);

    record = enforcer.getRecord("val-agent-02");
    expect(record?.whoamiExecuted).toBe(true);
    expect(record?.doctorExecuted).toBe(true);
    expect(record?.bootGatePassed).toBe(true);
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

    const compliantRec = enforcer.getRecord("impl-compliant");
    expect(compliantRec?.bootGatePassed).toBe(true);

    const rogueRec = enforcer.getRecord("impl-rogue");
    expect(rogueRec?.bootGatePassed).toBe(false);

    const findings = enforcer.auditFindings(records);
    expect(findings.length).toBe(1);
    expect(findings[0]?.agentId).toBe("impl-rogue");
    expect(findings[0]?.violationType).toBe("boot_gate_missing");
    expect(findings[0]?.severity).toBe("critical");
    expect(findings[0]?.observation).toContain("missing [whoami, doctor]");
  });
});

describe("Watchdog Live CLI Integration & Process Health Auditing (p56)", () => {
  it("captures, verifies, and validates live CLI command proofs for boot gates", () => {
    const enforcer = new BootGateEnforcer();
    enforcer.registerSpawnedSubagent({
      agentId: "impl-live-cli",
      role: "implementer",
      taskId: "task-p56",
      pid: 45678,
    });

    const whoamiProof: LiveCliProof = {
      gate: "whoami",
      actor: "impl-live-cli",
      argv: ["bun", "harness.ts", "whoami", "--run", ".capsules/run-01"],
      exitCode: 0,
      executedAt: "2026-08-22T05:00:00.000Z",
      pid: 45678,
      fingerprint: "fp-whoami-01",
      verified: true,
    };

    enforcer.recordCliProof(whoamiProof);
    let record = enforcer.getRecord("impl-live-cli");
    expect(record?.whoamiExecuted).toBe(true);
    expect(record?.whoamiProof?.verified).toBe(true);
    expect(record?.whoamiProof?.fingerprint).toBe("fp-whoami-01");
    expect(record?.doctorExecuted).toBe(false);

    // Record doctor proof with exitCode 0
    const doctorProof: LiveCliProof = {
      gate: "doctor",
      actor: "impl-live-cli",
      argv: ["bun", "harness.ts", "doctor", "--run", ".capsules/run-01"],
      exitCode: 0,
      executedAt: "2026-08-22T05:00:05.000Z",
      pid: 45678,
      fingerprint: "fp-doctor-01",
      verified: true,
    };

    enforcer.recordCliProof(doctorProof);
    record = enforcer.getRecord("impl-live-cli");
    expect(record?.doctorExecuted).toBe(true);
    expect(record?.doctorProof?.verified).toBe(true);
    expect(record?.bootGatePassed).toBe(true);

    const verification = enforcer.verifyBootGates("impl-live-cli", true);
    expect(verification.passed).toBe(true);
    expect(verification.proofs?.whoami?.verified).toBe(true);
    expect(verification.proofs?.doctor?.verified).toBe(true);
  });

  it("rejects failed / unverified CLI proofs and flags invalid_boot_gate_proof findings", () => {
    const enforcer = new BootGateEnforcer();
    enforcer.registerSpawnedSubagent({
      agentId: "impl-failing-cli",
      role: "implementer",
    });

    // Failing doctor proof with non-zero exit
    const failedDoctorProof: LiveCliProof = {
      gate: "doctor",
      actor: "impl-failing-cli",
      argv: ["bun", "harness.ts", "doctor"],
      exitCode: 1,
      executedAt: "2026-08-22T05:00:00.000Z",
      verified: false,
      failureReason: "Doctor detected role contamination",
    };

    enforcer.recordCliProof(failedDoctorProof);
    const record = enforcer.getRecord("impl-failing-cli");
    expect(record?.doctorExecuted).toBe(false);
    expect(record?.doctorProof?.verified).toBe(false);

    const findings = enforcer.auditFindings();
    expect(findings.length).toBe(1);
    expect(findings[0]?.violationType).toBe("invalid_boot_gate_proof");
    expect(findings[0]?.severity).toBe("critical");

    expect(() => enforcer.assertBootGatesPassed("impl-failing-cli", "running gate", true)).toThrow(
      HarnessError,
    );
  });

  it("audits live process health and detects dead or terminated worker processes", async () => {
    const livePids = new Set<number>([1111, 2222]);
    const mockLivenessChecker = (pid: number) => livePids.has(pid);

    const watchdog = new AutonomicWatchdog({
      processLivenessChecker: mockLivenessChecker,
    });

    const now = 1700000000000;
    // Register active worker with live PID 1111
    watchdog.registerSubagent(
      {
        agentId: "impl-live-worker",
        role: "implementer",
        pid: 1111,
      },
      now,
    );
    watchdog.recordWhoami("impl-live-worker", now);
    watchdog.recordDoctor("impl-live-worker", now);

    // Register worker with dead PID 3333
    watchdog.registerSubagent(
      {
        agentId: "impl-dead-worker",
        role: "implementer",
        pid: 3333,
      },
      now,
    );
    watchdog.recordWhoami("impl-dead-worker", now);
    watchdog.recordDoctor("impl-dead-worker", now);

    const procFailureEvents: WatchdogEvent[] = [];
    watchdog.on("process_failure_detected", (e) => procFailureEvents.push(e));

    const audit = await watchdog.runHealthAudit(now);
    expect(audit.healthy).toBe(false);
    expect(audit.deadProcessesCount).toBe(1);
    expect(procFailureEvents.length).toBe(1);
    expect(procFailureEvents[0]?.type).toBe("process_failure_detected");
    if (procFailureEvents[0]?.type === "process_failure_detected") {
      expect(procFailureEvents[0].agentId).toBe("impl-dead-worker");
      expect(procFailureEvents[0].pid).toBe(3333);
      expect(procFailureEvents[0].finding.violationType).toBe("process_health_failure");
    }

    const healthList = watchdog.auditProcessHealth(now);
    expect(healthList.length).toBe(2);
    const liveStatus = healthList.find((h) => h.pid === 1111);
    const deadStatus = healthList.find((h) => h.pid === 3333);
    expect(liveStatus?.alive).toBe(true);
    expect(deadStatus?.alive).toBe(false);
  });

  it("renders clean ASCII tables and formatted CLI status reports", async () => {
    const watchdog = new AutonomicWatchdog();
    const now = 1700000000000;

    watchdog.registerSubagent(
      {
        agentId: "impl-cli-render-01",
        role: "implementer",
        pid: process.pid,
      },
      now,
    );
    watchdog.recordWhoami("impl-cli-render-01", now);
    watchdog.recordDoctor("impl-cli-render-01", now);

    const table = watchdog.getBootGateEnforcer().renderAsciiBootGateTable();
    expect(table).toContain("impl-cli-render-01");
    expect(table).toContain("PASS ✅");
    expect(table).toContain("READY ✅");

    const cliReport = await watchdog.renderCliStatusReport(now);
    expect(cliReport).toContain("### Autonomic Watchdog Status & Boot-Gate Enforcer");
    expect(cliReport).toContain("HEALTHY ✅");
    expect(cliReport).toContain("impl-cli-render-01");
  });
});

describe("DOCTOR_SUPERVISOR_CODE_CONTAMINATION Doctor Check Enforcement", () => {
  it("exports DOCTOR_SUPERVISOR_CODE_CONTAMINATION check identifier", () => {
    expect(DOCTOR_SUPERVISOR_CODE_CONTAMINATION).toBe("DOCTOR_SUPERVISOR_CODE_CONTAMINATION");
  });

  it("isSourceCodeFile accurately identifies source code files vs non-code artifacts", () => {
    expect(isSourceCodeFile("scripts/src/watchdog/autonomic-watchdog.ts")).toBe(true);
    expect(isSourceCodeFile("src/components/button.tsx")).toBe(true);
    expect(isSourceCodeFile("server/index.js")).toBe(true);
    expect(isSourceCodeFile("backend/main.py")).toBe(true);
    expect(isSourceCodeFile("engine/lib.rs")).toBe(true);
    expect(isSourceCodeFile("scripts/build.sh")).toBe(true);

    // Non-source files
    expect(isSourceCodeFile(".capsules/run-1/state.json")).toBe(false);
    expect(isSourceCodeFile(".capsules/run-1/reports/report.md")).toBe(false);
    expect(isSourceCodeFile("docs/architecture.md")).toBe(false);
    expect(isSourceCodeFile("README.md")).toBe(false);
  });

  it("auditSupervisorCodeContamination flags supervisor code-editing tool usage", () => {
    const roleMap = new Map<string, string>([
      ["orch-01", "orchestrator"],
      ["coord-01", "coordinator"],
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

    const findings: TierConfinementFinding[] = [];
    auditSupervisorCodeContamination(roleMap, grants, [], [], undefined, findings);

    expect(findings.length).toBe(1);
    expect(findings[0]?.violation_type).toBe("supervisor_code_contamination");
    expect(findings[0]?.severity).toBe("critical");
    expect(findings[0]?.observation).toContain(DOCTOR_SUPERVISOR_CODE_CONTAMINATION);
    expect(findings[0]?.observation).toContain("write_to_file");
  });

  it("auditSupervisorCodeContamination flags supervisor direct repo content mutation in commands", () => {
    const roleMap = new Map<string, string>([["orch-lead", "orchestrator"]]);

    const commands: CommandRecord[] = [
      {
        id: "cmd-orch-mutate",
        argv: ["sed", "-i", "s/foo/bar/", "src/index.ts"],
        cwd: ".",
        cwd_relative: ".",
        repository_root: "/repo",
        status: "succeeded",
        task_id: null,
        gate_id: null,
        started_at: "2026-08-22T00:05:00.000Z",
        finished_at: "2026-08-22T00:05:01.000Z",
        exit_code: 0,
        signal: null,
        fingerprint: "fp1",
        attempt_signing_public_key: "pk1",
        record_path: "commands/cmd-orch-mutate.json",
        actor: "orch-lead",
        repository_before: {
          schema: "harness.repository-binding",
          version: 1,
          content_sha256: "aaaa111122223333444455556666777788889999000011112222333344445555",
          file_count: 10,
          total_bytes: 5000,
          inspection_sha256: "insp1",
          git_identity_sha256: "git1",
        },
        repository_after: {
          schema: "harness.repository-binding",
          version: 1,
          content_sha256: "bbbb111122223333444455556666777788889999000011112222333344445555", // Mutated!
          file_count: 10,
          total_bytes: 5002,
          inspection_sha256: "insp2",
          git_identity_sha256: "git2",
        },
      },
    ];

    const findings = auditSupervisorCodeContamination(roleMap, [], commands, []);
    expect(findings.length).toBe(1);
    expect(findings[0]?.violation_type).toBe("supervisor_code_contamination");
    expect(findings[0]?.severity).toBe("critical");
    expect(findings[0]?.observation).toContain(DOCTOR_SUPERVISOR_CODE_CONTAMINATION);
    expect(findings[0]?.observation).toContain("direct repository content mutation");
  });

  it("auditSupervisorCodeContamination flags supervisor implementation task leases", () => {
    const roleMap = new Map<string, string>([["coord-01", "coordinator"]]);
    const tasks: TaskRecord[] = [
      {
        id: "task-code-edit",
        status: "leased",
        lease: {
          agent_id: "coord-01",
          role: "coordinator",
          issued_at: "2026-08-22T00:00:00.000Z",
          expires_at: "2026-08-22T00:20:00.000Z",
          heartbeat_at: "2026-08-22T00:00:00.000Z",
          duration_seconds: 1200,
          token_digest: "tok1",
          write_scope: ["src/core"],
        },
      } as unknown as TaskRecord,
    ];

    const findings = auditSupervisorCodeContamination(roleMap, [], [], tasks);
    expect(findings.length).toBe(1);
    expect(findings[0]?.violation_type).toBe("supervisor_code_contamination");
    expect(findings[0]?.severity).toBe("critical");
    expect(findings[0]?.observation).toContain(DOCTOR_SUPERVISOR_CODE_CONTAMINATION);
    expect(findings[0]?.observation).toContain("holds active implementation lease");
  });

  it("auditSupervisorCodeContamination flags supervisor git diff source code modifications", () => {
    const roleMap = new Map<string, string>([["coord-alpha", "coordinator"]]);
    const gitDiffs = [
      {
        path: "src/server/auth.ts",
        actor: "coord-alpha",
        role: "coordinator",
        status: "modified",
      },
      {
        path: "docs/readme.md",
        actor: "coord-alpha",
        role: "coordinator",
        status: "modified",
      },
    ];

    const findings = auditSupervisorCodeContamination(roleMap, [], [], [], gitDiffs);
    expect(findings.length).toBe(1); // Only the source code file is flagged!
    expect(findings[0]?.violation_type).toBe("supervisor_code_contamination");
    expect(findings[0]?.severity).toBe("critical");
    expect(findings[0]?.observation).toContain("src/server/auth.ts");
    expect(findings[0]?.observation).toContain(DOCTOR_SUPERVISOR_CODE_CONTAMINATION);
  });

  it("assertSupervisorRoleConfinement throws fatal HarnessError on DOCTOR_SUPERVISOR_CODE_CONTAMINATION", () => {
    const findings: TierConfinementFinding[] = [
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

    expect(() => assertSupervisorRoleConfinement(findings)).toThrow(HarnessError);
    try {
      assertSupervisorRoleConfinement(findings);
    } catch (err: unknown) {
      expect(err instanceof HarnessError).toBe(true);
      if (err instanceof HarnessError) {
        expect(err.code).toBe("ROLE_CONFINEMENT_VIOLATION");
        expect(err.message).toContain("Supervisor code editing contamination detected");
      }
    }
  });

  it("passes cleanly when supervisors adhere strictly to zero code mutations and tier boundaries", () => {
    const roleMap = new Map<string, string>([
      ["orch-01", "orchestrator"],
      ["coord-01", "coordinator"],
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
            name: "invoke_subagent",
            category: "orchestration",
            first_used_at: "2026-08-22T00:01:00.000Z",
            last_used_at: "2026-08-22T00:01:00.000Z",
            count: 1,
          },
        ],
      },
    ];

    const commands: CommandRecord[] = [
      {
        id: "cmd-01",
        argv: ["bun", "harness.ts", "task:claim"],
        cwd: ".",
        cwd_relative: ".",
        repository_root: "/repo",
        status: "succeeded",
        task_id: null,
        gate_id: null,
        started_at: "2026-08-22T00:01:00.000Z",
        finished_at: "2026-08-22T00:01:01.000Z",
        exit_code: 0,
        signal: null,
        fingerprint: "fp1",
        attempt_signing_public_key: "pk1",
        record_path: "commands/cmd-01.json",
        actor: "impl-01", // Implementer running task:claim, not supervisor
      },
    ];

    const tasks: TaskRecord[] = [
      {
        id: "task-01",
        status: "leased",
        lease: {
          agent_id: "impl-01", // Implementer holds lease, not supervisor
          role: "implementer",
          issued_at: "2026-08-22T00:01:00.000Z",
          expires_at: "2026-08-22T00:21:00.000Z",
          heartbeat_at: "2026-08-22T00:01:00.000Z",
          duration_seconds: 1200,
          token_digest: "tok1",
          write_scope: ["src/index.ts"],
        },
      } as unknown as TaskRecord,
    ];

    const findings = auditSupervisorCodeContamination(roleMap, grants, commands, tasks);
    expect(findings.length).toBe(0);
    expect(() => assertSupervisorRoleConfinement(findings)).not.toThrow();
  });
});

describe("Invariants & Cleanliness Audit - Autonomic Watchdog (p47 & p56)", () => {
  it("zero TypeScript any and zero suppressions across all watchdog files", () => {
    const watchdogDir = join(__dirname, "../../../olt/scripts/src/watchdog");
    const sourceFiles = [
      join(watchdogDir, "constants.ts"),
      join(watchdogDir, "types.ts"),
      join(watchdogDir, "boot-gate-enforcer.ts"),
      join(watchdogDir, "autonomic-watchdog.ts"),
      join(watchdogDir, "index.ts"),
      join(__dirname, "../../../olt/scripts/src/doctor/tier-confinement.ts"),
      __filename,
    ];

    const anyAnnotation = new RegExp(":\\s*any\\b");
    const anyCast = new RegExp("as\\s+any\\b");
    const anyGeneric = new RegExp("<\\s*any\\s*>");
    const tsIgnore = "@" + "ts-ignore";
    const tsExpectError = "@" + "ts-expect-error";
    const tsNoCheck = "@" + "ts-nocheck";
    const suppressionDirectiveA = "eslint" + "-disable";
    const suppressionDirectiveB = "oxlint" + "-disable";

    for (const filePath of sourceFiles) {
      const content = readFileSync(filePath, "utf8");

      expect(content).not.toMatch(anyAnnotation);
      expect(content).not.toMatch(anyCast);
      expect(content).not.toMatch(anyGeneric);
      expect(content.includes(tsIgnore)).toBe(false);
      expect(content.includes(tsExpectError)).toBe(false);
      expect(content.includes(tsNoCheck)).toBe(false);
      expect(content.includes(suppressionDirectiveA)).toBe(false);
      expect(content.includes(suppressionDirectiveB)).toBe(false);
    }
  });
});
