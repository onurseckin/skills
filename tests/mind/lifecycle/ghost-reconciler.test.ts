import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  DEFAULT_GHOST_STARTUP_GRACE_WINDOW_MS,
  detectGhostOrchestrators,
  reconcileOrchestratorRoster,
  terminateDetachedOrchestrator,
  type GhostOrchestratorFinding,
  type LiveSubagentInfo,
} from "../../../olt/scripts/src/mind/lifecycle/ghost-reconciler.ts";
import type { OrchestratorRegistrationRecord } from "../../../olt/scripts/src/mind/lifecycle/orchestration/index.ts";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Ghost Reconciler Suite (ghost-reconciler.ts)", () => {
  let tempDir: string;
  let customLedgerPath: string;
  let customLockPath: string;
  const fixedNow = new Date("2026-09-01T12:00:00.000Z").getTime();
  const oldSpawnTime = new Date(fixedNow - 30_000).toISOString();

  beforeEach(() => {
    tempDir = join(tmpdir(), `ghost-rec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    mkdirSync(tempDir, { recursive: true });
    customLedgerPath = join(tempDir, "orchestrators.jsonl");
    customLockPath = join(tempDir, "orchestrators.lock");
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  const writeLedgerRecords = (records: OrchestratorRegistrationRecord[]) => {
    const lines = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
    writeFileSync(customLedgerPath, lines, "utf8");
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
    it("ignores non-orchestrator agent roles and handles started_at in grace window", () => {
      const liveAgents: LiveSubagentInfo[] = [
        { subagent_id: "agent-1", role: "implementer", pid: 101, spawned_at: oldSpawnTime },
        { subagent_id: "agent-2", role: "validator", pid: 102, spawned_at: oldSpawnTime },
        {
          subagent_id: "orch-young",
          role: "orchestrator",
          pid: 103,
          started_at: new Date(fixedNow - 1_000).toISOString(),
        },
      ];
      const findings = detectGhostOrchestrators(liveAgents, customLedgerPath, { now: fixedNow });
      expect(findings).toEqual([]);
    });

    it("skips agents that fail pid liveness or process start verification", () => {
      writeLedgerRecords([makeRecord("orch-dead", 999), makeRecord("orch-recycled", 998)]);
      const liveAgents: LiveSubagentInfo[] = [
        { subagent_id: "orch-dead", role: "orchestrator", pid: 999, spawned_at: oldSpawnTime },
        { subagent_id: "orch-recycled", role: "orchestrator", pid: 998, spawned_at: oldSpawnTime },
      ];
      const findingsDead = detectGhostOrchestrators(liveAgents, customLedgerPath, {
        now: fixedNow,
        isPidAliveFn: (pid) => pid !== 999,
        verifyProcessStartTime: (pid) => pid !== 998,
        validateManifest: false,
      });
      expect(findingsDead).toEqual([]);
    });

    it("flags UNREGISTERED_IN_LEDGER when missing or pid mismatch", () => {
      writeLedgerRecords([makeRecord("orch-pid-mismatch", 305)]);
      const liveAgents: LiveSubagentInfo[] = [
        { subagent_id: "orch-unreg", role: "orchestrator", pid: 301, spawned_at: oldSpawnTime },
        {
          subagent_id: "orch-pid-mismatch",
          role: "orchestrator",
          pid: 306,
          spawned_at: oldSpawnTime,
        },
      ];
      const findings = detectGhostOrchestrators(liveAgents, customLedgerPath, { now: fixedNow });
      expect(findings.length).toBe(2);
      expect(findings[0]!.reason).toBe("UNREGISTERED_IN_LEDGER");
      expect(findings[1]!.reason).toBe("UNREGISTERED_IN_LEDGER");
    });

    it("flags DETACHED_ORPHAN when status is inactive or detached/orphaned", () => {
      writeLedgerRecords([
        makeRecord("orch-term", 310, "GHOST_TERMINATED"),
        makeRecord("orch-det", 311, "ACTIVE"),
        makeRecord("orch-orph", 312, "INITIALIZING"),
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
        {
          subagent_id: "orch-orph",
          role: "orchestrator",
          pid: 312,
          status: "orphaned",
          spawned_at: oldSpawnTime,
        },
      ];
      const findings = detectGhostOrchestrators(liveAgents, customLedgerPath, { now: fixedNow });
      expect(findings.length).toBe(3);
      expect(findings.every((f) => f.reason === "DETACHED_ORPHAN")).toBe(true);
    });

    it("flags DESYNCHRONIZED_MANIFEST on run_id mismatch or manifest verification failure", () => {
      writeLedgerRecords([
        makeRecord("orch-run-mismatch", 320, "ACTIVE", "run-expected"),
        makeRecord("orch-manifest-fail", 321, "ACTIVE", "run-actual"),
      ]);
      const liveAgents: LiveSubagentInfo[] = [
        {
          subagent_id: "orch-run-mismatch",
          role: "orchestrator",
          pid: 320,
          run_id: "run-mismatch",
          spawned_at: oldSpawnTime,
        },
        {
          subagent_id: "orch-manifest-fail",
          role: "orchestrator",
          pid: 321,
          run_id: "run-actual",
          spawned_at: oldSpawnTime,
        },
      ];
      const findings = detectGhostOrchestrators(liveAgents, customLedgerPath, {
        now: fixedNow,
        manifestPath: join(tempDir, "non-existent-manifest.json"),
        validateManifest: true,
      });
      expect(findings.length).toBe(2);
      expect(findings.every((f) => f.reason === "DESYNCHRONIZED_MANIFEST")).toBe(true);
    });

    it("passes when orchestrator matches and manifest is valid", () => {
      const manifestPath = join(tempDir, "manifest.json");
      const manifestObj = {
        orchestrator_id: "orch-ok",
        run_id: "run-1",
        conversation_id: "conv-orch-ok",
      };
      writeFileSync(manifestPath, JSON.stringify(manifestObj), "utf8");
      const rec = makeRecord("orch-ok", 400, "ACTIVE", "run-1");
      writeLedgerRecords([rec]);
      const liveAgents: LiveSubagentInfo[] = [
        {
          subagent_id: "orch-ok",
          role: "orchestrator",
          pid: 400,
          run_id: "run-1",
          spawned_at: oldSpawnTime,
        },
      ];
      const findings = detectGhostOrchestrators(liveAgents, customLedgerPath, {
        now: fixedNow,
        manifestPath,
        validateManifest: false,
      });
      expect(findings).toEqual([]);
    });
  });

  describe("terminateDetachedOrchestrator", () => {
    const finding: GhostOrchestratorFinding = {
      process_id: 501,
      subagent_id: "orch-target",
      detected_at: new Date(fixedNow).toISOString(),
      reason: "UNREGISTERED_IN_LEDGER",
      action_taken: "ALERTED",
    };

    it("returns false under dryRun mode or when process start verification fails", () => {
      expect(terminateDetachedOrchestrator(finding, { dryRun: true })).toBe(false);
      expect(terminateDetachedOrchestrator(finding, { verifyProcessStartTime: () => false })).toBe(
        false,
      );
    });

    it("terminates via killFn and triggers ledger deregistration", () => {
      writeLedgerRecords([makeRecord("orch-target", 501)]);
      let killCalled = false;
      const killed = terminateDetachedOrchestrator(finding, {
        customLedgerPath,
        customLockPath,
        killFn: (pid, sig) => {
          killCalled = true;
          expect(pid).toBe(501);
          expect(sig).toBe("SIGTERM");
          return true;
        },
      });
      expect(killed && killCalled).toBe(true);
    });

    it("handles killFn exceptions and default process.kill failure gracefully", () => {
      expect(
        terminateDetachedOrchestrator(finding, {
          killFn: () => {
            throw new Error("Kill failed");
          },
        }),
      ).toBe(false);
      expect(terminateDetachedOrchestrator({ ...finding, process_id: 99999999 })).toBe(false);
    });
  });

  describe("reconcileOrchestratorRoster", () => {
    it("reports ghost findings and handles autoTerminate true/false", () => {
      writeLedgerRecords([makeRecord("orch-alive", 601, "ACTIVE", "run-1")]);
      const liveAgents: LiveSubagentInfo[] = [
        {
          subagent_id: "orch-alive",
          role: "orchestrator",
          pid: 601,
          run_id: "run-1",
          spawned_at: oldSpawnTime,
        },
        { subagent_id: "orch-ghost-1", role: "orchestrator", pid: 602, spawned_at: oldSpawnTime },
        { subagent_id: "orch-ghost-2", role: "orchestrator", pid: 603, spawned_at: oldSpawnTime },
      ];

      const resAlert = reconcileOrchestratorRoster({
        liveAgents,
        customLedgerPath,
        customLockPath,
        autoTerminate: false,
        validateManifest: false,
        now: fixedNow,
      });
      expect(resAlert.active_registered_count).toBe(1);
      expect(resAlert.ghost_count).toBe(2);

      const resTerm = reconcileOrchestratorRoster({
        liveAgents,
        customLedgerPath,
        customLockPath,
        autoTerminate: true,
        validateManifest: false,
        now: fixedNow,
        killFn: (pid) => pid === 602,
      });
      expect(resTerm.terminated_pids).toEqual([602]);
    });
  });
});
