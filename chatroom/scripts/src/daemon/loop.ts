import { existsSync } from "node:fs";
import {
  ChatError,
  daemonHealthPath,
  readerCursorPath,
  readerLockPath,
  roomDir,
  roomLogDir,
  roomManifestPath,
  roomQuarantinePath,
  writeAtomic,
  type Envelope,
} from "../core/index.ts";
import { verifyEnvelope } from "../crypto/index.ts";
import {
  ackLease,
  leaseNext,
  loadCursor,
  saveCursorCas,
  withReaderLock,
  type Confirmation,
  type ReaderCursor,
} from "../cursor/index.ts";
import { resolvePolicy, type ChatroomPolicy } from "../policy/index.ts";
import {
  claimHealthRecord,
  computeDaemonState,
  readHealthRecord,
  syncDaemonHealth,
  writeHealthRecord,
  type DaemonHealthRecord,
  type HealthPorts,
} from "./health.ts";
import {
  dispatchDeliveryNotification,
  resolveRoomKey,
  runWithProcessLifecycle,
  type NotifyResult,
  type NotifySpawner,
} from "./notify.ts";
import { appendSpool, getSpoolStats, isSpoolBackpressured, repairSpool } from "./spool.ts";
import { acquireDaemonLock } from "./supervisor.ts";
import {
  computeChangeToken,
  DaemonWatcher,
  type DaemonWatcherPorts,
  type WakeSource,
} from "./watcher.ts";

export interface DaemonLoopOptions {
  readonly room: string;
  readonly reader: string;
  readonly policy?: ChatroomPolicy;
  readonly pollIntervalMs?: number;
  readonly singleStep?: boolean;
  readonly now?: string;
  readonly watcher?: DaemonWatcher;
  readonly watcherPorts?: DaemonWatcherPorts;
  readonly healthPorts?: HealthPorts;
  readonly spawnNotify?: NotifySpawner;
  readonly notifyTimeoutMs?: number;
}

export interface DaemonStepResult {
  readonly delivered: number;
  readonly remaining: number;
  readonly backpressured: boolean;
  readonly idle: boolean;
  readonly notifyPromise?: Promise<NotifyResult | null>;
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

  const existingHealth = claimHealthRecord(
    healthPath,
    { room, reader, pid: process.pid, startTime: nowIso, pollIntervalMs: policy.poll_interval_ms },
    options.healthPorts,
  );

  const metrics = options.watcher?.getMetrics();
  const watchActive = metrics !== undefined ? metrics.watch_active : existingHealth.watch_active;
  const watchFailures =
    metrics !== undefined ? metrics.watch_failures : existingHealth.watch_failures;
  const pollIntervalMs =
    metrics !== undefined ? metrics.poll_interval_ms : existingHealth.poll_interval_ms;

  const updateHealth = (patch: Partial<DaemonHealthRecord>): void => {
    const current = readHealthRecord(healthPath, options.healthPorts) ?? existingHealth;
    writeHealthRecord(
      healthPath,
      {
        ...current,
        last_wake_at: nowIso,
        last_wake_source: wakeSource,
        watch_active: watchActive,
        watch_failures: watchFailures,
        poll_interval_ms: pollIntervalMs,
        updated_at: nowIso,
        ...patch,
      },
      options.healthPorts,
    );
  };

  const spoolStats = getSpoolStats(room, reader);
  const currentlyBp = existingHealth.state === "BACKPRESSURED";
  const isBp = isSpoolBackpressured(
    spoolStats,
    { maxSpoolBytes: policy.max_spool_bytes, maxSpoolLines: policy.max_spool_lines },
    currentlyBp,
  );

  const rLockPath = readerLockPath(room, reader);
  const cPath = readerCursorPath(room, reader);
  const key = resolveRoomKey(room);

  let deliveredCount = 0;
  let remainingCount = 0;
  const recentErrors: string[] = [...existingHealth.errors_recent];
  let notifyPromise: Promise<NotifyResult | null> | undefined;

