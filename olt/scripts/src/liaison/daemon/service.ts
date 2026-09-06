/**
 * Liaison daemon service orchestrating liveness, projection, and notification loops.
 *
 * Responsibilities:
 * - Emits positive liveness heartbeats on declared intervals.
 * - Monitors peer liveness, marks missed-beat unreachability, and observes declared freeze states.
 * - Maintains single-source-of-truth state projection.
 * - Dispatches push notifications on state and liveness transitions.
 * - Implements graceful failure degradation: degrades to direct capsule inspection rather than halting.
 */

import { HeartbeatEmitter, PeerLivenessMonitor } from "./liveness.ts";
import { NotificationDispatcher } from "./notification.ts";
import { computeStateProjection, inspectDirectCapsule } from "./projection.ts";
import type {
  DaemonConfig,
  DaemonSnapshot,
  FreezeKind,
  FreezeState,
  FreezeStateChangedEvent,
  HeartbeatLapseEvent,
  HeartbeatPayload,
  PeerLivenessStatus,
  StateProjection,
  SubscriberCallback,
  TransitionEventType,
  UnsubscribeFunction,
} from "./types.ts";

export class LiaisonDaemonService {
  private readonly config: DaemonConfig;
  private readonly emitter: HeartbeatEmitter;
  private readonly peerMonitor: PeerLivenessMonitor;
  private readonly dispatcher: NotificationDispatcher;
  private readonly clock: () => number;

  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private currentProjection: StateProjection | null = null;
  private degraded = false;
  private degradedReason: string | undefined = undefined;
  private peerPrevStates = new Map<string, { state: string; freeze: FreezeState | null }>();

  public constructor(config: DaemonConfig) {
    this.config = config;
    this.clock = config.clock ?? Date.now;
    this.emitter = new HeartbeatEmitter(
      config.daemon_id,
      config.heartbeat_interval_ms ?? 5000,
      this.clock,
    );
    this.peerMonitor = new PeerLivenessMonitor({
      missed_beat_threshold: config.missed_beat_threshold ?? 2,
      default_interval_ms: config.heartbeat_interval_ms ?? 5000,
      clock: this.clock,
    });
    this.dispatcher = new NotificationDispatcher();

    if (config.peer_ids) {
      for (const peerId of config.peer_ids) {
        this.peerMonitor.registerPeer(peerId, config.heartbeat_interval_ms ?? 5000);
        this.peerPrevStates.set(peerId, { state: "unknown", freeze: null });
      }
    }
  }

  public isRunning(): boolean {
    return this.running;
  }

  public isDegraded(): boolean {
    return this.degraded;
  }

  public getDegradedReason(): string | undefined {
    return this.degradedReason;
  }

  public getEmitter(): HeartbeatEmitter {
    return this.emitter;
  }

  public getPeerMonitor(): PeerLivenessMonitor {
    return this.peerMonitor;
  }

  public getDispatcher(): NotificationDispatcher {
    return this.dispatcher;
  }

  public subscribe(
    callback: SubscriberCallback,
    filter: TransitionEventType | "*" = "*",
  ): UnsubscribeFunction {
    return this.dispatcher.subscribe(callback, filter);
  }

  public recordPeerHeartbeat(heartbeat: HeartbeatPayload): PeerLivenessStatus {
    const prev = this.peerPrevStates.get(heartbeat.sender_id) ?? { state: "unknown", freeze: null };
    const status = this.peerMonitor.recordHeartbeat(heartbeat);

    const prevFreeze = prev.freeze;
    const currFreeze = status.freeze_state;
    if (JSON.stringify(prevFreeze) !== JSON.stringify(currFreeze)) {
      const event: FreezeStateChangedEvent = {
        type: "freeze_state_changed",
        timestamp: new Date(this.clock()).toISOString(),
        peer_id: heartbeat.sender_id,
        previous_state: prevFreeze,
        current_state: currFreeze,
      };
      void this.dispatcher.dispatch(event);
    }

    this.peerPrevStates.set(heartbeat.sender_id, {
      state: status.state,
      freeze: status.freeze_state,
    });

    return status;
  }

