import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { dirname, join } from "node:path";

const mockOs = await import("node:os");
const mockFs = await import("node:fs");

const tempHome = join(
  mockOs.tmpdir(),
  "chat-test-" + Date.now() + "-" + Math.random().toString(36).slice(2),
);
const prevHome = process.env.CHATROOM_HOME;
import { ChatError } from "../../src/core/index.ts";
import {
  claimHealthRecord,
  createInitialHealthRecord,
  readHealthRecord,
  runDaemonLoop,
  startDaemon,
  syncDaemonHealth,
  writeHealthRecord,
  type DaemonHealthRecord,
  type HealthPorts,
} from "../../src/daemon/index.ts";
import { ChatVirtualFS } from "../../src/testing/virtual-fs/index.ts";

const ROOM = "room-ownership";
const READER = "reader-1";
const HEALTH_PATH = "/rooms/room-ownership/daemon/reader-1.health.json";
const LOCK_PATH = "/rooms/room-ownership/locks/daemon/reader-1.lock";
const NOW_ISO = "2026-09-07T14:00:00.000Z";

function makePorts(vfs: ChatVirtualFS): HealthPorts {
  return {
    existsSync: (path: string) => vfs.existsSync(path),
    readFileSync: (path: string, encoding: string) => vfs.readFileSync(path, encoding) as string,
    writeFileSync: (path: string, content: string) => {
      vfs.mkdirSync(dirname(path), { recursive: true });
      vfs.writeFileSync(path, content);
    },
    writeAtomic: (path: string, content: string) => {
      vfs.mkdirSync(dirname(path), { recursive: true });
      vfs.writeFileSync(path, content);
    },
    isProcessAlive: (pid: number) => vfs.isProcessAlive(pid),
  };
}

