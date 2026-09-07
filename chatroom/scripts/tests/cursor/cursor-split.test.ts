import { describe, expect, it } from "bun:test";
import { dirname } from "node:path";
import {
  daemonHealthPath,
  daemonOutSpoolPath,
  readerCursorPath,
  readerSpoolCursorPath,
  resolveActiveConsumerCursorPath,
} from "../../src/core/index.ts";
import { createInitialCursor, type ReaderCursor } from "../../src/cursor/index.ts";
import {
  createInitialHealthRecord,
  readHealthRecord,
  syncDaemonHealth,
  writeHealthRecord,
  type HealthPorts,
} from "../../src/daemon/index.ts";
import { inspectRoom } from "../../src/doctor/index.ts";
import { ChatVirtualFS } from "../../src/testing/virtual-fs/index.ts";

const ROOM = "test-split-room";
const READER = "test-split-reader";
const NOW_ISO = "2026-09-07T14:00:00.000Z";
const NOW_MS = Date.parse(NOW_ISO);

function makeHealthPorts(vfs: ChatVirtualFS): HealthPorts {
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

describe("Consumer Cursor Split Resolver (T-4e55)", () => {
  it("resolves to readerCursorPath when spool file does not exist", () => {
    const vfs = new ChatVirtualFS(NOW_MS);
    const resolved = resolveActiveConsumerCursorPath(ROOM, READER, (p) => vfs.existsSync(p));
    const expected = readerCursorPath(ROOM, READER);
    expect(resolved).toBe(expected);
  });

  it("resolves to readerSpoolCursorPath when spool file exists", () => {
    const vfs = new ChatVirtualFS(NOW_MS);
    const spoolPath = daemonOutSpoolPath(ROOM, READER);
    vfs.mkdirSync(dirname(spoolPath), { recursive: true });
    vfs.writeFileSync(spoolPath, '{"seq":1}\n');

    const resolved = resolveActiveConsumerCursorPath(ROOM, READER, (p) => vfs.existsSync(p));
    const expected = readerSpoolCursorPath(ROOM, READER);
    expect(resolved).toBe(expected);
  });

  it("syncDaemonHealth derives consumer_last_ack_at from active spool cursor when spool exists", () => {
    const vfs = new ChatVirtualFS(NOW_MS);
    const ports = makeHealthPorts(vfs);
    const pid = vfs.spawnProcess({ cmd: "chatroom-daemon" });

    const spoolFile = daemonOutSpoolPath(ROOM, READER);
    vfs.mkdirSync(dirname(spoolFile), { recursive: true });
    vfs.writeFileSync(spoolFile, '{"seq":1}\n');

    const roomCursorFile = readerCursorPath(ROOM, READER);
    const daemonRoomCursor: ReaderCursor = {
      ...createInitialCursor(ROOM, READER),
      contiguous_seq: 10,
      last_ack_at: "2026-09-07T14:01:00.000Z",
      last_ack_kind: "spooled",
    };
    vfs.mkdirSync(dirname(roomCursorFile), { recursive: true });
    vfs.writeFileSync(roomCursorFile, JSON.stringify(daemonRoomCursor, null, 2));

    const spoolCursorFile = readerSpoolCursorPath(ROOM, READER);
    const consumerSpoolCursor: ReaderCursor = {
      ...createInitialCursor(ROOM, READER),
      contiguous_seq: 5,
      last_ack_at: "2026-09-07T14:02:30.000Z",
      last_ack_kind: "explicit",
    };
    vfs.mkdirSync(dirname(spoolCursorFile), { recursive: true });
    vfs.writeFileSync(spoolCursorFile, JSON.stringify(consumerSpoolCursor, null, 2));

    const healthFile = daemonHealthPath(ROOM, READER);
    const initialHealth = createInitialHealthRecord(ROOM, READER, pid, NOW_ISO, "boot-1", 750);
    writeHealthRecord(healthFile, initialHealth, ports);

    const synced = syncDaemonHealth({
      healthPath: healthFile,
      nowIso: "2026-09-07T14:03:00.000Z",
      metrics: { watch_active: true, watch_failures: 0, poll_interval_ms: 750 },
      claim: { room: ROOM, reader: READER, pid, startTime: NOW_ISO },
      ports,
    });

    expect(synced).not.toBeNull();
    expect(synced?.consumer_last_ack_at).toBe("2026-09-07T14:02:30.000Z");

    const onDisk = readHealthRecord(healthFile, ports);
    expect(onDisk?.consumer_last_ack_at).toBe("2026-09-07T14:02:30.000Z");
  });

  it("syncDaemonHealth derives consumer_last_ack_at from room cursor when spool does not exist", () => {
    const vfs = new ChatVirtualFS(NOW_MS);
    const ports = makeHealthPorts(vfs);
    const pid = vfs.spawnProcess({ cmd: "chatroom-daemon" });

    const roomCursorFile = readerCursorPath(ROOM, READER);
    const consumerRoomCursor: ReaderCursor = {
      ...createInitialCursor(ROOM, READER),
      contiguous_seq: 3,
      last_ack_at: "2026-09-07T14:01:15.000Z",
      last_ack_kind: "explicit",
    };
    vfs.mkdirSync(dirname(roomCursorFile), { recursive: true });
    vfs.writeFileSync(roomCursorFile, JSON.stringify(consumerRoomCursor, null, 2));

    const healthFile = daemonHealthPath(ROOM, READER);
    const initialHealth = createInitialHealthRecord(ROOM, READER, pid, NOW_ISO, "boot-1", 750);
    writeHealthRecord(healthFile, initialHealth, ports);

    const synced = syncDaemonHealth({
      healthPath: healthFile,
      nowIso: "2026-09-07T14:02:00.000Z",
      metrics: { watch_active: true, watch_failures: 0, poll_interval_ms: 750 },
      claim: { room: ROOM, reader: READER, pid, startTime: NOW_ISO },
      ports,
    });

    expect(synced).not.toBeNull();
    expect(synced?.consumer_last_ack_at).toBe("2026-09-07T14:01:15.000Z");
  });

  it("resolves active consumer cursor accurately for consumer lag computation when spool exists", () => {
    const vfs = new ChatVirtualFS(NOW_MS);
    const spoolFile = daemonOutSpoolPath(ROOM, READER);
    vfs.mkdirSync(dirname(spoolFile), { recursive: true });
    vfs.writeFileSync(spoolFile, '{"seq":10}\n');

    const roomCursorFile = readerCursorPath(ROOM, READER);
    const daemonRoomCursor: ReaderCursor = {
      ...createInitialCursor(ROOM, READER),
      contiguous_seq: 10,
      last_ack_at: "2026-09-07T14:01:00.000Z",
      last_ack_kind: "spooled",
    };
    vfs.mkdirSync(dirname(roomCursorFile), { recursive: true });
    vfs.writeFileSync(roomCursorFile, JSON.stringify(daemonRoomCursor, null, 2));

    const spoolCursorFile = readerSpoolCursorPath(ROOM, READER);
    const consumerSpoolCursor: ReaderCursor = {
      ...createInitialCursor(ROOM, READER),
      contiguous_seq: 4,
      last_ack_at: "2026-09-07T14:02:00.000Z",
      last_ack_kind: "explicit",
    };
    vfs.mkdirSync(dirname(spoolCursorFile), { recursive: true });
    vfs.writeFileSync(spoolCursorFile, JSON.stringify(consumerSpoolCursor, null, 2));

    const activeCursorPath = resolveActiveConsumerCursorPath(ROOM, READER, (p) =>
      vfs.existsSync(p),
    );
    expect(activeCursorPath).toBe(spoolCursorFile);

    const activeRaw = vfs.readFileSync(activeCursorPath, "utf8");
    const activeCursor = JSON.parse(activeRaw as string) as ReaderCursor;
    expect(activeCursor.contiguous_seq).toBe(4);
    const headSeq = 10;
    const consumerLag = Math.max(0, headSeq - activeCursor.contiguous_seq);
    expect(consumerLag).toBe(6);
  });
});
