import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  daemonHealthPath,
  daemonLockPath,
  type LockPayload,
} from "../../../chatroom/scripts/src/core/index.ts";
import {
  ensureDaemon,
  inspectDaemon,
  runDaemonLoop,
  startDaemon,
  stepDaemonLoop,
  type EnsureDaemonPorts,
  type SupervisorPorts,
} from "../../../chatroom/scripts/src/daemon/index.ts";
import { addMember } from "../../../chatroom/scripts/src/room/index.ts";
import {
  cleanupVirtualChatroomFS,
  createTestRoom,
  getVirtualChatroomFS,
  setupVirtualChatroomFS,
} from "../helpers.ts";

function writeLockFile(
  room: string,
  reader: string,
  pid: number,
  startTime: string = "2026-09-07T12:00:00.000Z",
): string {
  const vfs = getVirtualChatroomFS();
  const lockPath = daemonLockPath(room, reader);
  const payload: LockPayload = {
    pid,
    start_time: startTime,
    boot_id: "boot-test",
    holder: `daemon:${room}:${reader}`,
    host: "virtual",
    created_at: startTime,
  };
  const dir = lockPath.slice(0, lockPath.lastIndexOf("/"));
  vfs.mkdirSync(dir, { recursive: true });
  vfs.writeFileSync(lockPath, JSON.stringify(payload, null, 2) + "\n");
  return lockPath;
}

function writeHealthFile(
  room: string,
  reader: string,
  pid: number,
  state: "LIVE" | "STOPPED" = "LIVE",
): string {
  const vfs = getVirtualChatroomFS();
  const healthPath = daemonHealthPath(room, reader);
  const dir = healthPath.slice(0, healthPath.lastIndexOf("/"));
  vfs.mkdirSync(dir, { recursive: true });
  const health = {
    v: 1,
    room,
    reader,
    pid,
    start_time: "2026-09-07T12:00:00.000Z",
    boot_id: "boot-test",
    state,
    last_wake_at: new Date().toISOString(),
    last_wake_source: "test",
    last_delivered_seq: 0,
    room_head_seq: 0,
    lag_seqs: 0,
    watch_active: false,
    watch_failures: 0,
    poll_interval_ms: 750,
    spool_bytes: 0,
    spool_lines: 0,
    consumer_last_ack_at: null,
    consumer_lag_ms: null,
    respawns_this_hour: 0,
    errors_recent: [],
  };
  vfs.writeFileSync(healthPath, JSON.stringify(health, null, 2) + "\n");
  return healthPath;
}

beforeEach(() => {
  setupVirtualChatroomFS();
});

afterEach(() => {
  cleanupVirtualChatroomFS();
});

