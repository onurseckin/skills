import { describe, expect, it } from "bun:test";
import { dirname } from "node:path";
import { daemonRespawnPath } from "../../../src/core/index.ts";
import {
  claimHealthRecord,
  countRecentRespawns,
  createInitialHealthRecord,
  readHealthRecord,
  writeDerivedHealthRecord,
  writeHealthRecord,
  type DaemonHealthRecord,
  type HealthPorts,
} from "../../../src/daemon/index.ts";
import { ChatVirtualFS } from "../../../src/testing/virtual-fs/index.ts";

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

describe("consumer_lag_ms and respawns_this_hour metrics", () => {
  it("consumer_lag_ms is null when never acked", () => {
    const vfs = new ChatVirtualFS();
    const ports = createHealthPorts(vfs);
    const pid = vfs.spawnProcess({ cmd: "chatroom-daemon" });
    const record = seedRecord(vfs, ports, {
      pid,
      consumer_last_ack_at: null,
      consumer_lag_ms: null,
    });
    const nowMs = Date.parse("2026-09-07T17:05:00.000Z");
    const derived = writeDerivedHealthRecord(HEALTH_PATH, record, nowMs, {}, ports);
    expect(derived.consumer_lag_ms).toBeNull();
    expect(readHealthRecord(HEALTH_PATH, ports)?.consumer_lag_ms).toBeNull();
  });

  it("consumer_lag_ms is positive when acked in past", () => {
    const vfs = new ChatVirtualFS();
    const ports = createHealthPorts(vfs);
    const pid = vfs.spawnProcess({ cmd: "chatroom-daemon" });
    const ackAt = "2026-09-07T17:00:00.000Z";
    const ackMs = Date.parse(ackAt);
    const record = seedRecord(vfs, ports, { pid, consumer_last_ack_at: ackAt, consumer_lag_ms: 0 });
    const derived = writeDerivedHealthRecord(HEALTH_PATH, record, ackMs + 5000, {}, ports);
    expect(derived.consumer_lag_ms).toBe(5000);
    expect(readHealthRecord(HEALTH_PATH, ports)?.consumer_lag_ms).toBe(5000);
  });

  it("consumer_lag_ms drops when acked again", () => {
    const vfs = new ChatVirtualFS();
    const ports = createHealthPorts(vfs);
    const pid = vfs.spawnProcess({ cmd: "chatroom-daemon" });
    const initialAck = "2026-09-07T17:00:00.000Z";
    const record = seedRecord(vfs, ports, {
      pid,
      consumer_last_ack_at: initialAck,
      consumer_lag_ms: 5000,
    });
    const newAck = "2026-09-07T17:00:10.000Z";
    const newAckMs = Date.parse(newAck);
    const updated = writeDerivedHealthRecord(
      HEALTH_PATH,
      record,
      newAckMs + 50,
      { cursor: { last_ack_at: newAck, last_ack_kind: "explicit" } },
      ports,
    );
    expect(updated.consumer_lag_ms).toBe(50);
    expect(readHealthRecord(HEALTH_PATH, ports)?.consumer_lag_ms).toBe(50);
  });

  it("respawns_this_hour returns count of timestamps in daemonRespawnPath within trailing 60 minutes", () => {
    const vfs = new ChatVirtualFS();
    const ports = createHealthPorts(vfs);
    const pid = vfs.spawnProcess({ cmd: "chatroom-daemon" });
    const nowMs = Date.parse("2026-09-07T17:00:00.000Z");
    const respawnFile = daemonRespawnPath(ROOM, READER);
    vfs.mkdirSync(dirname(respawnFile), { recursive: true });
    vfs.writeFileSync(
      respawnFile,
      JSON.stringify({
        timestamps: [
          new Date(nowMs - 7200000).toISOString(),
          new Date(nowMs - 3500000).toISOString(),
          new Date(nowMs - 1800000).toISOString(),
          new Date(nowMs - 60000).toISOString(),
        ],
      }),
    );
    expect(countRecentRespawns(ROOM, READER, nowMs, ports)).toBe(3);
    const record = seedRecord(vfs, ports, { pid });
    const derived = writeDerivedHealthRecord(HEALTH_PATH, record, nowMs, {}, ports);
    expect(derived.respawns_this_hour).toBe(3);
    expect(readHealthRecord(HEALTH_PATH, ports)?.respawns_this_hour).toBe(3);
  });

  it("advancing clock past 60 minutes causes respawns_this_hour to return 0 without touching ledger file", () => {
    const vfs = new ChatVirtualFS();
    const ports = createHealthPorts(vfs);
    const pid = vfs.spawnProcess({ cmd: "chatroom-daemon" });
    const baseMs = Date.parse("2026-09-07T17:00:00.000Z");
    const respawnFile = daemonRespawnPath(ROOM, READER);
    const rawLedger = JSON.stringify({ timestamps: [new Date(baseMs).toISOString()] });
    vfs.mkdirSync(dirname(respawnFile), { recursive: true });
    vfs.writeFileSync(respawnFile, rawLedger);

    expect(countRecentRespawns(ROOM, READER, baseMs + 60000, ports)).toBe(1);

    const pastOneHour = baseMs + 3600001;
    expect(countRecentRespawns(ROOM, READER, pastOneHour, ports)).toBe(0);
    expect(vfs.readFileSync(respawnFile, "utf8")).toBe(rawLedger);

    const record = seedRecord(vfs, ports, { pid });
    const derived = writeDerivedHealthRecord(HEALTH_PATH, record, pastOneHour, {}, ports);
    expect(derived.respawns_this_hour).toBe(0);
    expect(readHealthRecord(HEALTH_PATH, ports)?.respawns_this_hour).toBe(0);
  });

  it("populates respawns_this_hour via countRecentRespawns when claiming or initializing", () => {
    const vfs = new ChatVirtualFS();
    const ports = createHealthPorts(vfs);
    const livePid = vfs.spawnProcess({ cmd: "chatroom-daemon" });
    const nowMs = Date.parse("2026-09-07T17:00:00.000Z");
    const respawnFile = daemonRespawnPath(ROOM, READER);
    vfs.mkdirSync(dirname(respawnFile), { recursive: true });
    vfs.writeFileSync(
      respawnFile,
      JSON.stringify({ timestamps: [new Date(nowMs - 60000).toISOString()] }),
    );

    const created = claimHealthRecord(
      HEALTH_PATH,
      {
        room: ROOM,
        reader: READER,
        pid: livePid,
        startTime: "2026-09-07T17:00:00.000Z",
        isProcessAlive: (p: number) => vfs.isProcessAlive(p),
      },
      ports,
    );
    expect(created.respawns_this_hour).toBe(1);
    expect(readHealthRecord(HEALTH_PATH, ports)?.respawns_this_hour).toBe(1);
  });
});
