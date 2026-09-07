import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  DEFAULT_GHOST_STARTUP_GRACE_WINDOW_MS,
  detectGhostOrchestrators,
  reconcileOrchestratorRoster,
  terminateDetachedOrchestrator,
  type GhostOrchestratorFinding,
  type LiveSubagentInfo,
} from "../../../../olt/scripts/src/mind/lifecycle/ghost-reconciler.ts";
import type { OrchestratorRegistrationRecord } from "../../../../olt/scripts/src/mind/lifecycle/orchestration/index.ts";
import {
  setupVirtualMindFS,
  cleanupVirtualMindFS,
  scratchRoot,
} from "../../fixtures/mind-fixture.ts";

describe("Mind Assembly Lifecycle Ghost Reconciler Suite", () => {
  let testDir: string;
  let customLedgerPath: string;
  let customLockPath: string;
  const fixedNow = new Date("2026-09-01T12:00:00.000Z").getTime();
  const oldSpawnTime = new Date(fixedNow - 30_000).toISOString();

  beforeEach(() => {
    setupVirtualMindFS();
    testDir = scratchRoot("ghost-reconciler");
    customLedgerPath = path.join(testDir, "orchestrators.jsonl");
    customLockPath = path.join(testDir, "orchestrators.lock");
  });

  afterEach(() => {
    cleanupVirtualMindFS();
  });

  const writeLedgerRecords = (records: OrchestratorRegistrationRecord[]) => {
    const lines = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
    fs.writeFileSync(customLedgerPath, lines, "utf8");
  };

  const makeRecord = (
    id: string,
    pid: number,
    status: OrchestratorRegistrationRecord["status"] = "ACTIVE",
    runId = "run-1",
  ): OrchestratorRegistrationRecord => ({
    orchestrator_id: id,
    run_id: runId,
    conversation_id: `conv-${id}`,
    pid,
    host_type: "antigravity",
    spawned_at: oldSpawnTime,
    status,
    manifest_sha256: "a".repeat(64),
    last_heartbeat_at: oldSpawnTime,
  });

  it("exports default startup grace window constant of 5000ms", () => {
    expect(DEFAULT_GHOST_STARTUP_GRACE_WINDOW_MS).toBe(5_000);
  });

  describe("detectGhostOrchestrators", () => {
    it("filters out non-orchestrators and respects startup grace window boundary", () => {
      const liveAgents: LiveSubagentInfo[] = [
        { subagent_id: "agent-imp", role: "implementer", pid: 101, spawned_at: oldSpawnTime },
        { subagent_id: "agent-val", role: "validator", pid: 102, spawned_at: oldSpawnTime },
        {
          subagent_id: "orch-young",
          role: "orchestrator",
          pid: 103,
          started_at: new Date(fixedNow - 3_000).toISOString(),
        },
        {
          subagent_id: "orch-expired-grace",
          role: "orchestrator",
          pid: 104,
          started_at: new Date(fixedNow - 5_001).toISOString(),
        },
      ];

      const findings = detectGhostOrchestrators(liveAgents, customLedgerPath, { now: fixedNow });
      expect(findings.length).toBe(1);
      expect(findings[0]!.subagent_id).toBe("orch-expired-grace");
      expect(findings[0]!.reason).toBe("UNREGISTERED_IN_LEDGER");
    });

    it("skips dead processes using mock isPidAliveFn", () => {
      writeLedgerRecords([makeRecord("orch-dead", 999)]);
      const liveAgents: LiveSubagentInfo[] = [
        { subagent_id: "orch-dead", role: "orchestrator", pid: 999, spawned_at: oldSpawnTime },
      ];

      const findings = detectGhostOrchestrators(liveAgents, customLedgerPath, {
        now: fixedNow,
        isPidAliveFn: (_pid) => false,
      });
      expect(findings).toEqual([]);
    });

    it("safely skips agent when verifyProcessStartTime hook returns false for recycled PID", () => {
      writeLedgerRecords([makeRecord("orch-recycled", 888)]);
      const liveAgents: LiveSubagentInfo[] = [
        { subagent_id: "orch-recycled", role: "orchestrator", pid: 888, spawned_at: oldSpawnTime },
      ];

      const findings = detectGhostOrchestrators(liveAgents, customLedgerPath, {
        now: fixedNow,
        verifyProcessStartTime: () => false,
      });
      expect(findings).toEqual([]);
    });

    it("flags UNREGISTERED_IN_LEDGER when live agent is missing from ledger or pid mismatches", () => {
      writeLedgerRecords([makeRecord("orch-pid-mismatch", 305)]);
      const liveAgents: LiveSubagentInfo[] = [
        {
          subagent_id: "orch-unregistered",
          role: "orchestrator",
          pid: 301,
          spawned_at: oldSpawnTime,
        },
        {
          subagent_id: "orch-pid-mismatch",
          role: "orchestrator",
          pid: 306,
          spawned_at: oldSpawnTime,
        },
      ];

      const findings = detectGhostOrchestrators(liveAgents, customLedgerPath, { now: fixedNow });
      expect(findings.length).toBe(2);
      expect(findings.every((f) => f.reason === "UNREGISTERED_IN_LEDGER")).toBe(true);
    });

    it("flags DETACHED_ORPHAN when ledger record status is inactive or detached", () => {
      writeLedgerRecords([
        makeRecord("orch-term", 310, "GHOST_TERMINATED"),
        makeRecord("orch-det", 311, "ACTIVE"),
      ]);
      const liveAgents: LiveSubagentInfo[] = [
        { subagent_id: "orch-term", role: "orchestrator", pid: 310, spawned_at: oldSpawnTime },
        {
          subagent_id: "orch-det",
          role: "orchestrator",
          pid: 311,
          status: "detached",
          spawned_at: oldSpawnTime,
        },
      ];

      const findings = detectGhostOrchestrators(liveAgents, customLedgerPath, { now: fixedNow });
      expect(findings.length).toBe(2);
      expect(findings.every((f) => f.reason === "DETACHED_ORPHAN")).toBe(true);
    });

    it("flags DESYNCHRONIZED_MANIFEST when run_id mismatches", () => {
      writeLedgerRecords([makeRecord("orch-run", 320, "ACTIVE", "run-expected")]);
      const liveAgents: LiveSubagentInfo[] = [
        {
          subagent_id: "orch-run",
          role: "orchestrator",
          pid: 320,
          run_id: "run-mismatch",
          spawned_at: oldSpawnTime,
        },
      ];

      const findings = detectGhostOrchestrators(liveAgents, customLedgerPath, { now: fixedNow });
      expect(findings.length).toBe(1);
      expect(findings[0]!.reason).toBe("DESYNCHRONIZED_MANIFEST");
    });
  });

  describe("terminateDetachedOrchestrator", () => {
    it("respects dryRun: true without invoking killFn", () => {
      let killCalled = false;
      const ghost: GhostOrchestratorFinding = {
        process_id: 401,
        subagent_id: "orch-dry",
        detected_at: new Date(fixedNow).toISOString(),
        reason: "UNREGISTERED_IN_LEDGER",
        action_taken: "ALERTED",
      };

      const result = terminateDetachedOrchestrator(ghost, {
        dryRun: true,
        killFn: () => {
          killCalled = true;
          return true;
        },
      });

      expect(killCalled).toBe(false);
      expect(result).toBe(false);
    });

    it("executes simulated termination with custom killFn", () => {
      let killedPid = 0;
      let killedSignal = "";
      const ghost: GhostOrchestratorFinding = {
        process_id: 402,
        subagent_id: "orch-live-kill",
        detected_at: new Date(fixedNow).toISOString(),
        reason: "DETACHED_ORPHAN",
        action_taken: "ALERTED",
      };

      const result = terminateDetachedOrchestrator(ghost, {
        dryRun: false,
        signal: "SIGTERM",
        killFn: (pid, sig) => {
          killedPid = pid;
          killedSignal = String(sig);
          return true;
        },
        customLedgerPath,
        customLockPath,
      });

      expect(killedPid).toBe(402);
      expect(killedSignal).toBe("SIGTERM");
      expect(result).toBe(true);
    });

    it("returns false gracefully when killFn fails or process already exited", () => {
      const ghost: GhostOrchestratorFinding = {
        process_id: 403,
        subagent_id: "orch-exited",
        detected_at: new Date(fixedNow).toISOString(),
        reason: "DETACHED_ORPHAN",
        action_taken: "ALERTED",
      };

      const result = terminateDetachedOrchestrator(ghost, {
        dryRun: false,
        killFn: () => false,
      });
      expect(result).toBe(false);
    });
  });

  describe("reconcileOrchestratorRoster", () => {
    it("executes full reconciliation and cleans ledger when autoTerminate is true", () => {
      writeLedgerRecords([
        makeRecord("orch-good", 501, "ACTIVE"),
        makeRecord("orch-bad", 502, "GHOST_TERMINATED"),
      ]);

      const liveAgents: LiveSubagentInfo[] = [
        { subagent_id: "orch-good", role: "orchestrator", pid: 501, spawned_at: oldSpawnTime },
        { subagent_id: "orch-bad", role: "orchestrator", pid: 502, spawned_at: oldSpawnTime },
      ];

      const killedPids: number[] = [];
      const report = reconcileOrchestratorRoster({
        liveAgents,
        customLedgerPath,
        customLockPath,
        autoTerminate: true,
        killFn: (pid) => {
          killedPids.push(pid);
          return true;
        },
        isPidAliveFn: () => true,
        validateManifest: false,
        now: fixedNow,
      });

      expect(report.ghost_count).toBe(1);
      expect(report.terminated_pids.length).toBe(1);
      expect(report.terminated_pids).toContain(502);
      expect(killedPids).toContain(502);
      expect(report.findings[0]!.subagent_id).toBe("orch-bad");
      expect(report.findings[0]!.action_taken).toBe("TERMINATED");
    });
  });
});
