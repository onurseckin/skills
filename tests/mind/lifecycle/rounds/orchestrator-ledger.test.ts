import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
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
} from "../../../../olt/scripts/src/mind/lifecycle/orchestration/orchestrator-ledger.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";

function createValidInput(
  partial: Partial<NewOrchestratorRecordInput> = {},
): NewOrchestratorRecordInput {
  return {
    orchestrator_id: "orch-test-1",
    run_id: "run-test-1",
    conversation_id: "conv-test-1",
    pid: 12345,
    host_type: "antigravity",
    status: "ACTIVE",
    manifest_sha256: "abcdef1234567890",
    ...partial,
  };
}

describe("Orchestrator Ledger Suite (orchestrator-ledger.ts)", () => {
  describe("Type Validators & Record Parsers", () => {
    it("validates host types and lifecycle statuses", () => {
      expect(isValidHostType("antigravity")).toBe(true);
      expect(isValidHostType("claude_code")).toBe(true);
      expect(isValidHostType("unknown")).toBe(false);
      expect(isValidHostType(123)).toBe(false);

      expect(isValidStatus("ACTIVE")).toBe(true);
      expect(isValidStatus("INITIALIZING")).toBe(true);
      expect(isValidStatus("ZOMBIE_RECLAIMED")).toBe(true);
      expect(isValidStatus("INVALID_STATUS")).toBe(false);
    });

    it("validates new orchestrator input and throws on invalid fields", () => {
      expect(() =>
        validateNewOrchestratorInput(null as unknown as NewOrchestratorRecordInput),
      ).toThrow(HarnessError);
      expect(() => validateNewOrchestratorInput(createValidInput({ orchestrator_id: "" }))).toThrow(
        HarnessError,
      );
      expect(() => validateNewOrchestratorInput(createValidInput({ run_id: "  " }))).toThrow(
        HarnessError,
      );
      expect(() => validateNewOrchestratorInput(createValidInput({ conversation_id: "" }))).toThrow(
        HarnessError,
      );
      expect(() => validateNewOrchestratorInput(createValidInput({ pid: 0 }))).toThrow(
        HarnessError,
      );
      expect(() => validateNewOrchestratorInput(createValidInput({ pid: -10 }))).toThrow(
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
        validateNewOrchestratorInput(createValidInput({ status: "BAD" as unknown as "ACTIVE" })),
      ).toThrow(HarnessError);
    });

    it("parses valid and invalid raw ledger records", () => {
      const validRaw = {
        orchestrator_id: "orch-1",
        run_id: "run-1",
        conversation_id: "conv-1",
        pid: 999,
        host_type: "cursor",
        spawned_at: "2026-09-01T00:00:00Z",
        status: "ACTIVE",
        manifest_sha256: "sha-123",
        last_heartbeat_at: "2026-09-01T00:01:00Z",
      };
      const parsed = parseRecord(validRaw, 1);
      expect(parsed.orchestrator_id).toBe("orch-1");

      expect(() => parseRecord("not-an-object", 1)).toThrow(HarnessError);
      expect(() => parseRecord({ ...validRaw, pid: 0 }, 1)).toThrow(HarnessError);
    });
  });

  describe("Ledger File Operations & Lock Mechanism", () => {
    it("reads empty ledger when file does not exist or uses default path", () => {
      const nonExistent = join(tmpdir(), `missing-ledger-${Date.now()}.jsonl`);
      expect(loadOrchestratorLedger(nonExistent)).toEqual([]);
      expect(Array.isArray(loadOrchestratorLedger())).toBe(true);
    });

    it("throws INTEGRITY error when ledger file contains invalid JSON lines or invalid schemas", () => {
      const testDir = join(tmpdir(), `corrupt-ledger-${Date.now()}`);
      mkdirSync(testDir, { recursive: true });
      const badSyntax = join(testDir, "bad-syntax.jsonl");
      writeFileSync(badSyntax, "this is not valid json\n");

      const badSchema = join(testDir, "bad-schema.jsonl");
      writeFileSync(badSchema, '{"orchestrator_id": "bad"}\n');

      try {
        expect(() => loadOrchestratorLedger(badSyntax)).toThrow(HarnessError);
        expect(() => loadOrchestratorLedger(badSchema)).toThrow(HarnessError);
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it("executes functions under withOrchestratorLedgerLock", () => {
      const lockPath = join(tmpdir(), `lock-test-${Date.now()}.lock`);
      const val = withOrchestratorLedgerLock(lockPath, () => 42);
      expect(val).toBe(42);
    });
  });

  describe("Orchestrator Registration, Heartbeat, and Deregistration", () => {
    it("registers new orchestrator and handles re-registration with same and different pids", () => {
      const testDir = join(tmpdir(), `ledger-crud-${Date.now()}`);
      mkdirSync(testDir, { recursive: true });
      const ledger = join(testDir, ".olt", "orchestrators.jsonl");
      const lock = join(testDir, ".olt", "locks", "orchestrators.lock");

      try {
        const input1 = createValidInput({ orchestrator_id: "orch-alpha", pid: 100 });
        const rec1 = registerOrchestratorSpawn(input1, ledger, lock);
        expect(rec1.orchestrator_id).toBe("orch-alpha");
        expect(rec1.status).toBe("ACTIVE");

        const inputSamePid = createValidInput({
          orchestrator_id: "orch-alpha",
          pid: 100,
          run_id: "run-2",
        });
        const recUpdated = registerOrchestratorSpawn(inputSamePid, ledger, lock);
        expect(recUpdated.run_id).toBe("run-2");
        expect(recUpdated.spawned_at).toBe(rec1.spawned_at);

        const inputDiffPid = createValidInput({ orchestrator_id: "orch-alpha", pid: 200 });
        expect(() => registerOrchestratorSpawn(inputDiffPid, ledger, lock)).toThrow(HarnessError);

        const hbRec = updateOrchestratorHeartbeat("orch-alpha", ledger, lock);
        expect(hbRec).not.toBeNull();
        expect(hbRec?.orchestrator_id).toBe("orch-alpha");

        const deregRec = deregisterOrchestrator("orch-alpha", "COMPLETED", ledger, lock);
        expect(deregRec?.status).toBe("COMPLETED");

        const inputNewSpawn = createValidInput({ orchestrator_id: "orch-alpha", pid: 300 });
        const recReplaced = registerOrchestratorSpawn(inputNewSpawn, ledger, lock);
        expect(recReplaced.pid).toBe(300);
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it("handles no-op and edge cases for heartbeat and deregistration", () => {
      const testDir = join(tmpdir(), `ledger-edge-${Date.now()}`);
      mkdirSync(testDir, { recursive: true });
      const ledger = join(testDir, "custom", "orchestrators.jsonl");

      try {
        expect(updateOrchestratorHeartbeat("", ledger)).toBeNull();
        expect(updateOrchestratorHeartbeat("non-existent", ledger)).toBeNull();
        expect(deregisterOrchestrator("  ", "COMPLETED", ledger)).toBeNull();
        expect(deregisterOrchestrator("non-existent", "FAILED", ledger)).toBeNull();
        expect(() =>
          deregisterOrchestrator("orch-x", "BAD_STATUS" as unknown as "FAILED", ledger),
        ).toThrow(HarnessError);
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });
  });
});