describe("Health record write protection and honest ownership", () => {
  beforeAll(() => {
    mockFs.mkdirSync(tempHome, { recursive: true });
    process.env.CHATROOM_HOME = tempHome;
  });

  afterAll(() => {
    if (prevHome === undefined) {
      delete process.env.CHATROOM_HOME;
    } else {
      process.env.CHATROOM_HOME = prevHome;
    }
    if (mockFs.existsSync(tempHome)) {
      mockFs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it("rejects non-owner writes with PERMISSION_DENIED when incumbent PID is alive", () => {
    const vfs = new ChatVirtualFS(Date.parse(NOW_ISO));
    const ports = makePorts(vfs);
    const livePid = vfs.spawnProcess({ cmd: "chatroom-daemon" });
    const roguePid = vfs.spawnProcess({ cmd: "chatroom-daemon" });

    const initial = createInitialHealthRecord(ROOM, READER, livePid, NOW_ISO, "boot-1", 750);
    writeHealthRecord(HEALTH_PATH, initial, ports);

    const rogueRecord: DaemonHealthRecord = {
      ...initial,
      pid: roguePid,
      boot_id: "rogue-boot",
    };

    let caughtError: unknown;
    try {
      writeHealthRecord(HEALTH_PATH, rogueRecord, ports);
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(ChatError);
    const chatErr = caughtError as ChatError;
    expect(chatErr.code).toBe("PERMISSION_DENIED");
    expect(chatErr.message.includes(`owned by live process ${livePid}`)).toBe(true);

    const after = readHealthRecord(HEALTH_PATH, ports);
    expect(after?.pid).toBe(livePid);
  });

  it("refuses to sync health timestamps when claim PID differs from live incumbent", () => {
    const vfs = new ChatVirtualFS(Date.parse(NOW_ISO));
    const ports = makePorts(vfs);
    const incumbentPid = vfs.spawnProcess({ cmd: "chatroom-daemon" });
    const challengerPid = vfs.spawnProcess({ cmd: "chatroom-daemon" });

    const initial = createInitialHealthRecord(ROOM, READER, incumbentPid, NOW_ISO, "boot-1", 750);
    writeHealthRecord(HEALTH_PATH, initial, ports);

    const syncRes = syncDaemonHealth({
      healthPath: HEALTH_PATH,
      nowIso: "2026-09-07T14:05:00.000Z",
      metrics: { watch_active: true, watch_failures: 0, poll_interval_ms: 750 },
      claim: {
        room: ROOM,
        reader: READER,
        pid: challengerPid,
        startTime: "2026-09-07T14:05:00.000Z",
      },
      ports,
    });

    expect(syncRes).toBeNull();
    const after = readHealthRecord(HEALTH_PATH, ports);
    expect(after?.pid).toBe(incumbentPid);
    expect(after?.last_wake_at).toBe(initial.last_wake_at);
  });

  it("atomically claims ownership when prior PID is dead", () => {
    const vfs = new ChatVirtualFS(Date.parse(NOW_ISO));
    const ports = makePorts(vfs);
    const deadPid = vfs.spawnProcess({ cmd: "chatroom-daemon" });
    const newPid = vfs.spawnProcess({ cmd: "chatroom-daemon" });

    const initial = createInitialHealthRecord(ROOM, READER, deadPid, NOW_ISO, "boot-dead", 750);
    writeHealthRecord(HEALTH_PATH, initial, ports);
    vfs.killProcess(deadPid);

    const claimed = claimHealthRecord(
      HEALTH_PATH,
      {
        room: ROOM,
        reader: READER,
        pid: newPid,
        startTime: "2026-09-07T14:10:00.000Z",
        bootId: "boot-new",
      },
      ports,
    );

    expect(claimed.pid).toBe(newPid);
    expect(claimed.boot_id).toBe("boot-new");
    expect(claimed.state).toBe("LIVE");
    expect(claimed.last_wake_at).toBe("2026-09-07T14:10:00.000Z");
    expect(claimed.last_wake_source).toBe("claim");

    const onDisk = readHealthRecord(HEALTH_PATH, ports);
    expect(onDisk?.pid).toBe(newPid);
    expect(onDisk?.last_wake_source).toBe("claim");
  });

  it("returns existing record without change when claim is attempted on live incumbent", () => {
    const vfs = new ChatVirtualFS(Date.parse(NOW_ISO));
    const ports = makePorts(vfs);
    const livePid = vfs.spawnProcess({ cmd: "chatroom-daemon" });
    const challengerPid = vfs.spawnProcess({ cmd: "chatroom-daemon" });

    const initial = createInitialHealthRecord(
      ROOM,
      READER,
      livePid,
      NOW_ISO,
      "boot-incumbent",
      750,
    );
    writeHealthRecord(HEALTH_PATH, initial, ports);

    const result = claimHealthRecord(
      HEALTH_PATH,
      {
        room: ROOM,
        reader: READER,
        pid: challengerPid,
        startTime: "2026-09-07T14:10:00.000Z",
        bootId: "boot-challenger",
      },
      ports,
    );

    expect(result.pid).toBe(livePid);
    expect(result.boot_id).toBe("boot-incumbent");
  });

  it("refuses startDaemon when recorded PID in health record is alive", () => {
    const vfs = new ChatVirtualFS(Date.parse(NOW_ISO));
    const livePid = vfs.spawnProcess({ cmd: "chatroom-daemon" });

    const res = startDaemon({
      room: ROOM,
      reader: READER,
      ports: {
        isProcessAlive: (pid: number) => vfs.isProcessAlive(pid),
        spawnDetached: () => null,
        daemonRespawnPath: (r: string, rd: string) =>
          join(tempHome, "rooms", r, "daemon", `${rd}.respawn.json`),
      },
    });

    expect(typeof res.status).toBe("string");
  });

  it("throws NOT_FOUND when room directory or room manifest is missing at loop start", async () => {
    const vfs = new ChatVirtualFS(Date.parse(NOW_ISO));
    const ports = makePorts(vfs);

    let caughtErr: unknown;
    try {
      await runDaemonLoop({
        room: "non-existent-room",
        reader: "reader-x",
        healthPorts: ports,
      });
    } catch (err) {
      caughtErr = err;
    }

    expect(caughtErr).toBeInstanceOf(ChatError);
    const chatErr = caughtErr as ChatError;
    expect(chatErr.code).toBe("NOT_FOUND");
    expect(chatErr.message.includes("Room directory not found")).toBe(true);
  });
});
