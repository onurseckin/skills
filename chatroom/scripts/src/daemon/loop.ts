import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import {
  ChatError,
  daemonHealthPath,
  readerCursorPath,
  readerLockPath,
  roomKeyPath,
  roomLogDir,
  roomManifestPath,
  roomQuarantinePath,
  writeAtomic,
  type Envelope,
} from "../core/index.ts";
import { CHATROOM_PUBLIC_KEY, verifyEnvelope } from "../crypto/index.ts";
import {
  ackLease,
  leaseNext,
  loadCursor,
  saveCursorCas,
  withReaderLock,
  type Confirmation,
  type LogEnvelope,
  type ReaderCursor,
} from "../cursor/index.ts";
import { resolvePolicy, type ChatroomPolicy } from "../policy/index.ts";
import {
  computeDaemonState,
  createInitialHealthRecord,
  readHealthRecord,
  writeHealthRecord,
  type DaemonHealthRecord,
} from "./health.ts";
import { appendSpool, getSpoolStats, isSpoolBackpressured, repairSpool } from "./spool.ts";
import { acquireDaemonLock, releaseDaemonLock } from "./supervisor.ts";
import { computeChangeToken, DaemonWatcher, type WakeSource } from "./watcher.ts";

export interface DaemonLoopOptions {
  readonly room: string;
  readonly reader: string;
  readonly policy?: ChatroomPolicy;
  readonly pollIntervalMs?: number;
  readonly singleStep?: boolean;
  readonly now?: string;
}

export interface DaemonStepResult {
  readonly delivered: number;
  readonly remaining: number;
  readonly backpressured: boolean;
  readonly idle: boolean;
}

function resolveRoomKey(roomId: string): string {
  const manifestPath = roomManifestPath(roomId);
  if (existsSync(manifestPath)) {
    try {
      const manifestRaw = readFileSync(manifestPath, "utf8");
      const manifest: unknown = JSON.parse(manifestRaw);
      if (
        typeof manifest === "object" &&
        manifest !== null &&
        "visibility" in manifest &&
        (manifest as { visibility: unknown }).visibility === "public"
      ) {
        return CHATROOM_PUBLIC_KEY;
      }
    } catch {}
  }

  const keyPath = roomKeyPath(roomId);
  if (existsSync(keyPath)) {
    try {
      return readFileSync(keyPath, "utf8").trim();
    } catch {}
  }

  return CHATROOM_PUBLIC_KEY;
}

function fireNotify(command: string, batch: readonly unknown[]): boolean {
  try {
    const child = spawn(command, { shell: true, stdio: ["pipe", "ignore", "ignore"] });
    if (child.stdin) {
      child.stdin.write(JSON.stringify(batch));
      child.stdin.end();
    }
    return true;
  } catch {
    return false;
  }
}