  const recordStepState = (
    deliveredSeq: number,
    bytes: number,
    lines: number,
    errs?: readonly string[],
  ): void => {
    const base: DaemonHealthRecord = {
      ...existingHealth,
      state: existingHealth.state === "BACKPRESSURED" ? "LIVE" : existingHealth.state,
      lag_seqs: remainingCount,
      room_head_seq: headSeq,
      last_delivered_seq: deliveredSeq,
      last_wake_at: nowIso,
    };
    updateHealth({
      room_head_seq: headSeq,
      last_delivered_seq: deliveredSeq,
      lag_seqs: remainingCount,
      spool_bytes: bytes,
      spool_lines: lines,
      state: computeDaemonState(base, nowMs),
      ...(errs !== undefined ? { errors_recent: errs } : {}),
    });
  };

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
      updateHealth({
        room_head_seq: headSeq,
        last_delivered_seq: contiguousSeq,
        lag_seqs: remainingCount,
        spool_bytes: spoolStats.bytes,
        spool_lines: spoolStats.lines,
        state: "BACKPRESSURED",
      });
      return;
    }

    const logDir = roomLogDir(room);
    const leaseRes = leaseNext(cursor, logDir, policy.batch_size, {
      ttlMs: policy.lease_ttl_ms,
      now: nowIso,
    });

    if (!leaseRes.leaseId || leaseRes.messages.length === 0) {
      recordStepState(contiguousSeq, spoolStats.bytes, spoolStats.lines);
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
      const appendRes = appendSpool(room, reader, validEnvelopes, { segmentMaxBytes });
      spoolOffset = appendRes.spoolOffset;
      spoolPath = appendRes.spoolPath;
    }

    const confirmation: Confirmation = {
      kind: "spooled",
      at: nowIso,
      spool_path: spoolPath,
      spool_offset: spoolOffset,
      fsynced: true,
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

    notifyPromise = dispatchDeliveryNotification({
      command: policy.notify_command,
      envelopes: validEnvelopes,
      lastSeq: lastContiguousVerifiedSeq,
      healthPath,
      nowIso,
      recentErrors,
      ...(options.notifyTimeoutMs !== undefined ? { timeoutMs: options.notifyTimeoutMs } : {}),
      ...(options.healthPorts !== undefined ? { ports: options.healthPorts } : {}),
      ...(options.spawnNotify !== undefined ? { spawnProcess: options.spawnNotify } : {}),
      onErrorsUpdated: (errs) => updateHealth({ errors_recent: errs }),
    });

    const updatedSpoolStats = getSpoolStats(room, reader);
    recordStepState(
      ackedCursor.contiguous_seq,
      updatedSpoolStats.bytes,
      updatedSpoolStats.lines,
      recentErrors,
    );
  });

  return {
    delivered: deliveredCount,
    remaining: remainingCount,
    backpressured: isBp,
    idle: deliveredCount === 0 && remainingCount === 0,
    ...(notifyPromise !== undefined ? { notifyPromise } : {}),
  };
}

export async function runDaemonLoop(options: DaemonLoopOptions): Promise<void> {
  const { room, reader } = options;
  const existsFn = options.healthPorts?.existsSync ?? existsSync;
  const rDir = roomDir(room);
  const mPath = roomManifestPath(room);
  if (!existsFn(rDir)) {
    throw new ChatError("NOT_FOUND", `Room directory not found for room '${room}'`);
  }
  if (!existsFn(mPath)) {
    throw new ChatError("NOT_FOUND", `Room manifest not found for room '${room}'`);
  }
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
  const pollMs = options.pollIntervalMs ?? policy.poll_interval_ms;
  claimHealthRecord(
    healthPath,
    { room, reader, pid: process.pid, startTime: nowIso, pollIntervalMs: pollMs },
    options.healthPorts,
  );

  const watcher =
    options.watcher ??
    new DaemonWatcher(room, {
      reader,
      healthPath,
      pollIntervalMs: pollMs,
      ...(options.watcherPorts !== undefined ? { ports: options.watcherPorts } : {}),
    });

  const stepOptions: DaemonLoopOptions = { ...options, watcher };

  const syncHealth = (source?: WakeSource): void => {
    const syncIso = new Date().toISOString();
    syncDaemonHealth({
      healthPath,
      nowIso: syncIso,
      metrics: watcher.getMetrics(),
      claim: { room, reader, pid: process.pid, startTime: syncIso, pollIntervalMs: pollMs },
      ...(source !== undefined ? { source } : {}),
      ...(options.healthPorts !== undefined ? { ports: options.healthPorts } : {}),
    });
  };

  await runWithProcessLifecycle({
    healthPath,
    lockFd: lockRes.lockFd,
    room,
    reader,
    watcher,
    ...(options.healthPorts !== undefined ? { ports: options.healthPorts } : {}),
    start: async (controller) => {
      const onWake = async (source: WakeSource, tokenChanged: boolean): Promise<void> => {
        if (!controller.isRunning()) return;
        if (!existsFn(rDir)) {
          controller.stop();
          return;
        }
        if (!tokenChanged && source !== "tick") {
          syncHealth(source);
          return;
        }
        let remaining = 1;
        while (remaining > 0 && controller.isRunning()) {
          if (!existsFn(rDir)) {
            controller.stop();
            return;
          }
          const result = stepDaemonLoop(stepOptions, source);
          if (result.notifyPromise) {
            await result.notifyPromise;
          }
          if (result.backpressured || result.idle || result.delivered === 0) {
            break;
          }
          remaining = result.remaining;
        }
      };

      watcher.start((source, changed) => onWake(source, changed));
      syncHealth();
      await onWake("tick", true);
    },
  });
}
