import { closeSync, constants, existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { atomicWriteBytes } from "../../core/durable-write.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { releaseFlock, tryExclusiveFlock } from "../../platform/index.ts";

export type OrchestratorLifecycleStatus =
  | "INITIALIZING"
  | "ACTIVE"
  | "COMPLETED"
  | "FAILED"
  | "ZOMBIE_RECLAIMED"
  | "GHOST_TERMINATED";

export const VALID_LIFECYCLE_STATUSES: readonly OrchestratorLifecycleStatus[] = [
  "INITIALIZING",
  "ACTIVE",
  "COMPLETED",
  "FAILED",
  "ZOMBIE_RECLAIMED",
  "GHOST_TERMINATED",
] as const;

export const VALID_HOST_TYPES = ["antigravity", "claude_code", "codex", "cursor"] as const;
export type OrchestratorHostType = (typeof VALID_HOST_TYPES)[number];

export interface OrchestratorRegistrationRecord {
  readonly orchestrator_id: string;
  readonly run_id: string;
  readonly conversation_id: string;
  readonly pid: number;
  readonly host_type: OrchestratorHostType;
  readonly spawned_at: string;
  readonly status: OrchestratorLifecycleStatus;
  readonly manifest_sha256: string;
  readonly last_heartbeat_at: string;
}

export interface NewOrchestratorRecordInput {
  readonly orchestrator_id: string;
  readonly run_id: string;
  readonly conversation_id: string;
  readonly pid: number;
  readonly host_type: OrchestratorHostType;
  readonly status?: OrchestratorLifecycleStatus;
  readonly manifest_sha256: string;
}

export const DEFAULT_ORCHESTRATOR_LEDGER_FILE = ".olt/orchestrators.jsonl";
export const DEFAULT_ORCHESTRATOR_LOCK_FILE = ".olt/locks/orchestrators.lock";

function delay(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function resolveLedgerPath(customPath?: string): string {
  return customPath?.trim()
    ? resolve(customPath.trim())
    : resolve(process.cwd(), DEFAULT_ORCHESTRATOR_LEDGER_FILE);
}

function resolveLockPath(customLock?: string, customLedger?: string): string {
  if (customLock?.trim()) return resolve(customLock.trim());
  if (customLedger?.trim()) {
    const dir = dirname(customLedger.trim());
    return basename(dir) === ".olt"
      ? resolve(dir, "locks", "orchestrators.lock")
      : resolve(dir, ".olt", "locks", "orchestrators.lock");
  }
  return resolve(process.cwd(), DEFAULT_ORCHESTRATOR_LOCK_FILE);
}

function isValidHostType(val: unknown): val is OrchestratorHostType {
  return typeof val === "string" && (VALID_HOST_TYPES as readonly string[]).includes(val);
}

function isValidStatus(val: unknown): val is OrchestratorLifecycleStatus {
  return typeof val === "string" && (VALID_LIFECYCLE_STATUSES as readonly string[]).includes(val);
}

function validateNewOrchestratorInput(input: NewOrchestratorRecordInput): void {
  if (!input || typeof input !== "object") {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "INVALID_REGISTRATION_RECORD: record input must be an object",
    );
  }
  if (typeof input.orchestrator_id !== "string" || !input.orchestrator_id.trim()) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "INVALID_REGISTRATION_RECORD: orchestrator_id must be a non-empty string",
    );
  }
  if (typeof input.run_id !== "string" || !input.run_id.trim()) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "INVALID_REGISTRATION_RECORD: run_id must be a non-empty string",
    );
  }
  if (typeof input.conversation_id !== "string" || !input.conversation_id.trim()) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "INVALID_REGISTRATION_RECORD: conversation_id must be a non-empty string",
    );
  }
  if (typeof input.pid !== "number" || !Number.isInteger(input.pid) || input.pid <= 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "INVALID_REGISTRATION_RECORD: pid must be a positive integer",
    );
  }
  if (!isValidHostType(input.host_type)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "INVALID_REGISTRATION_RECORD: host_type must be one of antigravity, claude_code, codex, cursor",
    );
  }
  if (typeof input.manifest_sha256 !== "string" || !input.manifest_sha256.trim()) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "INVALID_REGISTRATION_RECORD: manifest_sha256 must be a non-empty string",
    );
  }
  if (input.status !== undefined && !isValidStatus(input.status)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "INVALID_REGISTRATION_RECORD: status is not a valid OrchestratorLifecycleStatus",
    );
  }
}

