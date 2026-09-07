import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  DEFAULT_ORCHESTRATOR_LEDGER_FILE,
  DEFAULT_ORCHESTRATOR_LOCK_FILE,
  deregisterOrchestrator,
  isValidHostType,
  isValidStatus,
  loadOrchestratorLedger,
  parseRecord,
  registerOrchestratorSpawn,
  updateOrchestratorHeartbeat,
  validateNewOrchestratorInput,
  withOrchestratorLedgerLock,
  type NewOrchestratorRecordInput,
  type OrchestratorRegistrationRecord,
} from "../../../../olt/scripts/src/mind/lifecycle/orchestration/orchestrator-ledger.ts";
import {
  cleanupVirtualMindFS,
  scratchRoot,
  setupVirtualMindFS,
} from "../../fixtures/mind-fixture.ts";

function createValidInput(
  partial: Partial<NewOrchestratorRecordInput> = {},
): NewOrchestratorRecordInput {
  return {
    orchestrator_id: "orch-asm-1",
    run_id: "run-asm-1",
    conversation_id: "conv-asm-1",
    pid: 12345,
    host_type: "antigravity",
    status: "ACTIVE",
    manifest_sha256: "abcdef1234567890abcdef1234567890",
    ...partial,
  };
}

describe("Mind Assembly Lifecycle Orchestrator Ledger Suite", () => {
  let testDir: string;
  let ledgerPath: string;
  let lockPath: string;

  beforeEach(() => {
    setupVirtualMindFS();
    testDir = scratchRoot("orchestrator-ledger");
    ledgerPath = path.join(testDir, ".olt", "orchestrators.jsonl");
    lockPath = path.join(testDir, ".olt", "locks", "orchestrators.lock");
  });

  afterEach(() => {
    cleanupVirtualMindFS();
  });

  describe("Validation & Parsing", () => {
    it("validates host types and lifecycle statuses according to enum constraints", () => {
      expect(isValidHostType("antigravity")).toBe(true);
      expect(isValidHostType("claude_code")).toBe(true);
      expect(isValidHostType("codex")).toBe(true);
      expect(isValidHostType("cursor")).toBe(true);
      expect(isValidHostType("unknown")).toBe(false);
      expect(isValidHostType(null)).toBe(false);

      expect(isValidStatus("INITIALIZING")).toBe(true);
      expect(isValidStatus("ACTIVE")).toBe(true);
      expect(isValidStatus("COMPLETED")).toBe(true);
      expect(isValidStatus("FAILED")).toBe(true);
      expect(isValidStatus("ZOMBIE_RECLAIMED")).toBe(true);
      expect(isValidStatus("GHOST_TERMINATED")).toBe(true);
      expect(isValidStatus("NOT_A_STATUS")).toBe(false);
    });

    it("validates new orchestrator input and rejects missing or malformed fields", () => {
      expect(() =>
        validateNewOrchestratorInput(null as unknown as NewOrchestratorRecordInput),
      ).toThrow(HarnessError);
      expect(() =>
        validateNewOrchestratorInput(createValidInput({ orchestrator_id: "  " })),
      ).toThrow(HarnessError);
      expect(() => validateNewOrchestratorInput(createValidInput({ run_id: "" }))).toThrow(
        HarnessError,
      );
      expect(() => validateNewOrchestratorInput(createValidInput({ conversation_id: "" }))).toThrow(
        HarnessError,
      );
      expect(() => validateNewOrchestratorInput(createValidInput({ pid: 0 }))).toThrow(
        HarnessError,
      );
      expect(() => validateNewOrchestratorInput(createValidInput({ pid: -5 }))).toThrow(
        HarnessError,
      );
      expect(() => validateNewOrchestratorInput(createValidInput({ pid: 1.5 }))).toThrow(
        HarnessError,
      );
      expect(() =>
        validateNewOrchestratorInput(
          createValidInput({ host_type: "invalid" as unknown as "antigravity" }),
        ),
      ).toThrow(HarnessError);
      expect(() => validateNewOrchestratorInput(createValidInput({ manifest_sha256: "" }))).toThrow(
        HarnessError,
      );
      expect(() =>
        validateNewOrchestratorInput(
          createValidInput({ status: "UNKNOWN" as unknown as "ACTIVE" }),
        ),
      ).toThrow(HarnessError);
    });

    it("parses valid record objects and rejects corrupted or incomplete entries", () => {
      const validRecord: OrchestratorRegistrationRecord = {
        orchestrator_id: "orch-1",
        run_id: "run-1",
        conversation_id: "conv-1",
        pid: 9999,
        host_type: "cursor",
        spawned_at: "2026-09-01T00:00:00.000Z",
        status: "ACTIVE",
        manifest_sha256: "hash-12345",
        last_heartbeat_at: "2026-09-01T00:01:00.000Z",
      };

      const parsed = parseRecord(validRecord, 1);
      expect(parsed.orchestrator_id).toBe("orch-1");
      expect(parsed.host_type).toBe("cursor");

      expect(() => parseRecord("not an object", 2)).toThrow(HarnessError);
      expect(() => parseRecord([], 3)).toThrow(HarnessError);
      expect(() => parseRecord({ ...validRecord, pid: 0 }, 4)).toThrow(HarnessError);
      expect(() => parseRecord({ ...validRecord, orchestrator_id: "" }, 5)).toThrow(HarnessError);
      expect(() => parseRecord({ ...validRecord, status: "INVALID" }, 6)).toThrow(HarnessError);
      expect(() =>
        parseRecord({ ...validRecord, status: undefined as unknown as "ACTIVE" }, 7),
      ).toThrow(HarnessError);
      expect(() =>
        parseRecord({ ...validRecord, host_type: "unsupported" as unknown as "cursor" }, 8),
      ).toThrow(HarnessError);
    });
  });

  describe("Ledger Storage & Locks", () => {
    it("returns empty array when ledger file is missing", () => {
      const nonExistent = path.join(testDir, "does-not-exist.jsonl");
      expect(loadOrchestratorLedger(nonExistent)).toEqual([]);
    });

    it("safely ignores empty lines, whitespace-only lines, and trailing newlines", () => {
      const validLine = JSON.stringify({
        orchestrator_id: "orch-ws",
        run_id: "run-ws",
        conversation_id: "conv-ws",
        pid: 111,
        host_type: "cursor",
        spawned_at: "2026-09-01T00:00:00.000Z",
        status: "ACTIVE",
        manifest_sha256: "hash-ws",
        last_heartbeat_at: "2026-09-01T00:00:00.000Z",
      });
      fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
      fs.writeFileSync(ledgerPath, `\n   \n${validLine}\n\n   \t  \n`, "utf8");
      const records = loadOrchestratorLedger(ledgerPath);
      expect(records).toHaveLength(1);
      expect(records[0]?.orchestrator_id).toBe("orch-ws");
    });

    it("throws INTEGRITY error when ledger line is invalid JSON or malformed schema", () => {
      fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
      fs.writeFileSync(ledgerPath, "invalid json string\n", "utf8");
      expect(() => loadOrchestratorLedger(ledgerPath)).toThrow(HarnessError);

      fs.writeFileSync(ledgerPath, '{"orchestrator_id":"incomplete"}\n', "utf8");
      expect(() => loadOrchestratorLedger(ledgerPath)).toThrow(HarnessError);
    });

    it("executes critical blocks within withOrchestratorLedgerLock in VirtualMemoryFS", () => {
      const result = withOrchestratorLedgerLock(lockPath, () => {
        expect(fs.existsSync(lockPath)).toBe(true);
        return "lock-acquired-successfully";
      });
      expect(result).toBe("lock-acquired-successfully");
    });
  });

  describe("Registration, Heartbeat, and Deregistration Lifecycle", () => {
    it("registers new orchestrator spawn and writes to VirtualMemoryFS ledger", () => {
      const input = createValidInput({ orchestrator_id: "orch-alpha", pid: 1001 });
      const record = registerOrchestratorSpawn(input, ledgerPath, lockPath);

      expect(record.orchestrator_id).toBe("orch-alpha");
      expect(record.pid).toBe(1001);
      expect(record.status).toBe("ACTIVE");
      expect(record.spawned_at).toBeDefined();
      expect(record.last_heartbeat_at).toBeDefined();

      const ledger = loadOrchestratorLedger(ledgerPath);
      expect(ledger).toHaveLength(1);
      expect(ledger[0]?.orchestrator_id).toBe("orch-alpha");
    });

    it("updates existing record when re-registering with the same PID", () => {
      const input1 = createValidInput({
        orchestrator_id: "orch-beta",
        pid: 2002,
        run_id: "run-init",
      });
      const rec1 = registerOrchestratorSpawn(input1, ledgerPath, lockPath);

      const inputUpdated = createValidInput({
        orchestrator_id: "orch-beta",
        pid: 2002,
        run_id: "run-next",
        manifest_sha256: "updated-hash-999",
      });
      const rec2 = registerOrchestratorSpawn(inputUpdated, ledgerPath, lockPath);

      expect(rec2.run_id).toBe("run-next");
      expect(rec2.manifest_sha256).toBe("updated-hash-999");
      expect(rec2.spawned_at).toBe(rec1.spawned_at);

      const ledger = loadOrchestratorLedger(ledgerPath);
      expect(ledger).toHaveLength(1);
      expect(ledger[0]?.run_id).toBe("run-next");
    });

    it("throws HarnessError when re-registering an active orchestrator with a conflicting PID", () => {
      const input1 = createValidInput({ orchestrator_id: "orch-gamma", pid: 3003 });
      registerOrchestratorSpawn(input1, ledgerPath, lockPath);

      const conflictInput = createValidInput({ orchestrator_id: "orch-gamma", pid: 4004 });
      expect(() => registerOrchestratorSpawn(conflictInput, ledgerPath, lockPath)).toThrow(
        HarnessError,
      );
    });

    it("replaces or reactivates orchestrator when previous instance is inactive", () => {
      const input1 = createValidInput({
        orchestrator_id: "orch-delta",
        pid: 5001,
        status: "ACTIVE",
      });
      registerOrchestratorSpawn(input1, ledgerPath, lockPath);

      deregisterOrchestrator("orch-delta", "COMPLETED", ledgerPath, lockPath);

      const inputNew = createValidInput({
        orchestrator_id: "orch-delta",
        pid: 5002,
        status: "ACTIVE",
      });
      const recNew = registerOrchestratorSpawn(inputNew, ledgerPath, lockPath);

      expect(recNew.pid).toBe(5002);
      expect(recNew.status).toBe("ACTIVE");

      const ledger = loadOrchestratorLedger(ledgerPath);
      expect(ledger).toHaveLength(1);
      expect(ledger[0]?.pid).toBe(5002);
    });

    it("updates heartbeat timestamp for existing active orchestrator", () => {
      const input = createValidInput({ orchestrator_id: "orch-hb", pid: 6001 });
      const created = registerOrchestratorSpawn(input, ledgerPath, lockPath);

      const updated = updateOrchestratorHeartbeat("orch-hb", ledgerPath, lockPath);
      expect(updated).not.toBeNull();
      expect(updated?.orchestrator_id).toBe("orch-hb");
      expect(updated?.last_heartbeat_at).toBeDefined();

      expect(updateOrchestratorHeartbeat("", ledgerPath, lockPath)).toBeNull();
      expect(updateOrchestratorHeartbeat("nonexistent-id", ledgerPath, lockPath)).toBeNull();
    });

    it("deregisters orchestrator to terminal status and validates status transitions", () => {
      const input = createValidInput({ orchestrator_id: "orch-dereg", pid: 7001 });
      registerOrchestratorSpawn(input, ledgerPath, lockPath);

      const deregResult = deregisterOrchestrator("orch-dereg", "COMPLETED", ledgerPath, lockPath);
      expect(deregResult).not.toBeNull();
      expect(deregResult?.status).toBe("COMPLETED");

      const ledger = loadOrchestratorLedger(ledgerPath);
      expect(ledger[0]?.status).toBe("COMPLETED");

      expect(deregisterOrchestrator("", "COMPLETED", ledgerPath, lockPath)).toBeNull();
      expect(
        deregisterOrchestrator("nonexistent-id", "COMPLETED", ledgerPath, lockPath),
      ).toBeNull();
      expect(() =>
        deregisterOrchestrator(
          "orch-dereg",
          "INVALID_TERMINAL" as unknown as "COMPLETED",
          ledgerPath,
          lockPath,
        ),
      ).toThrow(HarnessError);
    });
  });
});
