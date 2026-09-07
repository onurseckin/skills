import { computeDaemonState as baseComputeDaemonState } from "./health.ts";
import {
  type DaemonHealthRecord,
  type DaemonLivenessState,
  type HealthComputeOptions,
} from "./health-types.ts";

export function computeDaemonState(
  record: DaemonHealthRecord,
  nowMs: number,
  options: HealthComputeOptions = {},
): DaemonLivenessState {
  const DEFAULT_MAX_SPOOL_BYTES = 33554432;
  const isBackpressured =
    options.isBackpressured ??
    (record.spool_bytes >= DEFAULT_MAX_SPOOL_BYTES || record.spool_lines >= 20000);
  const adjustedRecord: DaemonHealthRecord =
    !isBackpressured && record.state === "BACKPRESSURED" ? { ...record, state: "LIVE" } : record;
  return baseComputeDaemonState(adjustedRecord, nowMs, {
    ...options,
    isBackpressured,
  });
}

export {
  acquireDaemonLock,
  checkRespawnBudget,
  parseDaemonLockPayload,
  reclaimStaleLock,
  recordRespawn,
  releaseDaemonLock,
  startDaemon,
  stopDaemon,
  type LockAcquisitionResult,
  type SupervisorOptions,
  type SupervisorPorts,
  type SupervisorResult,
} from "./supervisor.ts";

export {
  DaemonWatcher,
  computeChangeToken,
  hasTokenChanged,
  type ChangeToken,
  type DaemonWatcherOptions,
  type WakeSource,
  type WatcherMetrics,
} from "./watcher.ts";

export {
  appendSpool,
  getSpoolStats,
  isSpoolBackpressured,
  repairSpool,
  rotateSpoolIfNeeded,
  type SpoolAppendResult,
  type SpoolOptions,
  type SpoolRepairResult,
  type SpoolStats,
} from "./spool.ts";

export {
  runDaemonLoop,
  stepDaemonLoop,
  type DaemonLoopOptions,
  type DaemonStepResult,
} from "./loop.ts";

export {
  claimHealthRecord,
  countRecentRespawns,
  createInitialHealthRecord,
  deriveConsumerLastAckAt,
  inspectDaemon,
  isDaemonHealthRecord,
  isHealthRecordOwnerStale,
  readHealthRecord,
  stampStoppedIfOwned,
  syncDaemonHealth,
  writeDerivedHealthRecord,
  writeHealthRecord,
} from "./health.ts";

export {
  type CursorAckProvenance,
  type DaemonHealthRecord,
  type DaemonInspectionResult,
  type DaemonLivenessState,
  type DaemonWakesBySource,
  type HealthClaimOptions,
  type HealthComputeOptions,
  type HealthMetrics,
  type HealthPorts,
  type HealthSyncInput,
} from "./health-types.ts";

export {
  ensureDaemon,
  type EnsureDaemonOptions,
  type EnsureDaemonPorts,
  type EnsureDaemonResult,
} from "./ensure.ts";

export {
  createProcessLifecycle,
  dispatchDeliveryNotification,
  dispatchNotify,
  executeNotifyCommand,
  recordConsumerReceipt,
  runWithProcessLifecycle,
  type DeliveryNotificationInput,
  type DispatchNotifyOptions,
  type ExecuteNotifyOptions,
  type NotifyProcessChild,
  type NotifyProcessStream,
  type NotifyResult,
  type NotifySpawner,
  type ProcessLifecycleController,
  type ProcessLifecycleRunInput,
} from "./notify.ts";
