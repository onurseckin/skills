import { describe, expect, it } from "bun:test";
import {
  HeartbeatEmitter,
  PeerLivenessMonitor,
} from "../../../olt/scripts/src/liaison/daemon/liveness.ts";
import type {
  FreezeState,
  HeartbeatPayload,
} from "../../../olt/scripts/src/liaison/daemon/types.ts";

describe("HeartbeatEmitter", () => {
  it("emits positive liveness heartbeats with monotonic sequence and declared interval", () => {
    let mockTime = 10000;
    const clock = () => mockTime;
    const emitter = new HeartbeatEmitter("liaison_system_a", 3000, clock);

    expect(emitter.getSenderId()).toBe("liaison_system_a");
    expect(emitter.getLastEmittedHeartbeat()).toBeNull();

    const beat1 = emitter.emitHeartbeat(["run-1"], "processing");
    expect(beat1.sender_id).toBe("liaison_system_a");
    expect(beat1.sequence).toBe(1);
    expect(beat1.next_beat_interval_ms).toBe(3000);
    expect(beat1.active_run_ids).toEqual(["run-1"]);
    expect(beat1.status).toBe("processing");
    expect(beat1.timestamp).toBe(new Date(10000).toISOString());
    expect(beat1.freeze_state).toBeNull();
    expect(emitter.getLastEmittedHeartbeat()).toEqual(beat1);

    mockTime += 3000;
    const beat2 = emitter.emitHeartbeat(["run-1", "run-2"], "idle", 5000);
    expect(beat2.sequence).toBe(2);
    expect(beat2.next_beat_interval_ms).toBe(5000);
    expect(beat2.active_run_ids).toEqual(["run-1", "run-2"]);
    expect(beat2.status).toBe("idle");
  });

  it("handles declared freeze states in emitted heartbeats", () => {
    const emitter = new HeartbeatEmitter("liaison_system_a", 2000);
    const freeze: FreezeState = {
      kind: "quota_freeze",
      reason: "LLM token rate limit reached",
      entered_at: new Date().toISOString(),
      expected_resume_at: new Date(Date.now() + 60000).toISOString(),
    };

    emitter.declareFreeze(freeze);
    expect(emitter.getFreezeState()).toEqual(freeze);

    const beat = emitter.emitHeartbeat([], "frozen:quota_freeze");
    expect(beat.freeze_state).toEqual(freeze);
    expect(beat.status).toBe("frozen:quota_freeze");

    emitter.clearFreeze();
    expect(emitter.getFreezeState()).toBeNull();

    const beatAfterClear = emitter.emitHeartbeat(["run-1"], "running");
    expect(beatAfterClear.freeze_state).toBeNull();
  });
});