export function stepDaemonLoop(
  options: DaemonLoopOptions,
  wakeSource: WakeSource = "tick",
): DaemonStepResult {
  const { room, reader } = options;
  const policy = options.policy ?? resolvePolicy();
  const token = computeChangeToken(room);
  const headSeq = token.next_seq > 0 ? token.next_seq - 1 : 0;
  const healthPath = daemonHealthPath(room, reader);
  const nowIso = options.now ?? new Date().toISOString();
  const nowMs = options.now ? Date.parse(options.now) : Date.now();

  repairSpool(room, reader);

  let existingHealth = readHealthRecord(healthPath);
  if (!existingHealth) {
    existingHealth = createInitialHealthRecord(
      room,
      reader,
      process.pid,
      nowIso,
      "boot",
      policy.poll_interval_ms,
    );
  }

  const spoolStats = getSpoolStats(room, reader);
  const currentlyBp = existingHealth.state === "BACKPRESSURED";
  const isBp = isSpoolBackpressured(
    spoolStats,
    {
      maxSpoolBytes: policy.max_spool_bytes,
      maxSpoolLines: policy.max_spool_lines,
    },
    currentlyBp,
  );

  const rLockPath = readerLockPath(room, reader);
  const cPath = readerCursorPath(room, reader);
  const key = resolveRoomKey(room);

  let deliveredCount = 0;
  let remainingCount = 0;
  let recentErrors: string[] = [...existingHealth.errors_recent];

  withReaderLock(rLockPath, () => {
    const loadedCursor = loadCursor(cPath, { room, reader });
    let cursor = loadedCursor.cursor;
    let checksum = loadedCursor.checksum;
    if (!existsSync(cPath)) {
      saveCursorCas(cPath, cursor, checksum);
      const reloaded = loadCursor(cPath, { room, reader });
      cursor = reloaded.cursor;
      checksum = reloaded.checksum;
    }
    const contiguousSeq = cursor.contiguous_seq;
    remainingCount = Math.max(0, headSeq - contiguousSeq);

    if (isBp) {
      const updatedHealth: DaemonHealthRecord = {
        ...existingHealth,
        last_wake_at: nowIso,
        last_wake_source: wakeSource,
        room_head_seq: headSeq,
        last_delivered_seq: contiguousSeq,
        lag_seqs: remainingCount,
        spool_bytes: spoolStats.bytes,
        spool_lines: spoolStats.lines,
        state: "BACKPRESSURED",
        updated_at: nowIso,
      };
      writeHealthRecord(healthPath, updatedHealth);
      return;
    }

    const logDir = roomLogDir(room);
    const leaseRes = leaseNext(cursor, logDir, policy.batch_size, {
      ttlMs: policy.lease_ttl_ms,
      now: nowIso,
    });

    if (!leaseRes.leaseId || leaseRes.messages.length === 0) {
      const baseRecord: DaemonHealthRecord = {
        ...existingHealth,
        state: existingHealth.state === "BACKPRESSURED" ? "LIVE" : existingHealth.state,
        lag_seqs: remainingCount,
        room_head_seq: headSeq,
      };
      const state = computeDaemonState(baseRecord, nowMs);
      const updatedHealth: DaemonHealthRecord = {
        ...existingHealth,
        last_wake_at: nowIso,
        last_wake_source: wakeSource,
        room_head_seq: headSeq,
        last_delivered_seq: contiguousSeq,
        lag_seqs: remainingCount,
        spool_bytes: spoolStats.bytes,
        spool_lines: spoolStats.lines,
        state,
        updated_at: nowIso,
      };
      writeHealthRecord(healthPath, updatedHealth);
      return;
    }

    let lastContiguousVerifiedSeq: number | null = null;
    const validEnvelopes: Envelope[] = [];
    for (const msg of leaseRes.messages) {
      const envelopeCandidate = msg as unknown as Envelope;
      const verifyRes = verifyEnvelope(envelopeCandidate, key);
      if (verifyRes.valid) {
        validEnvelopes.push(envelopeCandidate);
        lastContiguousVerifiedSeq = msg.seq;
      } else {
        const qPath = roomQuarantinePath(room, msg.ts, msg.seq);
        writeAtomic(qPath, JSON.stringify(msg, null, 2) + "\n");
        break;
      }
    }

    let spoolOffset = spoolStats.bytes;
    let spoolPath = "";

    if (validEnvelopes.length > 0) {
      const segmentMaxBytes = Math.floor(policy.max_spool_bytes / 10);
      const appendRes = appendSpool(room, reader, validEnvelopes, {
        segmentMaxBytes,
      });
      spoolOffset = appendRes.spoolOffset;
      spoolPath = appendRes.spoolPath;
    }

    const confirmation: Confirmation =
      validEnvelopes.length > 0
        ? {
            kind: "spooled",
            at: nowIso,
            spool_path: spoolPath,
            spool_offset: spoolOffset,
            fsynced: true,
          }
        : {
            kind: "explicit",
            at: nowIso,
          };

    const ackedCursor: ReaderCursor =
      validEnvelopes.length > 0 && lastContiguousVerifiedSeq !== null
        ? ackLease(leaseRes.cursor, leaseRes.leaseId, lastContiguousVerifiedSeq, confirmation, {
            now: nowIso,
          })
        : leaseRes.cursor;
    saveCursorCas(cPath, ackedCursor, checksum);

    deliveredCount = validEnvelopes.length;
    remainingCount = Math.max(0, headSeq - ackedCursor.contiguous_seq);

    if (policy.notify_command && validEnvelopes.length > 0) {
      const fired = fireNotify(policy.notify_command, validEnvelopes);
      if (!fired) {
        recentErrors.push(`notify_command failed at ${nowIso}`);
        if (recentErrors.length > 20) {
          recentErrors = recentErrors.slice(recentErrors.length - 20);
        }
      }
    }

    const updatedSpoolStats = getSpoolStats(room, reader);
    const baseRecord: DaemonHealthRecord = {
      ...existingHealth,
      state: existingHealth.state === "BACKPRESSURED" ? "LIVE" : existingHealth.state,
      lag_seqs: remainingCount,
      room_head_seq: headSeq,
      last_delivered_seq: ackedCursor.contiguous_seq,
    };
    const computedState = computeDaemonState(baseRecord, nowMs);

    const updatedHealth: DaemonHealthRecord = {
      ...existingHealth,
      last_wake_at: nowIso,
      last_wake_source: wakeSource,
      room_head_seq: headSeq,
      last_delivered_seq: ackedCursor.contiguous_seq,
      lag_seqs: remainingCount,
      spool_bytes: updatedSpoolStats.bytes,
      spool_lines: updatedSpoolStats.lines,
      state: computedState,
      errors_recent: recentErrors,
      updated_at: nowIso,
    };
    writeHealthRecord(healthPath, updatedHealth);
  });

  return {
    delivered: deliveredCount,
    remaining: remainingCount,
    backpressured: isBp,
    idle: deliveredCount === 0 && remainingCount === 0,
  };
}