  public enterFreeze(
    kind: FreezeKind,
    reason: string,
    expectedResumeAt?: string,
  ): HeartbeatPayload {
    const freeze: FreezeState = {
      kind,
      reason,
      entered_at: new Date(this.clock()).toISOString(),
      ...(expectedResumeAt !== undefined ? { expected_resume_at: expectedResumeAt } : {}),
    };
    this.emitter.declareFreeze(freeze);
    return this.emitter.emitHeartbeat(this.config.active_run_ids ?? [], `freeze:${kind}`);
  }

  public exitFreeze(): HeartbeatPayload {
    this.emitter.clearFreeze();
    return this.emitter.emitHeartbeat(
      this.config.active_run_ids ?? [],
      this.config.status ?? "running",
    );
  }

  public async tick(): Promise<DaemonSnapshot> {
    const activeRuns = this.config.active_run_ids ?? [];
    const statusLine = this.degraded
      ? `degraded:${this.degradedReason ?? "unknown"}`
      : (this.config.status ?? "running");

    this.emitter.emitHeartbeat(activeRuns, statusLine);

    const peerStatuses = this.peerMonitor.checkAllPeers();
    for (const [peerId, status] of Object.entries(peerStatuses)) {
      const prev = this.peerPrevStates.get(peerId) ?? { state: "unknown", freeze: null };
      if (prev.state !== "unreachable" && status.state === "unreachable") {
        const lapseEvent: HeartbeatLapseEvent = {
          type: "heartbeat_lapse",
          timestamp: new Date(this.clock()).toISOString(),
          peer_id: peerId,
          missed_beats: status.consecutive_missed_beats,
          declared_interval_ms: status.declared_interval_ms,
        };
        await this.dispatcher.dispatch(lapseEvent);
      }
      this.peerPrevStates.set(peerId, { state: status.state, freeze: status.freeze_state });
    }

    let nextProjection: StateProjection | null = null;
    try {
      nextProjection = computeStateProjection({
        capsuleDir: this.config.capsule_dir,
        repoRoot: this.config.repo_root,
        gitRunner: this.config.gitRunner,
      });
      this.degraded = false;
      this.degradedReason = undefined;
    } catch (primaryErr: unknown) {
      try {
        nextProjection = inspectDirectCapsule(
          this.config.capsule_dir,
          this.config.repo_root,
          this.config.gitRunner,
        );
        this.degraded = true;
        this.degradedReason = `Primary projection failed; degraded to direct inspection: ${primaryErr instanceof Error ? primaryErr.message : String(primaryErr)}`;
      } catch (fallbackErr: unknown) {
        this.degraded = true;
        this.degradedReason = `Direct capsule inspection failed: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`;
      }
    }

    if (nextProjection) {
      const transitions = this.dispatcher.detectTransitions(this.currentProjection, nextProjection);
      if (transitions.length > 0) {
        await this.dispatcher.dispatchAll(transitions);
      }
      this.currentProjection = nextProjection;
    }

    return this.getSnapshot();
  }

  public async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    await this.tick();

    const interval = this.config.heartbeat_interval_ms ?? 5000;
    this.timer = setInterval(() => {
      void this.tick();
    }, interval);
  }

  public stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.enterFreeze("graceful_shutdown", "Liaison daemon service stopped");
  }

  public getSnapshot(): DaemonSnapshot {
    return {
      daemon_id: this.config.daemon_id,
      is_running: this.running,
      last_emitted_heartbeat: this.emitter.getLastEmittedHeartbeat(),
      projection: this.currentProjection,
      peer_liveness: this.peerMonitor.getAllPeerStatuses(),
      degraded: this.degraded,
      ...(this.degradedReason !== undefined ? { degraded_reason: this.degradedReason } : {}),
    };
  }
}