describe("PeerLivenessMonitor", () => {
  it("initializes peer as unknown until first heartbeat", () => {
    const monitor = new PeerLivenessMonitor({
      missed_beat_threshold: 2,
      default_interval_ms: 1000,
    });
    monitor.registerPeer("peer_system_b");

    const status = monitor.checkLiveness("peer_system_b");
    expect(status.peer_id).toBe("peer_system_b");
    expect(status.state).toBe("unknown");
    expect(status.last_heartbeat).toBeNull();
    expect(status.last_received_at).toBeNull();
    expect(status.consecutive_missed_beats).toBe(0);
  });

  it("marks peer as alive upon receiving positive heartbeat", () => {
    let mockTime = 5000;
    const monitor = new PeerLivenessMonitor({
      missed_beat_threshold: 2,
      default_interval_ms: 2000,
      clock: () => mockTime,
    });

    const payload: HeartbeatPayload = {
      sender_id: "peer_system_b",
      sequence: 1,
      timestamp: new Date(mockTime).toISOString(),
      next_beat_interval_ms: 2000,
      active_run_ids: ["run-x"],
      status: "active",
      freeze_state: null,
    };

    const recorded = monitor.recordHeartbeat(payload);
    expect(recorded.state).toBe("alive");
    expect(recorded.consecutive_missed_beats).toBe(0);
    expect(recorded.declared_interval_ms).toBe(2000);
    expect(recorded.last_heartbeat).toEqual(payload);
  });

  it("marks peer as unreachable when missing N consecutive beats", () => {
    let mockTime = 10000;
    const monitor = new PeerLivenessMonitor({
      missed_beat_threshold: 2,
      default_interval_ms: 1000,
      clock: () => mockTime,
    });

    const payload: HeartbeatPayload = {
      sender_id: "peer_system_b",
      sequence: 1,
      timestamp: new Date(mockTime).toISOString(),
      next_beat_interval_ms: 1000,
      active_run_ids: [],
      status: "active",
      freeze_state: null,
    };
    monitor.recordHeartbeat(payload);

    // 900ms elapsed: 0 missed beats (< 1 interval)
    mockTime += 900;
    let status = monitor.checkLiveness("peer_system_b");
    expect(status.state).toBe("alive");
    expect(status.consecutive_missed_beats).toBe(0);

    // 1500ms elapsed: 1 missed beat (< threshold 2)
    mockTime += 600;
    status = monitor.checkLiveness("peer_system_b");
    expect(status.state).toBe("alive");
    expect(status.consecutive_missed_beats).toBe(1);

    // 2100ms elapsed: 2 missed beats (>= threshold 2) -> UNREACHABLE
    mockTime += 600;
    status = monitor.checkLiveness("peer_system_b");
    expect(status.state).toBe("unreachable");
    expect(status.consecutive_missed_beats).toBe(2);
    expect(status.reason).toContain("Missing 2 consecutive heartbeat(s)");

    // Recovery: peer sends another heartbeat
    mockTime += 500;
    const recoveryPayload: HeartbeatPayload = {
      ...payload,
      sequence: 2,
      timestamp: new Date(mockTime).toISOString(),
    };
    const recovered = monitor.recordHeartbeat(recoveryPayload);
    expect(recovered.state).toBe("alive");
    expect(recovered.consecutive_missed_beats).toBe(0);
  });

  it("treats declared freeze as frozen state rather than unreachable fault", () => {
    let mockTime = 10000;
    const monitor = new PeerLivenessMonitor({
      missed_beat_threshold: 2,
      default_interval_ms: 1000,
      clock: () => mockTime,
    });

    const freeze: FreezeState = {
      kind: "graceful_shutdown",
      reason: "Shutting down for scheduled maintenance",
      entered_at: new Date(mockTime).toISOString(),
    };

    const freezeBeat: HeartbeatPayload = {
      sender_id: "peer_system_c",
      sequence: 1,
      timestamp: new Date(mockTime).toISOString(),
      next_beat_interval_ms: 1000,
      active_run_ids: [],
      status: "stopping",
      freeze_state: freeze,
    };

    const recorded = monitor.recordHeartbeat(freezeBeat);
    expect(recorded.state).toBe("frozen");
    expect(recorded.freeze_state).toEqual(freeze);
    expect(recorded.reason).toContain("graceful_shutdown");

    // Even after 10000ms (10 missed intervals), remains frozen, NOT unreachable fault
    mockTime += 10000;
    const status = monitor.checkLiveness("peer_system_c");
    expect(status.state).toBe("frozen");
    expect(status.freeze_state).toEqual(freeze);
  });

  it("checks all peers and supports peer removal", () => {
    const monitor = new PeerLivenessMonitor();
    monitor.registerPeer("p1");
    monitor.registerPeer("p2");

    const statuses = monitor.checkAllPeers();
    expect(Object.keys(statuses)).toEqual(["p1", "p2"]);

    monitor.resetPeer("p1");
    const afterReset = monitor.getAllPeerStatuses();
    expect(Object.keys(afterReset)).toEqual(["p2"]);
  });
});
