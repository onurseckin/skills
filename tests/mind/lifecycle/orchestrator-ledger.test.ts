import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  DEFAULT_ORCHESTRATOR_LOCK_FILE,
  deregisterOrchestrator,
  loadOrchestratorLedger,
  registerOrchestratorSpawn,
  updateOrchestratorHeartbeat,
  withOrchestratorLedgerLock,
  type NewOrchestratorRecordInput,
  type OrchestratorLifecycleStatus,
} from "../../../../olt/scripts/src/mind/lifecycle/orchestrator-ledger.ts";

function createValidInput(
  overrides: Partial<NewOrchestratorRecordInput> = {},
): NewOrchestratorRecordInput {
  return {
    orchestrator_id: "orch-test-01",
    run_id: "run-abc-123",
    conversation_id: "conv-xyz-789",
    pid: 12345,
    host_type: "antigravity",
    manifest_sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    ...overrides,
  };
}

describe("Orchestrator Epistemic Lifecycle Ledger", () => {
  let tempDir: string;
  let ledgerPath: string;
  let lockPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "orch-ledger-test-"));
    ledgerPath = join(tempDir, "orchestrators.jsonl");
    lockPath = join(tempDir, "orchestrators.lock");
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe("registration validation", () => {
    test("missing or empty PID throws INVALID_REGISTRATION_RECORD", () => {
      expect(() =>
        registerOrchestratorSpawn({ ...createValidInput(), pid: 0 }, ledgerPath, lockPath),
      ).toThrow(/INVALID_REGISTRATION_RECORD.*pid must be a positive integer/);

      expect(() =>
        registerOrchestratorSpawn({ ...createValidInput(), pid: -10 }, ledgerPath, lockPath),
      ).toThrow(/INVALID_REGISTRATION_RECORD.*pid must be a positive integer/);
    });

    test("missing or empty conversation_id throws INVALID_REGISTRATION_RECORD", () => {
      expect(() =>
        registerOrchestratorSpawn(
          { ...createValidInput(), conversation_id: "" },
          ledgerPath,
          lockPath,
        ),
      ).toThrow(/INVALID_REGISTRATION_RECORD.*conversation_id must be a non-empty string/);
    });

    test("missing or empty run_id throws INVALID_REGISTRATION_RECORD", () => {
      expect(() =>
        registerOrchestratorSpawn({ ...createValidInput(), run_id: "   " }, ledgerPath, lockPath),
      ).toThrow(/INVALID_REGISTRATION_RECORD.*run_id must be a non-empty string/);
    });

    test("missing or empty orchestrator_id throws INVALID_REGISTRATION_RECORD", () => {
      expect(() =>
        registerOrchestratorSpawn(
          { ...createValidInput(), orchestrator_id: "" },
          ledgerPath,
          lockPath,
        ),
      ).toThrow(/INVALID_REGISTRATION_RECORD.*orchestrator_id must be a non-empty string/);
    });

    test("invalid host_type throws INVALID_REGISTRATION_RECORD", () => {
      const invalidInput = {
        ...createValidInput(),
        host_type: "unsupported" as unknown as "antigravity",
      };
      expect(() => registerOrchestratorSpawn(invalidInput, ledgerPath, lockPath)).toThrow(
        /INVALID_REGISTRATION_RECORD.*host_type must be one of/,
      );
    });

    test("missing or empty manifest_sha256 throws INVALID_REGISTRATION_RECORD", () => {
      expect(() =>
        registerOrchestratorSpawn(
          { ...createValidInput(), manifest_sha256: "" },
          ledgerPath,
          lockPath,
        ),
      ).toThrow(/INVALID_REGISTRATION_RECORD.*manifest_sha256 must be a non-empty string/);
    });

    test("invalid status throws INVALID_REGISTRATION_RECORD", () => {
      const invalidInput = {
        ...createValidInput(),
        status: "INVALID_STATUS" as unknown as OrchestratorLifecycleStatus,
      };
      expect(() => registerOrchestratorSpawn(invalidInput, ledgerPath, lockPath)).toThrow(
        /INVALID_REGISTRATION_RECORD.*status is not a valid/,
      );
    });
  });

  describe("registration success and ledger reading", () => {
    test("registers a new orchestrator and loads it from ledger", () => {
      const input = createValidInput();
      const record = registerOrchestratorSpawn(input, ledgerPath, lockPath);

      expect(record.orchestrator_id).toBe("orch-test-01");
      expect(record.status).toBe("ACTIVE");
      expect(record.pid).toBe(12345);
      expect(record.host_type).toBe("antigravity");
      expect(Number.isFinite(Date.parse(record.spawned_at))).toBe(true);
      expect(Number.isFinite(Date.parse(record.last_heartbeat_at))).toBe(true);

      const loaded = loadOrchestratorLedger(ledgerPath);
      expect(loaded).toHaveLength(1);
      expect(loaded[0]).toEqual(record);
    });

    test("registers multiple orchestrators sequentially", () => {
      registerOrchestratorSpawn(
        createValidInput({ orchestrator_id: "orch-01", pid: 101 }),
        ledgerPath,
        lockPath,
      );
      registerOrchestratorSpawn(
        createValidInput({ orchestrator_id: "orch-02", pid: 102 }),
        ledgerPath,
        lockPath,
      );
      registerOrchestratorSpawn(
        createValidInput({ orchestrator_id: "orch-03", pid: 103 }),
        ledgerPath,
        lockPath,
      );

      const loaded = loadOrchestratorLedger(ledgerPath);
      expect(loaded).toHaveLength(3);
      expect(loaded.map((r) => r.orchestrator_id)).toEqual(["orch-01", "orch-02", "orch-03"]);
    });

    test("idempotently updates same active orchestrator if PID matches", () => {
      registerOrchestratorSpawn(
        createValidInput({ orchestrator_id: "orch-01", pid: 200 }),
        ledgerPath,
        lockPath,
      );
      const updated = registerOrchestratorSpawn(
        createValidInput({ orchestrator_id: "orch-01", pid: 200, manifest_sha256: "new-hash" }),
        ledgerPath,
        lockPath,
      );
      expect(updated.manifest_sha256).toBe("new-hash");

      const loaded = loadOrchestratorLedger(ledgerPath);
      expect(loaded).toHaveLength(1);
      expect(loaded[0]?.manifest_sha256).toBe("new-hash");
    });

    test("rejects active registration if already active with a different PID", () => {
      registerOrchestratorSpawn(
        createValidInput({ orchestrator_id: "orch-01", pid: 300 }),
        ledgerPath,
        lockPath,
      );
      expect(() =>
        registerOrchestratorSpawn(
          createValidInput({ orchestrator_id: "orch-01", pid: 301 }),
          ledgerPath,
          lockPath,
        ),
      ).toThrow(/INVALID_REGISTRATION_RECORD.*already active with different pid/);
    });

    test("allows re-registering an orchestrator that is in terminal status", () => {
      registerOrchestratorSpawn(
        createValidInput({ orchestrator_id: "orch-01", pid: 400 }),
        ledgerPath,
        lockPath,
      );
      deregisterOrchestrator("orch-01", "COMPLETED", ledgerPath, lockPath);

      const reRegistered = registerOrchestratorSpawn(
        createValidInput({ orchestrator_id: "orch-01", pid: 401 }),
        ledgerPath,
        lockPath,
      );
      expect(reRegistered.status).toBe("ACTIVE");
      expect(reRegistered.pid).toBe(401);

      const loaded = loadOrchestratorLedger(ledgerPath);
      expect(loaded).toHaveLength(1);
      expect(loaded[0]?.status).toBe("ACTIVE");
      expect(loaded[0]?.pid).toBe(401);
    });
  });

  describe("heartbeat update", () => {
    test("updates heartbeat on existing record", async () => {
      const record = registerOrchestratorSpawn(createValidInput(), ledgerPath, lockPath);
      await new Promise((r) => setTimeout(r, 10));

      const updated = updateOrchestratorHeartbeat("orch-test-01", ledgerPath, lockPath);
      expect(updated).not.toBeNull();
      expect(Date.parse(updated!.last_heartbeat_at)).toBeGreaterThanOrEqual(
        Date.parse(record.last_heartbeat_at),
      );

      const loaded = loadOrchestratorLedger(ledgerPath);
      expect(loaded[0]?.last_heartbeat_at).toBe(updated!.last_heartbeat_at);
    });

    test("returns null when updating non-existent or invalid orchestrator_id", () => {
      expect(updateOrchestratorHeartbeat("non-existent", ledgerPath, lockPath)).toBeNull();
      expect(updateOrchestratorHeartbeat("", ledgerPath, lockPath)).toBeNull();
    });
  });

  describe("deregistration and status update", () => {
    test("deregisters with default status COMPLETED", () => {
      registerOrchestratorSpawn(createValidInput(), ledgerPath, lockPath);
      const dereg = deregisterOrchestrator("orch-test-01", undefined, ledgerPath, lockPath);

      expect(dereg).not.toBeNull();
      expect(dereg!.status).toBe("COMPLETED");

      const loaded = loadOrchestratorLedger(ledgerPath);
      expect(loaded[0]?.status).toBe("COMPLETED");
    });

    test("deregisters with specified status", () => {
      registerOrchestratorSpawn(createValidInput(), ledgerPath, lockPath);
      const dereg = deregisterOrchestrator(
        "orch-test-01",
        "ZOMBIE_RECLAIMED",
        ledgerPath,
        lockPath,
      );

      expect(dereg).not.toBeNull();
      expect(dereg!.status).toBe("ZOMBIE_RECLAIMED");
    });

    test("returns null when deregistering non-existent or empty orchestrator_id", () => {
      expect(deregisterOrchestrator("non-existent", "COMPLETED", ledgerPath, lockPath)).toBeNull();
      expect(deregisterOrchestrator("", "COMPLETED", ledgerPath, lockPath)).toBeNull();
    });

    test("throws INVALID_ARGUMENT when deregistering with invalid status", () => {
      registerOrchestratorSpawn(createValidInput(), ledgerPath, lockPath);
      expect(() =>
        deregisterOrchestrator(
          "orch-test-01",
          "UNKNOWN" as unknown as OrchestratorLifecycleStatus,
          ledgerPath,
          lockPath,
        ),
      ).toThrow(HarnessError);
    });
  });

  describe("concurrent flock locking and custom paths", () => {
    test("withOrchestratorLedgerLock executes and properly releases lock", () => {
      let counter = 0;
      const res1 = withOrchestratorLedgerLock(lockPath, () => {
        counter += 1;
        return "first";
      });
      const res2 = withOrchestratorLedgerLock(lockPath, () => {
        counter += 1;
        return "second";
      });

      expect(res1).toBe("first");
      expect(res2).toBe("second");
      expect(counter).toBe(2);
    });

    test("multiple sequential registrations maintain ledger integrity under flock", () => {
      const count = 10;
      for (let i = 0; i < count; i++) {
        registerOrchestratorSpawn(
          createValidInput({ orchestrator_id: `orch-conc-${i}`, pid: 5000 + i }),
          ledgerPath,
          lockPath,
        );
      }

      const loaded = loadOrchestratorLedger(ledgerPath);
      expect(loaded).toHaveLength(count);
      for (let i = 0; i < count; i++) {
        expect(loaded.some((r) => r.orchestrator_id === `orch-conc-${i}`)).toBe(true);
      }
    });

    test("loadOrchestratorLedger returns empty array for absent file", () => {
      expect(loadOrchestratorLedger(join(tempDir, "absent.jsonl"))).toEqual([]);
    });

    test("loadOrchestratorLedger throws INTEGRITY on corrupt JSON file", () => {
      const corruptPath = join(tempDir, "corrupt.jsonl");
      writeFileSync(corruptPath, "{not-json}\n", "utf8");
      expect(() => loadOrchestratorLedger(corruptPath)).toThrow(/invalid JSON/);
    });

    test("DEFAULT_ORCHESTRATOR_LOCK_FILE points to .olt/locks/orchestrators.lock", () => {
      expect(DEFAULT_ORCHESTRATOR_LOCK_FILE).toBe(".olt/locks/orchestrators.lock");
    });
  });
});
