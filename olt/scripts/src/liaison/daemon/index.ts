/**
 * Facade for the Liaison Daemon subsystem.
 *
 * Provides named exports for:
 * - Liveness heartbeat emission, monitoring, and freeze state handling
 * - Single-definition state projection and direct capsule inspection fallback
 * - Transition push notification dispatcher and subscriber registry
 * - Liaison daemon orchestrator service and snapshot types
 */

export type {
  DaemonConfig,
  DaemonSnapshot,
  FreezeKind,
  FreezeState,
  FreezeStateChangedEvent,
  GitRunner,
  GitStateSummary,
  HeartbeatLapseEvent,
  HeartbeatPayload,
  LaneConcurrencyMetric,
  LeaseSummary,
  LivenessMonitorConfig,
  PeerLivenessState,
  PeerLivenessStatus,
  RatchetMetric,
  RunCompletedEvent,
  StateProjection,
  SubscriberCallback,
  TaskStateChangeEvent,
  TaskStateSummary,
  TransitionEvent,
  TransitionEventType,
  UnsubscribeFunction,
  VerdictRecordedEvent,
} from "./types.ts";

export { HeartbeatEmitter, PeerLivenessMonitor } from "./liveness.ts";

export {
  computeStateProjection,
  defaultGitRunner,
  inspectDirectCapsule,
  type ComputeProjectionOptions,
} from "./projection.ts";

export { NotificationDispatcher } from "./notification.ts";

export { LiaisonDaemonService } from "./service.ts";
