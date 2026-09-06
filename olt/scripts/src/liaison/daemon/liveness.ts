/**
 * Positive liveness heartbeat emitter and peer liveness monitor.
 *
 * Assertions:
 * - Emits positive liveness heartbeats carrying timestamp, sequence, interval, active runs, status, and freeze states.
 * - Monitors peer liveness: tracks interval, computes consecutive missed beats, and marks peer as unreachable
 *   once threshold is reached.
 * - Handles declared freeze states (quota freeze, graceful shutdown) as legitimate first-class states rather than lapses.
 */

import type {
  FreezeState,
  HeartbeatPayload,
  LivenessMonitorConfig,
  PeerLivenessStatus,
} from "./types.ts";

export class HeartbeatEmitter {
  private readonly senderId: string;
  private readonly defaultIntervalMs: number;
  private readonly clock: () => number;
  private sequence = 1;
  private currentFreezeState: FreezeState | null = null;
  private lastEmitted: HeartbeatPayload | null = null;

  public constructor(senderId: string, defaultIntervalMs = 5000, clock: () => number = Date.now) {
    this.senderId = senderId;
    this.defaultIntervalMs = defaultIntervalMs > 0 ? defaultIntervalMs : 5000;
    this.clock = clock;
  }

  public declareFreeze(freeze: FreezeState): void {
    this.currentFreezeState = freeze;
  }

  public clearFreeze(): void {
    this.currentFreezeState = null;
  }

  public getFreezeState(): FreezeState | null {
    return this.currentFreezeState;
  }

  public emitHeartbeat(
    activeRunIds: readonly string[],
    status: string,
    overrideIntervalMs?: number,
  ): HeartbeatPayload {
    const now = this.clock();
    const interval =
      overrideIntervalMs !== undefined && overrideIntervalMs > 0
        ? overrideIntervalMs
        : this.defaultIntervalMs;

    const payload: HeartbeatPayload = {
      sender_id: this.senderId,
      sequence: this.sequence++,
      timestamp: new Date(now).toISOString(),
      next_beat_interval_ms: interval,
      active_run_ids: [...activeRunIds],
      status,
      freeze_state: this.currentFreezeState,
    };

    this.lastEmitted = payload;
    return payload;
  }

  public getLastEmittedHeartbeat(): HeartbeatPayload | null {
    return this.lastEmitted;
  }

  public getSenderId(): string {
    return this.senderId;
  }
}

export class PeerLivenessMonitor {
  private readonly missedBeatThreshold: number;
  private readonly defaultIntervalMs: number;
  private readonly clock: () => number;
  private readonly peers = new Map<string, PeerLivenessStatus>();

  public constructor(config: LivenessMonitorConfig = {}) {
    this.missedBeatThreshold =
      config.missed_beat_threshold !== undefined && config.missed_beat_threshold > 0
        ? config.missed_beat_threshold
        : 2;
    this.defaultIntervalMs =
      config.default_interval_ms !== undefined && config.default_interval_ms > 0
        ? config.default_interval_ms
        : 5000;
    this.clock = config.clock ?? Date.now;
  }

  public registerPeer(peerId: string, expectedIntervalMs?: number): void {
    if (!this.peers.has(peerId)) {
      const interval =
        expectedIntervalMs !== undefined && expectedIntervalMs > 0
          ? expectedIntervalMs
          : this.defaultIntervalMs;
      this.peers.set(peerId, {
        peer_id: peerId,
        state: "unknown",
        last_heartbeat: null,
        last_received_at: null,
        consecutive_missed_beats: 0,
        declared_interval_ms: interval,
        freeze_state: null,
      });
    }
  }

  public recordHeartbeat(heartbeat: HeartbeatPayload): PeerLivenessStatus {
    const peerId = heartbeat.sender_id;
    const now = this.clock();
    const receivedAt = new Date(now).toISOString();
    const interval =
      heartbeat.next_beat_interval_ms > 0
        ? heartbeat.next_beat_interval_ms
        : this.defaultIntervalMs;

    let nextState: PeerLivenessStatus["state"] = "alive";
    let freezeState: FreezeState | null = null;
    let reason: string | undefined = undefined;

    if (heartbeat.freeze_state) {
      nextState = "frozen";
      freezeState = heartbeat.freeze_state;
      reason = `Declared freeze: ${heartbeat.freeze_state.kind} - ${heartbeat.freeze_state.reason}`;
    }

    const updated: PeerLivenessStatus = {
      peer_id: peerId,
      state: nextState,
      last_heartbeat: heartbeat,
      last_received_at: receivedAt,
      consecutive_missed_beats: 0,
      declared_interval_ms: interval,
      freeze_state: freezeState,
      ...(reason !== undefined ? { reason } : {}),
    };

    this.peers.set(peerId, updated);
    return updated;
  }

  public checkLiveness(peerId: string): PeerLivenessStatus {
    const existing = this.peers.get(peerId);
    if (!existing || existing.last_received_at === null || existing.last_heartbeat === null) {
      const fallback: PeerLivenessStatus = existing ?? {
        peer_id: peerId,
        state: "unknown",
        last_heartbeat: null,
        last_received_at: null,
        consecutive_missed_beats: 0,
        declared_interval_ms: this.defaultIntervalMs,
        freeze_state: null,
      };
      if (!existing) {
        this.peers.set(peerId, fallback);
      }
      return fallback;
    }

    if (existing.freeze_state !== null) {
      return existing;
    }

    const now = this.clock();
    const lastTime = new Date(existing.last_received_at).getTime();
    const elapsed = Math.max(0, now - lastTime);
    const interval =
      existing.declared_interval_ms > 0 ? existing.declared_interval_ms : this.defaultIntervalMs;
    const missedBeats = Math.floor(elapsed / interval);

    if (missedBeats >= this.missedBeatThreshold) {
      const unreachableStatus: PeerLivenessStatus = {
        ...existing,
        state: "unreachable",
        consecutive_missed_beats: missedBeats,
        reason: `Missing ${missedBeats} consecutive heartbeat(s) (elapsed ${elapsed}ms >= threshold ${this.missedBeatThreshold} * interval ${interval}ms)`,
      };
      this.peers.set(peerId, unreachableStatus);
      return unreachableStatus;
    }

    const updated: PeerLivenessStatus = {
      ...existing,
      consecutive_missed_beats: missedBeats,
    };
    this.peers.set(peerId, updated);
    return updated;
  }

  public checkAllPeers(): Readonly<Record<string, PeerLivenessStatus>> {
    const result: Record<string, PeerLivenessStatus> = {};
    for (const peerId of this.peers.keys()) {
      result[peerId] = this.checkLiveness(peerId);
    }
    return result;
  }

  public getPeerStatus(peerId: string): PeerLivenessStatus | null {
    return this.peers.get(peerId) ?? null;
  }

  public getAllPeerStatuses(): Readonly<Record<string, PeerLivenessStatus>> {
    const result: Record<string, PeerLivenessStatus> = {};
    for (const [id, status] of this.peers.entries()) {
      result[id] = status;
    }
    return result;
  }

  public resetPeer(peerId: string): void {
    this.peers.delete(peerId);
  }
}
