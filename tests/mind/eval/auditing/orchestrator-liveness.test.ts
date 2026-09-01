import { afterEach, beforeEach, describe, expect, test, spyOn } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import * as durableWriteModule from "../../../../olt/scripts/src/core/durable-write.ts";
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

describe("Orchestrator Liveness & Zombie Auditor (in-memory virtual)", () => {
  const tempDir = `${process.cwd()}/.olt/virtual-liveness-auditor-test`;
  const ledgerPath = join(tempDir, "orchestrators.jsonl");
  const lockPath = join(tempDir, "orchestrators.lock");
  const capsulesDir = join(tempDir, ".olt", "capsules");
  const mockFiles = new Map<string, string>();
  const mockDirs = new Set<string>();
  const spies: { mockRestore: () => void }[] = [];

  const spawn = (id: string, pid = 10001) => {
    registerOrchestratorSpawn(createInput({ orchestrator_id: id, pid }), ledgerPath, lockPath);
  };
  const audit = (opts: Partial<AuditLivenessOptions> = {}) => {
    return auditOrchestratorLiveness({
      customLedgerPath: ledgerPath,
      customLockPath: lockPath,
      ...opts,
    });
  };
  const reclaim = (id: string) => {
    return reclaimZombieOrchestrator(id, {
      customLedgerPath: ledgerPath,
      customLockPath: lockPath,
    });
  };
  const firstStatus = () => loadOrchestratorLedger(ledgerPath)[0]?.status;

  beforeEach(() => {
    mockFiles.clear();
    mockDirs.clear();
    mockDirs.add(tempDir);
    mockDirs.add(capsulesDir);
    spies.push(
      spyOn(fs, "existsSync").mockImplementation(
        (p) => mockFiles.has(String(p)) || mockDirs.has(String(p)),
      ),
      spyOn(fs, "readdirSync").mockImplementation((p, opt) => {
        const pStr = String(p);
        const dirs = new Set<string>();
        const files = new Set<string>();
        for (const d of mockDirs) {
          if (d.startsWith(pStr) && d !== pStr) {
            const top = d.slice(pStr.length).replace(/^\/+/, "").split("/")[0];
            if (top) dirs.add(top);
          }
        }
        for (const f of mockFiles.keys()) {
          if (f.startsWith(pStr)) {
            const top = f.slice(pStr.length).replace(/^\/+/, "").split("/")[0];
            if (top && !dirs.has(top)) files.add(top);
          }
        }
        const withT =
          typeof opt === "object" &&
          opt !== null &&
          Boolean((opt as { withFileTypes?: boolean }).withFileTypes);
        if (withT) {
          return [
            ...[...dirs].map((name) => ({ name, isDirectory: () => true, isFile: () => false })),
            ...[...files].map((name) => ({ name, isDirectory: () => false, isFile: () => true })),
          ] as unknown as fs.Dirent[];
        }
        return [...dirs, ...files] as unknown as fs.Dirent[];
      }),
      spyOn(fs, "readFileSync").mockImplementation((p) => {
        const val = mockFiles.get(String(p));
        if (val !== undefined) return val;
        throw new Error(`ENOENT: no such file, open '${String(p)}'`);
      }),
      spyOn(fs, "writeFileSync").mockImplementation((p, d) => {
        mockFiles.set(
          String(p),
          typeof d === "string" ? d : Buffer.from(d as Uint8Array).toString("utf-8"),
        );
      }),
      spyOn(fs, "mkdirSync").mockImplementation((p) => {
        mockDirs.add(String(p));
        return undefined as unknown as string;
      }),
      spyOn(fs, "openSync").mockImplementation(() => 100),
      spyOn(fs, "closeSync").mockImplementation(() => undefined),
      spyOn(durableWriteModule, "atomicWriteBytes").mockImplementation((tp, bytes) => {
        mockFiles.set(tp, new TextDecoder().decode(bytes));
      }),
    );
  });

  afterEach(() => {
    while (spies.length > 0) spies.pop()?.mockRestore();
  });

  describe("constants and helpers", () => {
    test("exports standard defaults", () => {
      expect(DEFAULT_HEARTBEAT_THRESHOLD_SECONDS).toBe(300);
      expect(DEFAULT_SINGLETON_ROLE).toBe("skill_auditor");
      expect(ORCHESTRATOR_LIVENESS_DEFECT).toBe("ORCHESTRATOR_LIVENESS_DEFECT");
    });
    test("defaultIsPidAlive returns true for current process and false for invalid PID", () => {
      expect(defaultIsPidAlive(process.pid)).toBe(true);
      expect(defaultIsPidAlive(-1)).toBe(false);
      expect(defaultIsPidAlive(0)).toBe(false);
      expect(defaultIsPidAlive(9999999)).toBe(false);
    });
  });

  describe("reclaimZombieOrchestrator", () => {
    test("transitions existing orchestrator to ZOMBIE_RECLAIMED", () => {
      spawn("orch-target");
      expect(reclaim("orch-target")).toBe(true);
      expect(firstStatus()).toBe("ZOMBIE_RECLAIMED");
    });
    test("returns false for non-existent or empty orchestrator ID", () => {
      expect(reclaim("non-existent")).toBe(false);
      expect(reclaim("")).toBe(false);
    });
  });

  describe("zombie detection and reclamation", () => {
    test("detects and reclaims orchestrator with dead PID", () => {
      spawn("orch-dead", 99999);
      const rep = audit({ isPidAliveFn: (pid) => pid !== 99999, now: "2026-08-29T12:00:00.000Z" });
      expect(rep.zombies_reclaimed).toEqual(["orch-dead"]);
      expect(rep.total_active_orchestrators).toBe(0);
      expect(rep.error_code).toBe(ORCHESTRATOR_LIVENESS_DEFECT);
      expect(firstStatus()).toBe("ZOMBIE_RECLAIMED");
    });

    test("detects and reclaims orchestrator with stale heartbeat (> 300s)", () => {
      spawn("orch-stale", 10002);
      const rep = audit({
        isPidAliveFn: () => true,
        heartbeatThresholdSeconds: 300,
        now: new Date(Date.now() + 301 * 1000),
      });
      expect(rep.zombies_reclaimed).toEqual(["orch-stale"]);
      expect(rep.total_active_orchestrators).toBe(0);
      expect(firstStatus()).toBe("ZOMBIE_RECLAIMED");
    });

    test("retains healthy active orchestrator without mutation", () => {
      spawn("orch-healthy", 10003);
      const rep = audit({
        isPidAliveFn: () => true,
        heartbeatThresholdSeconds: 300,
        now: new Date(),
      });
      expect(rep.zombies_reclaimed).toEqual([]);
      expect(rep.total_active_orchestrators).toBe(1);
      expect(rep.error_code).toBeUndefined();
      expect(firstStatus()).toBe("ACTIVE");
    });

    test("reclaims dead PID and stale heartbeat while preserving healthy ones in mixed roster", () => {
      const killed: number[] = [];
      spawn("orch-1-healthy", 101);
      spawn("orch-2-deadpid", 102);
      spawn("orch-3-stale", 103);
      const rep = audit({
        isPidAliveFn: (pid) => pid !== 102,
        killFn: (pid) => {
          killed.push(pid);
          return true;
        },
        heartbeatThresholdSeconds: 300,
        now: new Date(Date.now() + 500 * 1000),
      });
      expect(rep.zombies_reclaimed).toHaveLength(3);
      expect(rep.total_active_orchestrators).toBe(0);
    });
  });

  describe("multi-capsule discovery and ghost detection", () => {
    test("detects detached orchestrator in isolated capsule directory", () => {
      const cap1 = join(capsulesDir, "capsule-alpha");
      mockDirs.add(cap1);
      mockFiles.set(
        join(cap1, "manifest.json"),
        JSON.stringify({ pid: 8888, orchestrator_id: "orch-alpha-detached" }),
      );
      const rep = audit({ capsulesRootDir: capsulesDir, isPidAliveFn: (pid) => pid === 8888 });
      expect(rep.ghost_processes_found).toHaveLength(1);
      expect(rep.ghost_processes_found[0]?.subagent_id).toBe("orch-alpha-detached");
      expect(rep.ghost_processes_found[0]?.reason).toBe("DETACHED_ORPHAN");
      expect(rep.error_code).toBe(ORCHESTRATOR_LIVENESS_DEFECT);
    });

    test("detects ghost orchestrator from live agents list unregistered in ledger", () => {
      const liveAgents: LiveSubagentInfo[] = [
        { subagent_id: "ghost-orch-99", role: "orchestrator", pid: 9001, status: "ACTIVE" },
      ];
      const rep = audit({ liveAgents, isPidAliveFn: () => true });
      expect(rep.ghost_processes_found).toHaveLength(1);
      expect(rep.ghost_processes_found[0]?.subagent_id).toBe("ghost-orch-99");
      expect(rep.ghost_processes_found[0]?.reason).toBe("UNREGISTERED_IN_LEDGER");
      expect(rep.error_code).toBe(ORCHESTRATOR_LIVENESS_DEFECT);
    });
  });

  describe("singleton auditor compliance", () => {
    test("passes compliance when 0 or 1 active skill_auditor exists", () => {
      expect(audit({ liveAgents: [] }).singleton_auditor_compliant).toBe(true);
      const singleAuditor: LiveSubagentInfo[] = [
        { subagent_id: "auditor-01", role: "skill_auditor", pid: 501, status: "ACTIVE" },
        { subagent_id: "worker-01", role: "worker", pid: 502, status: "ACTIVE" },
      ];
      expect(audit({ liveAgents: singleAuditor }).singleton_auditor_compliant).toBe(true);
    });

    test("fails compliance when > 1 active skill_auditor exists", () => {
      const multipleAuditors: LiveSubagentInfo[] = [
        { subagent_id: "auditor-01", role: "skill_auditor", pid: 601, status: "ACTIVE" },
        { subagent_id: "auditor-02", role: "skill_auditor", pid: 602, status: "ACTIVE" },
      ];
      expect(audit({ liveAgents: multipleAuditors }).singleton_auditor_compliant).toBe(false);
    });
  });
});
