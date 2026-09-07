import { describe, expect, it } from "bun:test";
import { dirname } from "node:path";
import {
  computeDaemonState,
  createInitialHealthRecord,
  readHealthRecord,
  stampStoppedIfOwned,
  syncDaemonHealth,
  writeHealthRecord,
  type DaemonHealthRecord,
  type HealthClaimOptions,
  type HealthPorts,
} from "../../src/daemon/index.ts";
import { ChatVirtualFS } from "../../src/testing/virtual-fs/index.ts";

const HEALTH_PATH = "/rooms/claude-antigravity/daemon/claude-code-skills.health.json";
const ROOM = "claude-antigravity";
const READER = "claude-code-skills";
const WAKE_ISO = "2026-09-07T17:09:41.189Z";
const WAKE_MS = Date.parse(WAKE_ISO);
const METRICS = { watch_active: true, watch_failures: 0, poll_interval_ms: 750 } as const;

function createHealthPorts(vfs: ChatVirtualFS): HealthPorts {
  return {
    existsSync: (target: string) => vfs.existsSync(target),
    readFileSync: (target: string, encoding: string) =>
      vfs.readFileSync(target, encoding) as string,
    writeFileSync: (target: string, content: string) => {
      vfs.mkdirSync(dirname(target), { recursive: true });
      vfs.writeFileSync(target, content);
    },
  };
}

function seedDepartedPredecessorRecord(
  vfs: ChatVirtualFS,
  ports: HealthPorts,
  pid: number,
): DaemonHealthRecord {
  const base = createInitialHealthRecord(ROOM, READER, pid, WAKE_ISO, "boot", 750);
  const record: DaemonHealthRecord = {
    ...base,
    state: "STOPPED",
    last_wake_at: WAKE_ISO,
    last_wake_source: "poll",
    last_delivered_seq: 145,
    room_head_seq: 145,
    lag_seqs: 0,
    watch_active: false,
  };
  writeHealthRecord(HEALTH_PATH, record, ports);
  return record;
}

function claimFor(vfs: ChatVirtualFS, pid: number, nowIso: string): HealthClaimOptions {
  return {
    room: ROOM,
    reader: READER,
    pid,
    startTime: nowIso,
    pollIntervalMs: 750,
    isProcessAlive: (candidate: number) => vfs.isProcessAlive(candidate),
  };
}

function wakeAt(
  vfs: ChatVirtualFS,
  ports: HealthPorts,
  nowIso: string,
  wakingPid: number,
): DaemonHealthRecord | null {
  return syncDaemonHealth({
    healthPath: HEALTH_PATH,
    nowIso,
    metrics: METRICS,
    source: "poll",
    claim: claimFor(vfs, wakingPid, nowIso),
    compute: { isProcessAlive: (pid: number) => vfs.isProcessAlive(pid) },
    ports,
  });
}

describe("the state a daemon wake persists is the state it computes", () => {
  it("persists IDLE when a live daemon wakes onto a record a departed predecessor left STOPPED", () => {
    const vfs = new ChatVirtualFS(WAKE_MS);
    const ports = createHealthPorts(vfs);
    const livePid = vfs.spawnProcess({ cmd: "chatroom-daemon" });
    const seeded = seedDepartedPredecessorRecord(vfs, ports, livePid);

    expect(readHealthRecord(HEALTH_PATH, ports)?.state).toBe("STOPPED");
    expect(
      computeDaemonState(seeded, WAKE_MS, {
        isProcessAlive: (pid: number) => vfs.isProcessAlive(pid),
      }),
    ).toBe("IDLE");

    wakeAt(vfs, ports, WAKE_ISO, livePid);

    const persisted = readHealthRecord(HEALTH_PATH, ports);
    expect(persisted?.state).toBe("IDLE");
    expect(persisted?.pid).toBe(livePid);
    expect(persisted?.last_wake_at).toBe(WAKE_ISO);
    expect(persisted?.watch_active).toBe(true);
  });

  it("keeps persisting IDLE across repeated wakes with no new messages", () => {
    const vfs = new ChatVirtualFS(WAKE_MS);
    const ports = createHealthPorts(vfs);
    const livePid = vfs.spawnProcess({ cmd: "chatroom-daemon" });
    seedDepartedPredecessorRecord(vfs, ports, livePid);

    const observed: string[] = [];
    for (let i = 1; i <= 12; i++) {
      const nowIso = new Date(WAKE_MS + i * 750).toISOString();
      wakeAt(vfs, ports, nowIso, livePid);
      observed.push(readHealthRecord(HEALTH_PATH, ports)?.state ?? "MISSING");
    }

    expect(observed).toEqual(Array.from({ length: 12 }, () => "IDLE"));
  });

  it("persists STOPPED when the record names a process that is genuinely gone", () => {
    const vfs = new ChatVirtualFS(WAKE_MS);
    const ports = createHealthPorts(vfs);
    const deadPid = vfs.spawnProcess({ cmd: "chatroom-daemon" });
    const base = seedDepartedPredecessorRecord(vfs, ports, deadPid);
    writeHealthRecord(HEALTH_PATH, { ...base, state: "IDLE" }, ports);
    vfs.killProcess(deadPid);

    wakeAt(vfs, ports, WAKE_ISO, deadPid);

    expect(readHealthRecord(HEALTH_PATH, ports)?.state).toBe("STOPPED");
  });

  it("persists BACKPRESSURED rather than downgrading a backpressured daemon to IDLE", () => {
    const vfs = new ChatVirtualFS(WAKE_MS);
    const ports = createHealthPorts(vfs);
    const livePid = vfs.spawnProcess({ cmd: "chatroom-daemon" });
    const base = seedDepartedPredecessorRecord(vfs, ports, livePid);
    writeHealthRecord(HEALTH_PATH, { ...base, state: "BACKPRESSURED" }, ports);

    wakeAt(vfs, ports, WAKE_ISO, livePid);

    expect(readHealthRecord(HEALTH_PATH, ports)?.state).toBe("BACKPRESSURED");
  });
});

