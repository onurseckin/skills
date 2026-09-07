import { describe, expect, it } from "bun:test";
import { dirname } from "node:path";
import {
  claimHealthRecord,
  computeDaemonState,
  createInitialHealthRecord,
  readHealthRecord,
  writeHealthRecord,
  type DaemonHealthRecord,
  type HealthPorts,
} from "../../src/daemon/index.ts";
import { ChatVirtualFS } from "../../src/testing/virtual-fs/index.ts";

const HEALTH_PATH = "/rooms/claude-antigravity/daemon/claude-code-skills.health.json";
const ROOM = "claude-antigravity";
const READER = "claude-code-skills";

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

function seedRecord(
  vfs: ChatVirtualFS,
  ports: HealthPorts,
  overrides: Partial<DaemonHealthRecord>,
): DaemonHealthRecord {
  const base = createInitialHealthRecord(ROOM, READER, 1, "2026-09-07T08:54:26.193Z", "boot", 750);
  const record: DaemonHealthRecord = { ...base, ...overrides };
  writeHealthRecord(HEALTH_PATH, record, ports);
  return record;
}

describe("daemon health record tells the truth about its owning process", () => {
  it("rewrites pid and state when a restarted daemon claims a record left by a dead process", () => {
    const vfs = new ChatVirtualFS();
    const ports = createHealthPorts(vfs);
    const deadPid = vfs.spawnProcess({ cmd: "chatroom-daemon" });
    vfs.killProcess(deadPid);
    const livePid = vfs.spawnProcess({ cmd: "chatroom-daemon" });
    seedRecord(vfs, ports, {
      pid: deadPid,
      state: "STOPPED",
      last_wake_at: "2026-09-07T17:01:04.022Z",
      last_delivered_seq: 145,
      room_head_seq: 145,
      watch_active: true,
    });

    const claimed = claimHealthRecord(
      HEALTH_PATH,
      {
        room: ROOM,
        reader: READER,
        pid: livePid,
        startTime: "2026-09-07T17:05:00.000Z",
        isProcessAlive: (pid: number) => vfs.isProcessAlive(pid),
      },
      ports,
    );

    expect(claimed.pid).toBe(livePid);
    expect(claimed.state).toBe("LIVE");
    expect(claimed.last_delivered_seq).toBe(145);

    const persisted = readHealthRecord(HEALTH_PATH, ports);
    expect(persisted?.pid).toBe(livePid);
    expect(persisted?.state).toBe("LIVE");
  });

  it("reports a running daemon as running rather than stopped once the record names it", () => {
    const vfs = new ChatVirtualFS();
    const ports = createHealthPorts(vfs);
    const deadPid = vfs.spawnProcess({ cmd: "chatroom-daemon" });
    vfs.killProcess(deadPid);
    const livePid = vfs.spawnProcess({ cmd: "chatroom-daemon" });
    const stale = seedRecord(vfs, ports, {
      pid: deadPid,
      state: "STOPPED",
      last_wake_at: "2026-09-07T08:54:30.000Z",
      last_delivered_seq: 145,
      room_head_seq: 145,
    });
    const nowMs = Date.parse("2026-09-07T17:05:01.000Z");
    const aliveCheck = (pid: number): boolean => vfs.isProcessAlive(pid);

    expect(computeDaemonState(stale, nowMs, { isProcessAlive: aliveCheck })).toBe("STOPPED");

    const claimed = claimHealthRecord(
      HEALTH_PATH,
      {
        room: ROOM,
        reader: READER,
        pid: livePid,
        startTime: "2026-09-07T17:05:00.000Z",
        isProcessAlive: aliveCheck,
      },
      ports,
    );

    expect(computeDaemonState(claimed, nowMs, { isProcessAlive: aliveCheck })).toBe("IDLE");
  });

  it("keeps reporting STOPPED for a record whose owning process is gone and unclaimed", () => {
    const vfs = new ChatVirtualFS();
    const ports = createHealthPorts(vfs);
    const ownerPid = vfs.spawnProcess({ cmd: "chatroom-daemon" });
    const record = seedRecord(vfs, ports, {
      pid: ownerPid,
      state: "LIVE",
      last_wake_at: "2026-09-07T17:05:00.500Z",
    });
    const nowMs = Date.parse("2026-09-07T17:05:01.000Z");
    const aliveCheck = (pid: number): boolean => vfs.isProcessAlive(pid);

    expect(computeDaemonState(record, nowMs, { isProcessAlive: aliveCheck })).toBe("IDLE");

    vfs.killProcess(ownerPid);

    expect(computeDaemonState(record, nowMs, { isProcessAlive: aliveCheck })).toBe("STOPPED");
  });

  it("distinguishes running, backpressured and stopped for the same reader", () => {
    const vfs = new ChatVirtualFS();
    const ports = createHealthPorts(vfs);
    const ownerPid = vfs.spawnProcess({ cmd: "chatroom-daemon" });
    const running = seedRecord(vfs, ports, {
      pid: ownerPid,
      state: "LIVE",
      last_wake_at: "2026-09-07T17:05:00.500Z",
    });
    const nowMs = Date.parse("2026-09-07T17:05:01.000Z");
    const aliveCheck = (pid: number): boolean => vfs.isProcessAlive(pid);

    const backpressured: DaemonHealthRecord = {
      ...running,
      state: "BACKPRESSURED",
      spool_bytes: 33554432,
    };
    const orphaned: DaemonHealthRecord = { ...running, pid: 999999999 };

    expect(computeDaemonState(running, nowMs, { isProcessAlive: aliveCheck })).toBe("IDLE");
    expect(computeDaemonState(backpressured, nowMs, { isProcessAlive: aliveCheck })).toBe(
      "BACKPRESSURED",
    );
    expect(computeDaemonState(orphaned, nowMs, { isProcessAlive: aliveCheck })).toBe("STOPPED");
  });

  it("refuses to steal the record from a daemon process that is still alive", () => {
    const vfs = new ChatVirtualFS();
    const ports = createHealthPorts(vfs);
    const ownerPid = vfs.spawnProcess({ cmd: "chatroom-daemon" });
    const tickPid = vfs.spawnProcess({ cmd: "chatroom-tick" });
    seedRecord(vfs, ports, {
      pid: ownerPid,
      state: "LIVE",
      last_wake_at: "2026-09-07T17:05:00.500Z",
    });

    const observed = claimHealthRecord(
      HEALTH_PATH,
      {
        room: ROOM,
        reader: READER,
        pid: tickPid,
        startTime: "2026-09-07T17:05:01.000Z",
        isProcessAlive: (pid: number) => vfs.isProcessAlive(pid),
      },
      ports,
    );

    expect(observed.pid).toBe(ownerPid);
    expect(readHealthRecord(HEALTH_PATH, ports)?.pid).toBe(ownerPid);
  });

  it("stamps the claim time as the last wake so a stale wake cannot read as stopped", () => {
    const vfs = new ChatVirtualFS();
    const ports = createHealthPorts(vfs);
    const deadPid = vfs.spawnProcess({ cmd: "chatroom-daemon" });
    vfs.killProcess(deadPid);
    const livePid = vfs.spawnProcess({ cmd: "chatroom-daemon" });
    seedRecord(vfs, ports, {
      pid: deadPid,
      state: "STOPPED",
      last_wake_at: "2026-09-07T08:54:30.000Z",
    });
    const aliveCheck = (pid: number): boolean => vfs.isProcessAlive(pid);

    const claimed = claimHealthRecord(
      HEALTH_PATH,
      {
        room: ROOM,
        reader: READER,
        pid: livePid,
        startTime: "2026-09-07T17:05:00.000Z",
        isProcessAlive: aliveCheck,
      },
      ports,
    );

    expect(claimed.last_wake_at).toBe("2026-09-07T17:05:00.000Z");
    expect(claimed.last_wake_source).toBe("start");
    expect(
      computeDaemonState(claimed, Date.parse("2026-09-07T17:05:01.000Z"), {
        isProcessAlive: aliveCheck,
      }),
    ).toBe("IDLE");
  });

  it("creates a record naming the current process when none exists yet", () => {
    const vfs = new ChatVirtualFS();
    const ports = createHealthPorts(vfs);
    const livePid = vfs.spawnProcess({ cmd: "chatroom-daemon" });

    const created = claimHealthRecord(
      HEALTH_PATH,
      {
        room: ROOM,
        reader: READER,
        pid: livePid,
        startTime: "2026-09-07T17:05:00.000Z",
        isProcessAlive: (pid: number) => vfs.isProcessAlive(pid),
      },
      ports,
    );

    expect(created.pid).toBe(livePid);
    expect(created.state).toBe("LIVE");
    expect(readHealthRecord(HEALTH_PATH, ports)?.pid).toBe(livePid);
  });
});