function parseRecord(raw: unknown, lineNumber: number): OrchestratorRegistrationRecord {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new HarnessError(
      "INTEGRITY",
      `corrupted record at line ${lineNumber}: expected JSON object`,
    );
  }
  const obj = raw as Record<string, unknown>;
  const orchestrator_id =
    typeof obj["orchestrator_id"] === "string" ? obj["orchestrator_id"].trim() : "";
  const run_id = typeof obj["run_id"] === "string" ? obj["run_id"].trim() : "";
  const conversation_id =
    typeof obj["conversation_id"] === "string" ? obj["conversation_id"].trim() : "";
  const pid = typeof obj["pid"] === "number" && Number.isInteger(obj["pid"]) ? obj["pid"] : 0;
  const host_type = obj["host_type"];
  const spawned_at = typeof obj["spawned_at"] === "string" ? obj["spawned_at"].trim() : "";
  const status = obj["status"];
  const manifest_sha256 =
    typeof obj["manifest_sha256"] === "string" ? obj["manifest_sha256"].trim() : "";
  const last_heartbeat_at =
    typeof obj["last_heartbeat_at"] === "string" ? obj["last_heartbeat_at"].trim() : "";

  if (
    !orchestrator_id ||
    !run_id ||
    !conversation_id ||
    pid <= 0 ||
    !isValidHostType(host_type) ||
    !spawned_at ||
    !isValidStatus(status) ||
    !manifest_sha256 ||
    !last_heartbeat_at
  ) {
    throw new HarnessError("INTEGRITY", `corrupted record fields at line ${lineNumber}`);
  }
  return {
    orchestrator_id,
    run_id,
    conversation_id,
    pid,
    host_type,
    spawned_at,
    status,
    manifest_sha256,
    last_heartbeat_at,
  };
}

function readRecordsUnsafe(ledgerPath: string): OrchestratorRegistrationRecord[] {
  if (!existsSync(ledgerPath)) return [];
  const content = readFileSync(ledgerPath, "utf8");
  return content
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((line, idx) => {
      try {
        return parseRecord(JSON.parse(line), idx + 1);
      } catch (e) {
        if (e instanceof HarnessError) throw e;
        throw new HarnessError(
          "INTEGRITY",
          `invalid JSON at line ${idx + 1} in ledger: ${ledgerPath}`,
        );
      }
    });
}

function writeRecordsUnsafe(
  ledgerPath: string,
  records: readonly OrchestratorRegistrationRecord[],
): void {
  mkdirSync(dirname(ledgerPath), { recursive: true });
  const payload =
    records.map((r) => JSON.stringify(r)).join("\n") + (records.length > 0 ? "\n" : "");
  atomicWriteBytes(ledgerPath, Buffer.from(payload));
}

export function withOrchestratorLedgerLock<T>(lockPath: string, fn: () => T): T {
  const resolved = resolve(lockPath);
  mkdirSync(dirname(resolved), { recursive: true });
  const fd = openSync(resolved, constants.O_RDWR | constants.O_CREAT, 0o600);
  let locked = false;
  try {
    const start = Date.now();
    while (!locked) {
      locked = tryExclusiveFlock(fd);
      if (locked) break;
      if (Date.now() - start > 5000) {
        throw new HarnessError(
          "LOCK_TIMEOUT",
          `timed out waiting for orchestrator ledger lock: ${resolved}`,
        );
      }
      delay(10);
    }
    return fn();
  } finally {
    if (locked) {
      try {
        releaseFlock(fd);
      } catch {}
    }
    closeSync(fd);
  }
}

export function loadOrchestratorLedger(
  customLedgerPath?: string,
): OrchestratorRegistrationRecord[] {
  return readRecordsUnsafe(resolveLedgerPath(customLedgerPath));
}