describe("a daemon wake re-asserts ownership of a record left by a dead predecessor", () => {
  it("persists its own pid and IDLE when the record still names a dead predecessor", () => {
    const vfs = new ChatVirtualFS(WAKE_MS);
    const ports = createHealthPorts(vfs);
    const deadPid = vfs.spawnProcess({ cmd: "chatroom-daemon" });
    const livePid = vfs.spawnProcess({ cmd: "chatroom-daemon" });
    seedDepartedPredecessorRecord(vfs, ports, deadPid);
    vfs.killProcess(deadPid);

    wakeAt(vfs, ports, WAKE_ISO, livePid);

    const persisted = readHealthRecord(HEALTH_PATH, ports);
    expect(persisted?.pid).toBe(livePid);
    expect(persisted?.state).toBe("IDLE");
    expect(persisted?.last_delivered_seq).toBe(145);
  });

  it("never steals a record whose named daemon is still alive", () => {
    const vfs = new ChatVirtualFS(WAKE_MS);
    const ports = createHealthPorts(vfs);
    const incumbentPid = vfs.spawnProcess({ cmd: "chatroom-daemon" });
    const challengerPid = vfs.spawnProcess({ cmd: "chatroom-daemon" });
    const seeded = seedDepartedPredecessorRecord(vfs, ports, incumbentPid);
    writeHealthRecord(HEALTH_PATH, { ...seeded, state: "IDLE" }, ports);

    const res = wakeAt(vfs, ports, WAKE_ISO, challengerPid);
    expect(res).toBeNull();

    const persisted = readHealthRecord(HEALTH_PATH, ports);
    expect(persisted?.pid).toBe(incumbentPid);
    expect(persisted?.state).toBe("IDLE");
  });
});

describe("a departing daemon only stamps STOPPED on the record it owns", () => {
  it("leaves a successor's claimed record untouched when the predecessor exits", () => {
    const vfs = new ChatVirtualFS(WAKE_MS);
    const ports = createHealthPorts(vfs);
    const successorPid = vfs.spawnProcess({ cmd: "chatroom-daemon" });
    const departingPid = vfs.spawnProcess({ cmd: "chatroom-daemon" });
    const base = seedDepartedPredecessorRecord(vfs, ports, successorPid);
    writeHealthRecord(HEALTH_PATH, { ...base, state: "IDLE", watch_active: true }, ports);

    const stamped = stampStoppedIfOwned(HEALTH_PATH, departingPid, WAKE_ISO, ports);

    expect(stamped).toBe(false);
    const persisted = readHealthRecord(HEALTH_PATH, ports);
    expect(persisted?.state).toBe("IDLE");
    expect(persisted?.pid).toBe(successorPid);
    expect(persisted?.watch_active).toBe(true);
  });

  it("stamps STOPPED when the exiting daemon is still the record owner", () => {
    const vfs = new ChatVirtualFS(WAKE_MS);
    const ports = createHealthPorts(vfs);
    const ownerPid = vfs.spawnProcess({ cmd: "chatroom-daemon" });
    const base = seedDepartedPredecessorRecord(vfs, ports, ownerPid);
    writeHealthRecord(HEALTH_PATH, { ...base, state: "IDLE", watch_active: true }, ports);

    const stamped = stampStoppedIfOwned(HEALTH_PATH, ownerPid, WAKE_ISO, ports);

    expect(stamped).toBe(true);
    const persisted = readHealthRecord(HEALTH_PATH, ports);
    expect(persisted?.state).toBe("STOPPED");
    expect(persisted?.watch_active).toBe(false);
    expect(persisted?.updated_at).toBe(WAKE_ISO);
  });

  it("writes nothing when no health record exists at all", () => {
    const vfs = new ChatVirtualFS(WAKE_MS);
    const ports = createHealthPorts(vfs);

    expect(stampStoppedIfOwned(HEALTH_PATH, 1, WAKE_ISO, ports)).toBe(false);
    expect(readHealthRecord(HEALTH_PATH, ports)).toBeNull();
  });
});
