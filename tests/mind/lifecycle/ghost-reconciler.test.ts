import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectGhostOrchestrators,
  reconcileOrchestratorRoster,
  terminateDetachedOrchestrator,
  type GhostOrchestratorFinding,
  type LiveSubagentInfo,
} from "../../../olt/scripts/src/mind/lifecycle/ghost-reconciler.ts";
import {
  deregisterOrchestrator,
  registerOrchestratorSpawn,
  type NewOrchestratorRecordInput,
} from "../../../olt/scripts/src/mind/lifecycle/orchestrator-ledger.ts";
import { syncOrchestratorToManifest } from "../../../olt/scripts/src/mind/lifecycle/manifest-sync.ts";

describe("Ghost Process Detection & Termination Engine", () => {
  let tempDir: string;
  let ledgerPath: string;
  let lockPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ghost-reconciler-test-"));
    ledgerPath = join(tempDir, "orchestrators.jsonl");
    lockPath = join(tempDir, "orchestrators.lock");
  });

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function registerValidOrchestrator(
    subagentId: string,
    pid: number,
    runId: string = `run-${subagentId}`,
  ): void {
    const input: NewOrchestratorRecordInput = {
      orchestrator_id: subagentId,
      run_id: runId,
      conversation_id: `conv-${subagentId}`,
      pid,
      host_type: "antigravity",
      manifest_sha256: "dummy-pin",
    };
    const rec = registerOrchestratorSpawn(input, ledgerPath, lockPath);
    const syncRes = syncOrchestratorToManifest(rec, { runRoot: tempDir });
    registerOrchestratorSpawn({ ...input, manifest_sha256: syncRes.pin }, ledgerPath, lockPath);
  }

  describe("detectGhostOrchestrators", () => {
    it("detects untracked orchestrator subagents as UNREGISTERED_IN_LEDGER", () => {
      const live: LiveSubagentInfo[] = [
        { subagent_id: "ghost-orch-1", role: "orchestrator", pid: 9001 },
      ];
      const findings = detectGhostOrchestrators(live, ledgerPath, { runRoot: tempDir });
      expect(findings).toHaveLength(1);
      expect(findings[0]?.subagent_id).toBe("ghost-orch-1");
      expect(findings[0]?.process_id).toBe(9001);
      expect(findings[0]?.reason).toBe("UNREGISTERED_IN_LEDGER");
      expect(findings[0]?.action_taken).toBe("ALERTED");
    });

    it("ignores non-orchestrator subagents when untracked", () => {
      const live: LiveSubagentInfo[] = [
        { subagent_id: "worker-1", role: "worker", pid: 8001 },
        { subagent_id: "validator-1", role: "sub-validator", pid: 8002 },
      ];
      const findings = detectGhostOrchestrators(live, ledgerPath, { runRoot: tempDir });
      expect(findings).toHaveLength(0);
    });

    it("flags orchestrators with mismatched PID as UNREGISTERED_IN_LEDGER", () => {
      registerValidOrchestrator("tracked-orch-1", 1001);
      const live: LiveSubagentInfo[] = [
        { subagent_id: "tracked-orch-1", role: "orchestrator", pid: 9999 },
      ];
      const findings = detectGhostOrchestrators(live, ledgerPath, { runRoot: tempDir });
      expect(findings).toHaveLength(1);
      expect(findings[0]?.reason).toBe("UNREGISTERED_IN_LEDGER");
    });

    it("flags terminal orchestrator records in ledger as DETACHED_ORPHAN", () => {
      registerValidOrchestrator("orphan-orch-1", 2001);
      deregisterOrchestrator("orphan-orch-1", "COMPLETED", ledgerPath, lockPath);

      const live: LiveSubagentInfo[] = [
        { subagent_id: "orphan-orch-1", role: "orchestrator", pid: 2001 },
      ];
      const findings = detectGhostOrchestrators(live, ledgerPath, { runRoot: tempDir });
      expect(findings).toHaveLength(1);
      expect(findings[0]?.reason).toBe("DETACHED_ORPHAN");
    });

    it("flags orchestrators with desynchronized manifest as DESYNCHRONIZED_MANIFEST", () => {
      registerOrchestratorSpawn(
        {
          orchestrator_id: "desync-orch-1",
          run_id: "run-desync-1",
          conversation_id: "conv-1",
          pid: 3001,
          host_type: "antigravity",
          manifest_sha256: "nonexistent-or-corrupted-hash",
        },
        ledgerPath,
        lockPath,
      );

      const live: LiveSubagentInfo[] = [
        { subagent_id: "desync-orch-1", role: "orchestrator", pid: 3001, run_id: "run-desync-1" },
      ];
      const findings = detectGhostOrchestrators(live, ledgerPath, { runRoot: tempDir });
      expect(findings).toHaveLength(1);
      expect(findings[0]?.reason).toBe("DESYNCHRONIZED_MANIFEST");
    });

    it("preserves valid registered orchestrators with zero findings", () => {
      registerValidOrchestrator("valid-orch-1", 4001);
      const live: LiveSubagentInfo[] = [
        {
          subagent_id: "valid-orch-1",
          role: "orchestrator",
          pid: 4001,
          run_id: "run-valid-orch-1",
        },
      ];
      const findings = detectGhostOrchestrators(live, ledgerPath, { runRoot: tempDir });
      expect(findings).toHaveLength(0);
    });
  });

  describe("terminateDetachedOrchestrator", () => {
    it("invokes custom killFn and returns true", () => {
      const killed: Array<{ pid: number; signal: NodeJS.Signals | string }> = [];
      const mockKill = (pid: number, signal: NodeJS.Signals | string) => {
        killed.push({ pid, signal });
        return true;
      };

      const finding: GhostOrchestratorFinding = {
        process_id: 7777,
        subagent_id: "ghost-test",
        detected_at: new Date().toISOString(),
        reason: "UNREGISTERED_IN_LEDGER",
        action_taken: "ALERTED",
      };

      const result = terminateDetachedOrchestrator(finding, {
        killFn: mockKill,
        signal: "SIGKILL",
      });

      expect(result).toBe(true);
      expect(killed).toEqual([{ pid: 7777, signal: "SIGKILL" }]);
    });

    it("respects dryRun and does not terminate", () => {
      let killCalled = false;
      const finding: GhostOrchestratorFinding = {
        process_id: 8888,
        subagent_id: "ghost-dry",
        detected_at: new Date().toISOString(),
        reason: "UNREGISTERED_IN_LEDGER",
        action_taken: "ALERTED",
      };

      const result = terminateDetachedOrchestrator(finding, {
        dryRun: true,
        killFn: () => {
          killCalled = true;
          return true;
        },
      });

      expect(result).toBe(false);
      expect(killCalled).toBe(false);
    });

    it("updates ledger to GHOST_TERMINATED if orchestrator was registered", () => {
      registerValidOrchestrator("registered-ghost", 5001);
      const finding: GhostOrchestratorFinding = {
        process_id: 5001,
        subagent_id: "registered-ghost",
        detected_at: new Date().toISOString(),
        reason: "DESYNCHRONIZED_MANIFEST",
        action_taken: "ALERTED",
      };

      const res = terminateDetachedOrchestrator(finding, {
        killFn: () => true,
        customLedgerPath: ledgerPath,
        customLockPath: lockPath,
      });

      expect(res).toBe(true);
    });
  });

  describe("reconcileOrchestratorRoster", () => {
    it("handles mixed rosters and terminates ghosts while preserving valid active orchestrators", () => {
      registerValidOrchestrator("orch-valid-1", 101);
      registerValidOrchestrator("orch-valid-2", 102);

      const killedPids: number[] = [];
      const killFn = (pid: number) => {
        killedPids.push(pid);
        return true;
      };

      const liveRoster: LiveSubagentInfo[] = [
        { subagent_id: "orch-valid-1", role: "orchestrator", pid: 101, run_id: "run-orch-valid-1" },
        { subagent_id: "orch-valid-2", role: "orchestrator", pid: 102, run_id: "run-orch-valid-2" },
        { subagent_id: "orch-ghost-1", role: "orchestrator", pid: 201 },
        { subagent_id: "orch-ghost-2", role: "orchestrator", pid: 202 },
        { subagent_id: "worker-sub-1", role: "worker", pid: 301 },
      ];

      const result = reconcileOrchestratorRoster({
        liveAgents: liveRoster,
        customLedgerPath: ledgerPath,
        customLockPath: lockPath,
        runRoot: tempDir,
        autoTerminate: true,
        killFn,
      });

      expect(result.active_registered_count).toBe(2);
      expect(result.ghost_count).toBe(2);
      expect(result.terminated_pids).toEqual([201, 202]);
      expect(result.findings).toHaveLength(2);
      expect(result.findings.every((f) => f.action_taken === "TERMINATED")).toBe(true);
      expect(killedPids).toEqual([201, 202]);
      expect(killedPids).not.toContain(101);
      expect(killedPids).not.toContain(102);
    });

    it("flags ghosts without termination when autoTerminate is false", () => {
      registerValidOrchestrator("orch-valid-1", 101);

      let killInvoked = false;
      const killFn = () => {
        killInvoked = true;
        return true;
      };

      const liveRoster: LiveSubagentInfo[] = [
        { subagent_id: "orch-valid-1", role: "orchestrator", pid: 101, run_id: "run-orch-valid-1" },
        { subagent_id: "untracked-orch", role: "orchestrator", pid: 999 },
      ];

      const result = reconcileOrchestratorRoster({
        liveAgents: liveRoster,
        customLedgerPath: ledgerPath,
        customLockPath: lockPath,
        runRoot: tempDir,
        autoTerminate: false,
        killFn,
      });

      expect(result.active_registered_count).toBe(1);
      expect(result.ghost_count).toBe(1);
      expect(result.terminated_pids).toHaveLength(0);
      expect(result.findings[0]?.action_taken).toBe("ALERTED");
      expect(killInvoked).toBe(false);
    });

    it("filters dead processes with isPidAliveFn hook", () => {
      const isPidAliveFn = (pid: number) => pid !== 9999;
      const liveRoster: LiveSubagentInfo[] = [
        { subagent_id: "dead-ghost", role: "orchestrator", pid: 9999 },
      ];

      const result = reconcileOrchestratorRoster({
        liveAgents: liveRoster,
        customLedgerPath: ledgerPath,
        customLockPath: lockPath,
        isPidAliveFn,
      });

      expect(result.active_registered_count).toBe(0);
      expect(result.ghost_count).toBe(0);
      expect(result.findings).toHaveLength(0);
    });
  });
});