export function registerOrchestratorSpawn(
  input: NewOrchestratorRecordInput,
  customLedgerPath?: string,
  customLockPath?: string,
): OrchestratorRegistrationRecord {
  validateNewOrchestratorInput(input);
  const ledgerPath = resolveLedgerPath(customLedgerPath);
  const lockPath = resolveLockPath(customLockPath, customLedgerPath);

  return withOrchestratorLedgerLock(lockPath, () => {
    const records = readRecordsUnsafe(ledgerPath);
    const existingIndex = records.findIndex(
      (r) => r.orchestrator_id === input.orchestrator_id.trim(),
    );
    const now = new Date().toISOString();

    if (existingIndex >= 0) {
      const existing = records[existingIndex]!;
      const isExistingActive = existing.status === "ACTIVE" || existing.status === "INITIALIZING";

      if (isExistingActive) {
        if (existing.pid !== input.pid) {
          throw new HarnessError(
            "INVALID_ARGUMENT",
            `INVALID_REGISTRATION_RECORD: orchestrator ${input.orchestrator_id} is already active with different pid (${existing.pid} !== ${input.pid})`,
          );
        }
        const updated: OrchestratorRegistrationRecord = {
          orchestrator_id: existing.orchestrator_id,
          run_id: input.run_id.trim(),
          conversation_id: input.conversation_id.trim(),
          pid: input.pid,
          host_type: input.host_type,
          spawned_at: existing.spawned_at,
          status: input.status ?? existing.status,
          manifest_sha256: input.manifest_sha256.trim(),
          last_heartbeat_at: now,
        };
        records[existingIndex] = updated;
        writeRecordsUnsafe(ledgerPath, records);
        return updated;
      }
    }

    const newRecord: OrchestratorRegistrationRecord = {
      orchestrator_id: input.orchestrator_id.trim(),
      run_id: input.run_id.trim(),
      conversation_id: input.conversation_id.trim(),
      pid: input.pid,
      host_type: input.host_type,
      spawned_at: now,
      status: input.status ?? "ACTIVE",
      manifest_sha256: input.manifest_sha256.trim(),
      last_heartbeat_at: now,
    };
    if (existingIndex >= 0) {
      records[existingIndex] = newRecord;
    } else {
      records.push(newRecord);
    }
    writeRecordsUnsafe(ledgerPath, records);
    return newRecord;
  });
}

export function deregisterOrchestrator(
  orchestratorId: string,
  status: OrchestratorLifecycleStatus = "COMPLETED",
  customLedgerPath?: string,
  customLockPath?: string,
): OrchestratorRegistrationRecord | null {
  if (!orchestratorId || typeof orchestratorId !== "string" || !orchestratorId.trim()) return null;
  if (!isValidStatus(status)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `INVALID_REGISTRATION_RECORD: invalid deregistration status ${String(status)}`,
    );
  }
  const ledgerPath = resolveLedgerPath(customLedgerPath);
  const lockPath = resolveLockPath(customLockPath, customLedgerPath);

  return withOrchestratorLedgerLock(lockPath, () => {
    const records = readRecordsUnsafe(ledgerPath);
    const id = orchestratorId.trim();
    const index = records.findIndex((r) => r.orchestrator_id === id);
    if (index < 0) return null;
    const existing = records[index]!;
    const updated: OrchestratorRegistrationRecord = {
      ...existing,
      status,
      last_heartbeat_at: new Date().toISOString(),
    };
    records[index] = updated;
    writeRecordsUnsafe(ledgerPath, records);
    return updated;
  });
}

export function updateOrchestratorHeartbeat(
  orchestratorId: string,
  customLedgerPath?: string,
  customLockPath?: string,
): OrchestratorRegistrationRecord | null {
  if (!orchestratorId || typeof orchestratorId !== "string" || !orchestratorId.trim()) return null;
  const ledgerPath = resolveLedgerPath(customLedgerPath);
  const lockPath = resolveLockPath(customLockPath, customLedgerPath);

  return withOrchestratorLedgerLock(lockPath, () => {
    const records = readRecordsUnsafe(ledgerPath);
    const id = orchestratorId.trim();
    const index = records.findIndex((r) => r.orchestrator_id === id);
    if (index < 0) return null;
    const existing = records[index]!;
    const updated: OrchestratorRegistrationRecord = {
      ...existing,
      last_heartbeat_at: new Date().toISOString(),
    };
    records[index] = updated;
    writeRecordsUnsafe(ledgerPath, records);
    return updated;
  });
}
