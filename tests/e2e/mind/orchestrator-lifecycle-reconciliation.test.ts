import { afterEach, describe, expect, it } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  detectGhostOrchestrators,
  loadOrchestratorLedger,
  reconcileOrchestratorRoster,
  registerOrchestratorSpawn,
  syncOrchestratorToManifest,
  updateOrchestratorHeartbeat,
  validateCapsuleManifestBinding,
  type LiveSubagentInfo,
  type NewOrchestratorRecordInput,
} from "../../../olt/scripts/src/mind/lifecycle/index.ts";
import {
  auditOrchestratorLiveness,
  type RosterReconciliationReport,
} from "../../../olt/scripts/src/mind/auditing/index.ts";
import {
  acquireAuditorLeaseLock,
  DUPLICATE_SINGLETON_AUDITOR_MESSAGE,
  rejectDuplicateAuditorSpawn,
  releaseAuditorLeaseLock,
  validateSubagentSpawnRequest,
  type SubagentSpawnRequest,
} from "../../../olt/scripts/src/authority/guards/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("Orchestrator Lifecycle & Singleton Auditor E2E Reconciliation Suite", () => {
  const cleanupDirs: string[] = [];
  afterEach(() => {
    while (cleanupDirs.length > 0) {
      const d = cleanupDirs.pop();
      if (d) {
        try {
          rmSync(d, { recursive: true, force: true });
        } catch {}
      }
    }
  });

  it("executes concurrent spawns, Merkle genesis binding, and heartbeat updates", async () => {
    const root = scratchRoot(import.meta.path, "lifecycle-spawns");
    const ledgerPath = join(root, ".olt", "orchestrators.jsonl");
    const lockPath = join(root, ".olt", "orchestrators.lock");

    const inputs: readonly NewOrchestratorRecordInput[] = [1, 2, 3].map((idx) => ({
      orchestrator_id: `orch-0${idx}`,
      run_id: `run-e2e-00${idx}`,
      conversation_id: `conv-00${idx}`,
      pid: 10000 + idx,
      host_type: "antigravity" as const,
      manifest_sha256: `dummy-pin-${idx}`,
    }));

    const records = await Promise.all(
      inputs.map((inp) => Promise.resolve(registerOrchestratorSpawn(inp, ledgerPath, lockPath))),
    );
    expect(records).toHaveLength(3);
    const onDisk = loadOrchestratorLedger(ledgerPath);
    expect(onDisk).toHaveLength(3);

    for (const record of onDisk) {
      expect(record.status).toBe("ACTIVE");
      const manifestResult = syncOrchestratorToManifest(record, { runRoot: root });
      expect(typeof manifestResult.pin).toBe("string");
      expect(manifestResult.pin.length).toBe(64);

      const registeredWithPin = registerOrchestratorSpawn(
        { ...record, manifest_sha256: manifestResult.pin },
        ledgerPath,
        lockPath,
      );
      const validation = validateCapsuleManifestBinding(registeredWithPin, {
        runRoot: root,
        assert: true,
      });
      expect(validation.valid).toBe(true);
      expect(validation.actualPin).toBe(manifestResult.pin);

      const updated = updateOrchestratorHeartbeat(record.orchestrator_id, ledgerPath, lockPath);
      expect(updated).not.toBeNull();
      if (updated) {
        expect(new Date(updated.last_heartbeat_at).getTime()).toBeGreaterThanOrEqual(
          new Date(record.spawned_at).getTime(),
        );
      }
    }
  });

  it("detects ghost orchestrators and terminates untracked processes safely", () => {
    const root = scratchRoot(import.meta.path, "ghost-reconciliation");
    const ledgerPath = join(root, ".olt", "orchestrators.jsonl");
    const lockPath = join(root, ".olt", "orchestrators.lock");

    const validInputs: readonly NewOrchestratorRecordInput[] = [1, 2, 3].map((idx) => ({
      orchestrator_id: `orch-${idx}`,
      run_id: `run-${idx}`,
      conversation_id: `c-${idx}`,
      pid: 10000 + idx,
      host_type: "antigravity" as const,
      manifest_sha256: `pin-${idx}`,
    }));
    validInputs.forEach((inp) => registerOrchestratorSpawn(inp, ledgerPath, lockPath));

    const liveAgents: readonly LiveSubagentInfo[] = [
      ...validInputs.map((v) => ({
        subagent_id: v.orchestrator_id,
        role: "orchestrator",
        pid: v.pid,
        run_id: v.run_id,
      })),
      { subagent_id: "ghost-1", role: "orchestrator", pid: 20001, conversation_id: "c-ghost-1" },
      { subagent_id: "ghost-2", role: "orchestrator", pid: 20002, conversation_id: "c-ghost-2" },
    ];

    const detected = detectGhostOrchestrators(liveAgents, ledgerPath, { validateManifest: false });
    expect(detected).toHaveLength(2);
    expect(detected.map((f) => f.process_id).sort()).toEqual([20001, 20002]);
    detected.forEach((f) => {
      expect(f.reason).toBe("UNREGISTERED_IN_LEDGER");
      expect(f.action_taken).toBe("ALERTED");
    });

    const killedPids: number[] = [];
    const killFn = (pid: number): boolean => {
      killedPids.push(pid);
      return true;
    };

    const result = reconcileOrchestratorRoster({
      liveAgents,
      customLedgerPath: ledgerPath,
      customLockPath: lockPath,
      autoTerminate: true,
      validateManifest: false,
      killFn,
    });

    expect(result.ghost_count).toBe(2);
    expect(result.active_registered_count).toBe(3);
    expect(result.terminated_pids.slice().sort()).toEqual([20001, 20002]);
    expect(killedPids.slice().sort()).toEqual([20001, 20002]);
    result.findings.forEach((f) => expect(f.action_taken).toBe("TERMINATED"));
    expect(killedPids).not.toContain(10001);
    expect(killedPids).not.toContain(10002);
    expect(killedPids).not.toContain(10003);
  });

  it("audits liveness, reclaims zombies, and generates reconciliation report", () => {
    const root = scratchRoot(import.meta.path, "zombie-reclaim");
    const ledgerPath = join(root, ".olt", "orchestrators.jsonl");
    const lockPath = join(root, ".olt", "orchestrators.lock");

    const healthyRunId = "run-zombie-healthy-1";
    cleanupDirs.push(join(process.cwd(), ".olt", "capsules", healthyRunId));

    const healthyInput: NewOrchestratorRecordInput = {
      orchestrator_id: "orch-healthy-1",
      run_id: healthyRunId,
      conversation_id: "c-h1",
      pid: 10002,
      host_type: "antigravity",
      manifest_sha256: "pending",
    };
    const regHealthy = registerOrchestratorSpawn(healthyInput, ledgerPath, lockPath);
    const syncRes = syncOrchestratorToManifest(regHealthy);
    registerOrchestratorSpawn(
      { ...healthyInput, manifest_sha256: syncRes.pin },
      ledgerPath,
      lockPath,
    );

    registerOrchestratorSpawn(
      {
        orchestrator_id: "orch-zombie-stale",
        run_id: "run-stale",
        conversation_id: "c-stale",
        pid: 10003,
        host_type: "antigravity",
        manifest_sha256: "pin-stale",
      },
      ledgerPath,
      lockPath,
    );

    registerOrchestratorSpawn(
      {
        orchestrator_id: "orch-zombie-dead",
        run_id: "run-dead",
        conversation_id: "c-dead",
        pid: 10001,
        host_type: "antigravity",
        manifest_sha256: "pin-dead",
      },
      ledgerPath,
      lockPath,
    );

    const records = loadOrchestratorLedger(ledgerPath);
    const staleIdx = records.findIndex((r) => r.orchestrator_id === "orch-zombie-stale");
    if (staleIdx >= 0) {
      const ex = records[staleIdx]!;
      records[staleIdx] = {
        ...ex,
        last_heartbeat_at: new Date(Date.now() - 400_000).toISOString(),
      };
      writeFileSync(ledgerPath, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
    }

    const liveAgents: readonly LiveSubagentInfo[] = [
      { subagent_id: "orch-healthy-1", role: "orchestrator", pid: 10002, run_id: healthyRunId },
      {
        subagent_id: "ghost-audit-1",
        role: "orchestrator",
        pid: 20005,
        conversation_id: "c-ghost",
      },
      { subagent_id: "auditor-singleton", role: "skill_auditor", pid: 30001, status: "ACTIVE" },
    ];

    const isPidAliveFn = (pid: number): boolean => pid !== 10001;
    const killedPids: number[] = [];
    const killFn = (pid: number): boolean => {
      killedPids.push(pid);
      return true;
    };

    const report: RosterReconciliationReport = auditOrchestratorLiveness({
      customLedgerPath: ledgerPath,
      customLockPath: lockPath,
      liveAgents,
      isPidAliveFn,
      killFn,
      heartbeatThresholdSeconds: 300,
    });

    expect(report.total_active_orchestrators).toBe(1);
    expect(report.zombies_reclaimed.slice().sort()).toEqual([
      "orch-zombie-dead",
      "orch-zombie-stale",
    ]);
    expect(report.singleton_auditor_compliant).toBe(true);
    expect(report.ghost_processes_found).toHaveLength(1);
    expect(report.ghost_processes_found[0]?.subagent_id).toBe("ghost-audit-1");
    expect(typeof report.timestamp).toBe("string");

    const ledgerAfter = loadOrchestratorLedger(ledgerPath);
    expect(ledgerAfter.find((r) => r.orchestrator_id === "orch-zombie-dead")?.status).toBe(
      "ZOMBIE_RECLAIMED",
    );
    expect(ledgerAfter.find((r) => r.orchestrator_id === "orch-zombie-stale")?.status).toBe(
      "ZOMBIE_RECLAIMED",
    );
    expect(ledgerAfter.find((r) => r.orchestrator_id === "orch-healthy-1")?.status).toBe("ACTIVE");
  });

  it("enforces singleton skill auditor fleet constraint and rejects duplicates", () => {
    const root = scratchRoot(import.meta.path, "singleton-auditor");
    const lockPath = join(root, ".olt", "locks", "skill_auditor.lock");

    const livePids = new Set<number>([30001]);
    const isPidAliveFn = (pid: number): boolean => livePids.has(pid);

    const lease1 = acquireAuditorLeaseLock({
      auditor_id: "auditor-alpha",
      pid: 30001,
      customLockPath: lockPath,
      isPidAliveFn,
    });
    expect(lease1.auditor_id).toBe("auditor-alpha");
    expect(lease1.pid).toBe(30001);

    const dupRequest: SubagentSpawnRequest = { role: "skill_auditor", subagent_id: "auditor-beta" };
    const validation = validateSubagentSpawnRequest(dupRequest, {
      customLockPath: lockPath,
      isPidAliveFn,
    });
    expect(validation.allowed).toBe(false);
    expect(validation.reason).toBe(DUPLICATE_SINGLETON_AUDITOR_MESSAGE);
    expect(validation.active_lease?.auditor_id).toBe("auditor-alpha");

    expect(() =>
      rejectDuplicateAuditorSpawn(dupRequest, { customLockPath: lockPath, isPidAliveFn }),
    ).toThrow(HarnessError);
    try {
      rejectDuplicateAuditorSpawn(dupRequest, { customLockPath: lockPath, isPidAliveFn });
    } catch (err: unknown) {
      expect(err instanceof HarnessError).toBe(true);
      const harnessErr = err as HarnessError;
      expect(harnessErr.code).toBe("ROLE_CONFINEMENT_VIOLATION");
      expect(harnessErr.message).toBe(DUPLICATE_SINGLETON_AUDITOR_MESSAGE);
    }

    const nonAuditorRoles = ["implementer", "validator", "orchestrator", "coordinator"];
    for (const role of nonAuditorRoles) {
      const nonAuditorReq: SubagentSpawnRequest = { role, subagent_id: `sub-${role}-1` };
      const nonAudResult = validateSubagentSpawnRequest(nonAuditorReq, {
        customLockPath: lockPath,
        isPidAliveFn,
      });
      expect(nonAudResult.allowed).toBe(true);
      expect(nonAudResult.active_lease).toBeNull();
      expect(() =>
        rejectDuplicateAuditorSpawn(nonAuditorReq, { customLockPath: lockPath, isPidAliveFn }),
      ).not.toThrow();
    }

    expect(
      releaseAuditorLeaseLock({
        auditor_id: "auditor-alpha",
        lock_token: lease1.lock_token,
        customLockPath: lockPath,
      }),
    ).toBe(true);

    livePids.add(30002);
    const lease2 = acquireAuditorLeaseLock({
      auditor_id: "auditor-beta",
      pid: 30002,
      customLockPath: lockPath,
      isPidAliveFn,
    });
    expect(lease2.auditor_id).toBe("auditor-beta");
    expect(lease2.pid).toBe(30002);

    livePids.delete(30002);
    livePids.add(30003);
    const lease3 = acquireAuditorLeaseLock({
      auditor_id: "auditor-gamma",
      pid: 30003,
      customLockPath: lockPath,
      isPidAliveFn,
    });
    expect(lease3.auditor_id).toBe("auditor-gamma");
    expect(lease3.pid).toBe(30003);
  });
});