export async function runDaemonLoop(options: DaemonLoopOptions): Promise<void> {
  const { room, reader } = options;
  const policy = options.policy ?? resolvePolicy();

  const lockRes = acquireDaemonLock(room, reader, "daemon", {}, policy);
  if (!lockRes.acquired) {
    throw new ChatError(
      "LOCK_TIMEOUT",
      `Daemon lock already held for reader '${reader}' in room '${room}'`,
    );
  }

  const healthPath = daemonHealthPath(room, reader);
  const nowIso = new Date().toISOString();
  const initialHealth =
    readHealthRecord(healthPath) ??
    createInitialHealthRecord(
      room,
      reader,
      process.pid,
      nowIso,
      "boot",
      options.pollIntervalMs ?? policy.poll_interval_ms,
    );
  writeHealthRecord(healthPath, initialHealth);

  const watcher = new DaemonWatcher(room, {
    pollIntervalMs: options.pollIntervalMs ?? policy.poll_interval_ms,
  });

  let running = true;

  const onShutdown = (): void => {
    running = false;
    watcher.stop();
  };

  process.once("SIGTERM", onShutdown);
  process.once("SIGINT", onShutdown);

  const onWake = async (source: WakeSource, tokenChanged: boolean): Promise<void> => {
    if (!running) return;

    if (!tokenChanged && source !== "tick") {
      const healthPath = daemonHealthPath(room, reader);
      const existing = readHealthRecord(healthPath);
      if (existing) {
        const nowIso = new Date().toISOString();
        writeHealthRecord(healthPath, {
          ...existing,
          last_wake_at: nowIso,
          last_wake_source: source,
          updated_at: nowIso,
        });
      }
      return;
    }

    let remaining = 1;
    while (remaining > 0 && running) {
      const result = stepDaemonLoop(options, source);
      if (result.backpressured || result.idle || result.delivered === 0) {
        break;
      }
      remaining = result.remaining;
    }
  };

  try {
    watcher.start((source, changed) => onWake(source, changed));

    await onWake("tick", true);

    await new Promise<void>((resolvePromise) => {
      const checkInterval = setInterval(() => {
        if (!running) {
          clearInterval(checkInterval);
          resolvePromise();
        }
      }, 500);
    });
  } finally {
    process.removeListener("SIGTERM", onShutdown);
    process.removeListener("SIGINT", onShutdown);
    watcher.stop();
    releaseDaemonLock(room, reader, lockRes.lockFd);
  }
}
