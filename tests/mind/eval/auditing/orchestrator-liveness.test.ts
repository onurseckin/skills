import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  auditOrchestratorLiveness,
  defaultIsPidAlive,
  ORCHESTRATOR_LIVENESS_DEFECT,
  reclaimZombieOrchestrator,
  DEFAULT_HEARTBEAT_THRESHOLD_SECONDS,
  DEFAULT_SINGLETON_ROLE,
  type AuditLivenessOptions,
  type LiveSubagentInfo,
} from "../../../../olt/scripts/src/mind/auditing/orchestrator-liveness-auditor.ts";
import {
  loadOrchestratorLedger,
  registerOrchestratorSpawn,
  type NewOrchestratorRecordInput,
} from "../../../../olt/scripts/src/mind/lifecycle/orchestrator-ledger.ts";

function createInput(
  overrides: Partial<NewOrchestratorRecordInput> = {},
): NewOrchestratorRecordInput {
  return {
    orchestrator_id: "orch-01",
    run_id: "run-01",
    conversation_id: "conv-01",
    pid: 10001,
    host_type: "antigravity",
    manifest_sha256: "hash-01",
    ...overrides,
  };
}

describe("Orchestrator Liveness & Zombie Auditor", () => {
  let tempDir: string;
  let ledgerPath: string;
  let lockPath: string;
  let capsulesDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "liveness-auditor-test-"));
    ledgerPath = join(tempDir, "orchestrators.jsonl");
    lockPath = join(tempDir, "orchestrators.lock");
    capsulesDir = join(tempDir, ".olt", "capsules");
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe("constants and helpers", () => {
    test("exports standard defaults", () => {
      expect(DEFAULT_HEARTBEAT_THRESHOLD_SECONDS).toBe(300);
      expect(DEFAULT_SINGLETON_ROLE).toBe("skill_auditor");
      expect(ORCHESTRATOR_LIVENESS_DEFECT).toBe("ORCHESTRATOR_LIVENESS_DEFECT");
    });

    test("defaultIsPidAlive returns true for current process and false for non-existent/invalid PID", () => {
      expect(defaultIsPidAlive(process.pid)).toBe(true);
      expect(defaultIsPidAlive(-1)).toBe(false);
      expect(defaultIsPidAlive(0)).toBe(false);
      expect(defaultIsPidAlive(9999999)).toBe(false);
    });
  });

  describe("reclaimZombieOrchestrator", () => {
    test("transitions existing orchestrator to ZOMBIE_RECLAIMED", () => {
      registerOrchestratorSpawn(
        createInput({ orchestrator_id: "orch-target" }),
        ledgerPath,
        lockPath,
      );
      const reclaimed = reclaimZombieOrchestrator("orch-target", {
        customLedgerPath: ledgerPath,
        customLockPath: lockPath,
      });
      expect(reclaimed).toBe(true);
      const ledger = loadOrchestratorLedger(ledgerPath);
      expect(ledger[0]?.status).toBe("ZOMBIE_RECLAIMED");
    });

    test("returns false for non-existent or empty orchestrator ID", () => {
      expect(reclaimZombieOrchestrator("non-existent", { customLedgerPath: ledgerPath })).toBe(
        false,
      );
      expect(reclaimZombieOrchestrator("", { customLedgerPath: ledgerPath })).toBe(false);
    });
  });

  describe("zombie detection and reclamation", () => {
    test("detects and reclaims orchestrator with dead PID", () => {
      registerOrchestratorSpawn(
        createInput({ orchestrator_id: "orch-dead", pid: 99999 }),
        ledgerPath,
        lockPath,
      );
      const report = auditOrchestratorLiveness({
        customLedgerPath: ledgerPath,
        customLockPath: lockPath,
        isPidAliveFn: (pid) => pid !== 99999,
        now: "2026-08-29T12:00:00.000Z",
      });
      expect(report.zombies_reclaimed).toEqual(["orch-dead"]);
      expect(report.total_active_orchestrators).toBe(0);
      expect(report.error_code).toBe(ORCHESTRATOR_LIVENESS_DEFECT);
      const ledger = loadOrchestratorLedger(ledgerPath);
      expect(ledger[0]?.status).toBe("ZOMBIE_RECLAIMED");
    });

    test("detects and reclaims orchestrator with stale heartbeat (> 300s)", () => {
      registerOrchestratorSpawn(
        createInput({ orchestrator_id: "orch-stale", pid: 10002 }),
        ledgerPath,
        lockPath,
      );
      const baseTime = Date.now();
      const futureTime = new Date(baseTime + 301 * 1000);
      const report = auditOrchestratorLiveness({
        customLedgerPath: ledgerPath,
        customLockPath: lockPath,
        isPidAliveFn: () => true,
        heartbeatThresholdSeconds: 300,
        now: futureTime,
      });
      expect(report.zombies_reclaimed).toEqual(["orch-stale"]);
      expect(report.total_active_orchestrators).toBe(0);
      const ledger = loadOrchestratorLedger(ledgerPath);
      expect(ledger[0]?.status).toBe("ZOMBIE_RECLAIMED");
    });

    test("retains healthy active orchestrator without mutation", () => {
      registerOrchestratorSpawn(
        createInput({ orchestrator_id: "orch-healthy", pid: 10003 }),
        ledgerPath,
        lockPath,
      );
      const report = auditOrchestratorLiveness({
        customLedgerPath: ledgerPath,
        customLockPath: lockPath,
        isPidAliveFn: () => true,
        heartbeatThresholdSeconds: 300,
        now: new Date(),
      });
      expect(report.zombies_reclaimed).toEqual([]);
      expect(report.total_active_orchestrators).toBe(1);
      expect(report.error_code).toBeUndefined();
      const ledger = loadOrchestratorLedger(ledgerPath);
      expect(ledger[0]?.status).toBe("ACTIVE");
    });

    test("reclaims dead PID and stale heartbeat while preserving healthy ones in mixed roster", () => {
      const killedPids: number[] = [];
      const killFn = (pid: number) => {
        killedPids.push(pid);
        return true;
      };

      registerOrchestratorSpawn(
        createInput({ orchestrator_id: "orch-1-healthy", pid: 101 }),
        ledgerPath,
        lockPath,
      );
      registerOrchestratorSpawn(
        createInput({ orchestrator_id: "orch-2-deadpid", pid: 102 }),
        ledgerPath,
        lockPath,
      );
      registerOrchestratorSpawn(
        createInput({ orchestrator_id: "orch-3-stale", pid: 103 }),
        ledgerPath,
        lockPath,
      );

      const now = new Date(Date.now() + 500 * 1000);
      const report = auditOrchestratorLiveness({
        customLedgerPath: ledgerPath,
        customLockPath: lockPath,
        isPidAliveFn: (pid) => pid !== 102,
        killFn,
        heartbeatThresholdSeconds: 300,
        now,
      });

      expect(report.zombies_reclaimed).toHaveLength(3);
      expect(report.total_active_orchestrators).toBe(0);
    });
  });

  describe("multi-capsule discovery and ghost detection", () => {
    test("detects detached orchestrator in isolated capsule directory", () => {
      const capsule1 = join(capsulesDir, "capsule-alpha");
      mkdirSync(capsule1, { recursive: true });
      writeFileSync(
        join(capsule1, "manifest.json"),
        JSON.stringify({ pid: 8888, orchestrator_id: "orch-alpha-detached" }),
      );

      const report = auditOrchestratorLiveness({
        customLedgerPath: ledgerPath,
        customLockPath: lockPath,
        capsulesRootDir: capsulesDir,
        isPidAliveFn: (pid) => pid === 8888,
      });

      expect(report.ghost_processes_found).toHaveLength(1);
      expect(report.ghost_processes_found[0]?.subagent_id).toBe("orch-alpha-detached");
      expect(report.ghost_processes_found[0]?.reason).toBe("DETACHED_ORPHAN");
      expect(report.error_code).toBe(ORCHESTRATOR_LIVENESS_DEFECT);
    });

    test("detects ghost orchestrator from live agents list unregistered in ledger", () => {
      const liveAgents: LiveSubagentInfo[] = [
        { subagent_id: "ghost-orch-99", role: "orchestrator", pid: 9001, status: "ACTIVE" },
      ];
      const report = auditOrchestratorLiveness({
        customLedgerPath: ledgerPath,
        customLockPath: lockPath,
        liveAgents,
        isPidAliveFn: () => true,
      });

      expect(report.ghost_processes_found).toHaveLength(1);
      expect(report.ghost_processes_found[0]?.subagent_id).toBe("ghost-orch-99");
      expect(report.ghost_processes_found[0]?.reason).toBe("UNREGISTERED_IN_LEDGER");
      expect(report.error_code).toBe(ORCHESTRATOR_LIVENESS_DEFECT);
    });
  });

  describe("singleton auditor compliance", () => {
    test("passes compliance when 0 or 1 active skill_auditor exists", () => {
      const optionsNoAuditors: AuditLivenessOptions = {
        customLedgerPath: ledgerPath,
        customLockPath: lockPath,
        liveAgents: [],
      };
      expect(auditOrchestratorLiveness(optionsNoAuditors).singleton_auditor_compliant).toBe(true);

      const singleAuditor: LiveSubagentInfo[] = [
        { subagent_id: "auditor-01", role: "skill_auditor", pid: 501, status: "ACTIVE" },
        { subagent_id: "worker-01", role: "worker", pid: 502, status: "ACTIVE" },
      ];
      const report1 = auditOrchestratorLiveness({
        customLedgerPath: ledgerPath,
        customLockPath: lockPath,
        liveAgents: singleAuditor,
      });
      expect(report1.singleton_auditor_compliant).toBe(true);
    });

    test("fails compliance when > 1 active skill_auditor exists", () => {
      const multipleAuditors: LiveSubagentInfo[] = [
        { subagent_id: "auditor-01", role: "skill_auditor", pid: 601, status: "ACTIVE" },
        { subagent_id: "auditor-02", role: "skill_auditor", pid: 602, status: "ACTIVE" },
      ];
      const report = auditOrchestratorLiveness({
        customLedgerPath: ledgerPath,
        customLockPath: lockPath,
        liveAgents: multipleAuditors,
      });
      expect(report.singleton_auditor_compliant).toBe(false);
    });
  });
});