describe("Daemon Auto-Cleanup and Stale Lock Reconciliation (T-6c10)", () => {
  it("automatically purges stale lock and dead health records on inspectDaemon", () => {
    const vfs = getVirtualChatroomFS();
    const room = "stale-inspect-room";
    const reader = "agent-stale";
    createTestRoom({ id: room, title: "Stale Room", visibility: "public", createdBy: reader });
    addMember(room, { id: reader, role: "agent", host: "antigravity" });

    const deadPid = 99101;
    const lockPath = writeLockFile(room, reader, deadPid);
    const healthPath = writeHealthFile(room, reader, deadPid);

    expect(vfs.existsSync(lockPath)).toBe(true);
    expect(vfs.existsSync(healthPath)).toBe(true);

    const inspection = inspectDaemon(room, reader, {
      isProcessAlive: (pid) => pid !== deadPid,
    });

    expect(inspection.state).toBe("STOPPED");
    expect(inspection.health).toBeNull();
    expect(vfs.existsSync(lockPath)).toBe(false);
    expect(vfs.existsSync(healthPath)).toBe(false);
  });

  it("automatically purges stale lock on startDaemon and spawns fresh", () => {
    const vfs = getVirtualChatroomFS();
    const room = "stale-start-room";
    const reader = "agent-restart";
    createTestRoom({ id: room, title: "Restart Room", visibility: "public", createdBy: reader });
    addMember(room, { id: reader, role: "agent", host: "antigravity" });

    const deadPid = 99102;
    const livePid = 99103;
    const lockPath = writeLockFile(room, reader, deadPid);
    const healthPath = writeHealthFile(room, reader, deadPid, "STOPPED");

    expect(vfs.existsSync(lockPath)).toBe(true);
    expect(vfs.existsSync(healthPath)).toBe(true);

    const ports: SupervisorPorts = {
      isProcessAlive: (pid) => pid === livePid,
      spawnDetached: () => {
        writeHealthFile(room, reader, livePid, "LIVE");
        return livePid;
      },
    };

    const res = startDaemon({
      room,
      reader,
      ports,
      verifyAlive: true,
      gracePeriodMs: 50,
    });

    expect(res.status).toBe("started");
    expect(res.pid).toBe(livePid);
  });

  it("clears stale lock and dead health in ensureDaemon and spawns fresh", () => {
    const vfs = getVirtualChatroomFS();
    const room = "stale-ensure-room";
    const reader = "agent-ensure";
    createTestRoom({ id: room, title: "Ensure Room", visibility: "public", createdBy: reader });
    addMember(room, { id: reader, role: "agent", host: "antigravity" });

    const deadPid = 99104;
    const freshPid = 99105;
    const lockPath = writeLockFile(room, reader, deadPid);
    const healthPath = writeHealthFile(room, reader, deadPid);

    const ports: EnsureDaemonPorts = {
      existsSync: (p) => vfs.existsSync(p),
      readFileSync: (p) => vfs.readFileSync(p, "utf8"),
      unlinkSync: (p) => vfs.unlinkSync(p),
      isProcessAlive: (pid) => pid === freshPid,
      now: () => Date.now(),
    };

    const supervisorPorts: SupervisorPorts = {
      isProcessAlive: (pid) => pid === freshPid,
      spawnDetached: () => {
        writeHealthFile(room, reader, freshPid, "LIVE");
        return freshPid;
      },
    };

    const res = ensureDaemon(room, reader, {
      autoStart: true,
      ports: {
        ...ports,
        ...supervisorPorts,
      },
    });

    expect(res.status).toBe("started");
    expect(res.pid).toBe(freshPid);
  });

  it("prevents duplicate daemon spawn when lock is held by living PID", () => {
    const vfs = getVirtualChatroomFS();
    const room = "duplicate-prevention-room";
    const reader = "agent-incumbent";
    createTestRoom({ id: room, title: "Incumbent Room", visibility: "public", createdBy: reader });
    addMember(room, { id: reader, role: "agent", host: "antigravity" });

    const livingPid = 77101;
    writeLockFile(room, reader, livingPid);
    writeHealthFile(room, reader, livingPid, "LIVE");

    let spawned = false;
    const ports: SupervisorPorts = {
      isProcessAlive: (pid) => pid === livingPid,
      spawnDetached: () => {
        spawned = true;
        return 99999;
      },
    };

    const startRes = startDaemon({
      room,
      reader,
      ports,
    });

    expect(startRes.status).toBe("already_running");
    expect(startRes.pid).toBe(livingPid);
    expect(spawned).toBe(false);

    const ensureRes = ensureDaemon(room, reader, {
      ports: {
        existsSync: (p) => vfs.existsSync(p),
        readFileSync: (p) => vfs.readFileSync(p, "utf8"),
        isProcessAlive: (pid) => pid === livingPid,
        now: () => Date.now(),
      },
      autoStart: true,
    });

    expect(ensureRes.status).toBe("running");
    expect(ensureRes.pid).toBe(livingPid);
    expect(spawned).toBe(false);
  });

  it("self-terminates stepDaemonLoop when lock is lost or stolen", () => {
    const vfs = getVirtualChatroomFS();
    const room = "step-loss-room";
    const reader = "agent-steploss";
    createTestRoom({ id: room, title: "Step Loss Room", visibility: "public", createdBy: reader });
    addMember(room, { id: reader, role: "agent", host: "antigravity" });

    const myPid = process.pid;
    const lockPath = writeLockFile(room, reader, myPid);

    const stepOk = stepDaemonLoop({
      room,
      reader,
      verifyLock: true,
      expectedPid: myPid,
    });
    expect(stepOk.lockLost).toBeUndefined();

    vfs.unlinkSync(lockPath);

    let reportedReason = "";
    const stepMissing = stepDaemonLoop({
      room,
      reader,
      verifyLock: true,
      expectedPid: myPid,
      onLockLoss: (reason) => {
        reportedReason = reason;
      },
    });
    expect(stepMissing.lockLost).toBe(true);
    expect(reportedReason).toBe("missing");

    const thiefPid = 88201;
    writeLockFile(room, reader, thiefPid);

    const stepStolen = stepDaemonLoop({
      room,
      reader,
      verifyLock: true,
      expectedPid: myPid,
      healthPorts: {
        isProcessAlive: (pid) => pid === thiefPid,
      },
      onLockLoss: (reason) => {
        reportedReason = reason;
      },
    });
    expect(stepStolen.lockLost).toBe(true);
    expect(reportedReason).toBe("stolen");
  });

  it("cleanly self-terminates running daemon when lock is released during loop", async () => {
    const vfs = getVirtualChatroomFS();
    const room = "loop-release-room";
    const reader = "agent-looprelease";
    createTestRoom({ id: room, title: "Loop Release", visibility: "public", createdBy: reader });
    addMember(room, { id: reader, role: "agent", host: "antigravity" });

    let lossReason = "";
    const loopPromise = runDaemonLoop({
      room,
      reader,
      pollIntervalMs: 20,
      onLockLoss: (reason) => {
        lossReason = reason;
      },
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 30));

    const lockPath = daemonLockPath(room, reader);
    expect(vfs.existsSync(lockPath)).toBe(true);

    vfs.unlinkSync(lockPath);

    await loopPromise;

    expect(lossReason).toBe("missing");
  });

  it("cleanly self-terminates running daemon and preserves new lock when lock is stolen", async () => {
    const vfs = getVirtualChatroomFS();
    const room = "loop-stolen-room";
    const reader = "agent-loopstolen";
    createTestRoom({ id: room, title: "Loop Stolen", visibility: "public", createdBy: reader });
    addMember(room, { id: reader, role: "agent", host: "antigravity" });

    const thiefPid = 99301;
    let lossReason = "";

    const loopPromise = runDaemonLoop({
      room,
      reader,
      pollIntervalMs: 20,
      healthPorts: {
        isProcessAlive: (pid) => pid === process.pid || pid === thiefPid,
      },
      onLockLoss: (reason) => {
        lossReason = reason;
      },
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 30));

    const lockPath = daemonLockPath(room, reader);
    expect(vfs.existsSync(lockPath)).toBe(true);

    writeLockFile(room, reader, thiefPid);

    await loopPromise;

    expect(lossReason).toBe("stolen");
    expect(vfs.existsSync(lockPath)).toBe(true);
    const content = JSON.parse(vfs.readFileSync(lockPath, "utf8")) as { pid?: unknown };
    expect(content.pid).toBe(thiefPid);
  });
});
