import { describe, expect, it } from "bun:test";
import { LiaisonDaemonService } from "../../../olt/scripts/src/liaison/daemon/service.ts";
import type {
  HeartbeatLapseEvent,
  HeartbeatPayload,
  TransitionEvent,
} from "../../../olt/scripts/src/liaison/daemon/types.ts";

describe("LiaisonDaemonService", () => {
  it("initializes and reports snapshot state cleanly", () => {
    const service = new LiaisonDaemonService({
      daemon_id: "daemon-test-1",
      capsule_dir: ".olt/capsules/cross-system-communication-system",
      repo_root: process.cwd(),
      heartbeat_interval_ms: 1000,
      peer_ids: ["peer-alpha"],
    });

    expect(service.isRunning()).toBe(false);
    expect(service.isDegraded()).toBe(false);

    const snapshot = service.getSnapshot();
    expect(snapshot.daemon_id).toBe("daemon-test-1");
    expect(snapshot.is_running).toBe(false);
    expect(snapshot.last_emitted_heartbeat).toBeNull();
    expect(snapshot.peer_liveness["peer-alpha"]).toBeDefined();
    expect(snapshot.peer_liveness["peer-alpha"]?.state).toBe("unknown");
  });

  it("orchestrates tick, emits heartbeat, and projects capsule state", async () => {
    let mockTime = 50000;
    const service = new LiaisonDaemonService({
      daemon_id: "daemon-test-2",
      capsule_dir: ".olt/capsules/cross-system-communication-system",
      repo_root: process.cwd(),
      heartbeat_interval_ms: 1000,
      active_run_ids: ["cross-system-communication-system"],
      status: "operational",
      clock: () => mockTime,
    });

    const snapshot = await service.tick();
    expect(snapshot.last_emitted_heartbeat).toBeDefined();
    expect(snapshot.last_emitted_heartbeat?.sender_id).toBe("daemon-test-2");
    expect(snapshot.last_emitted_heartbeat?.sequence).toBe(1);
    expect(snapshot.last_emitted_heartbeat?.active_run_ids).toEqual([
      "cross-system-communication-system",
    ]);
    expect(snapshot.projection).toBeDefined();
    expect(snapshot.projection?.run_id).toBe("cross-system-communication-system");
    expect(snapshot.projection?.tasks.length).toBeGreaterThanOrEqual(4);
  });

  it("pushes heartbeat lapse event when monitored peer goes unreachable", async () => {
    let mockTime = 10000;
    const service = new LiaisonDaemonService({
      daemon_id: "daemon-test-3",
      capsule_dir: ".olt/capsules/cross-system-communication-system",
      repo_root: process.cwd(),
      heartbeat_interval_ms: 1000,
      missed_beat_threshold: 2,
      peer_ids: ["peer-beta"],
      clock: () => mockTime,
    });

    const capturedEvents: TransitionEvent[] = [];
    service.subscribe((event) => {
      capturedEvents.push(event);
    }, "heartbeat_lapse");

    // Peer emits first heartbeat at t=10000
    const peerBeat: HeartbeatPayload = {
      sender_id: "peer-beta",
      sequence: 1,
      timestamp: new Date(mockTime).toISOString(),
      next_beat_interval_ms: 1000,
      active_run_ids: [],
      status: "alive",
      freeze_state: null,
    };
    service.recordPeerHeartbeat(peerBeat);

    // Tick at t=10500: peer is alive
    mockTime += 500;
    await service.tick();
    expect(capturedEvents.length).toBe(0);

    // Advance past 2 missed beats: t=12500 (2.5 intervals missed >= threshold 2)
    mockTime += 2000;
    await service.tick();

    expect(capturedEvents.length).toBe(1);
    const lapseEvent = capturedEvents[0] as HeartbeatLapseEvent;
    expect(lapseEvent.type).toBe("heartbeat_lapse");
    expect(lapseEvent.peer_id).toBe("peer-beta");
    expect(lapseEvent.missed_beats).toBeGreaterThanOrEqual(2);
  });

  it("enters and exits freeze cleanly with immediate heartbeat assertion", () => {
    let mockTime = 20000;
    const service = new LiaisonDaemonService({
      daemon_id: "daemon-test-freeze",
      capsule_dir: ".olt/capsules/cross-system-communication-system",
      repo_root: process.cwd(),
      clock: () => mockTime,
    });

    const freezeBeat = service.enterFreeze("quota_freeze", "Hit LLM TPM limit");
    expect(freezeBeat.freeze_state).toBeDefined();
    expect(freezeBeat.freeze_state?.kind).toBe("quota_freeze");
    expect(freezeBeat.status).toBe("freeze:quota_freeze");

    const exitBeat = service.exitFreeze();
    expect(exitBeat.freeze_state).toBeNull();
  });

  it("handles lifecycle start and stop gracefully", async () => {
    const service = new LiaisonDaemonService({
      daemon_id: "daemon-lifecycle",
      capsule_dir: ".olt/capsules/cross-system-communication-system",
      repo_root: process.cwd(),
      heartbeat_interval_ms: 10000,
    });

    await service.start();
    expect(service.isRunning()).toBe(true);

    service.stop();
    expect(service.isRunning()).toBe(false);

    const snapshot = service.getSnapshot();
    expect(snapshot.last_emitted_heartbeat?.freeze_state?.kind).toBe("graceful_shutdown");
  });

  it("degrades gracefully to direct inspection without halting communication", async () => {
    // Pointing to empty or non-standard directory
    const service = new LiaisonDaemonService({
      daemon_id: "daemon-degraded",
      capsule_dir: "/tmp/nonexistent-daemon-fallback-dir",
      repo_root: process.cwd(),
      gitRunner: () => ({ ok: false, stdout: "", stderr: "git error" }),
    });

    // Tick should not throw
    const snapshot = await service.tick();
    expect(snapshot).toBeDefined();
    expect(snapshot.last_emitted_heartbeat).toBeDefined();
    expect(service.isRunning()).toBe(false);
  });
});
