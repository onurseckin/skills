import { describe, expect, it } from "bun:test";
import { dirname } from "node:path";
import { readerCursorPath } from "../../src/core/index.ts";
import {
  ackLease,
  computeCursorChecksum,
  createInitialCursor,
  type Confirmation,
  type ReaderCursor,
} from "../../src/cursor/index.ts";
import {
  claimHealthRecord,
  createInitialHealthRecord,
  deriveConsumerLastAckAt,
  readHealthRecord,
  syncDaemonHealth,
  writeDerivedHealthRecord,
  writeHealthRecord,
  type DaemonHealthRecord,
  type HealthPorts,
} from "../../src/daemon/index.ts";
import { ChatVirtualFS } from "../../src/testing/virtual-fs/index.ts";

const ROOM = "test-room-provenance";
const READER = "test-reader-provenance";
const HEALTH_PATH = `/rooms/${ROOM}/daemon/${READER}.health.json`;

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

function createCursorWithLease(
  room: string,
  reader: string,
  leaseId: string,
  from: number,
  to: number,
  nowIso: string,
): ReaderCursor {
  const unsigned: Omit<ReaderCursor, "checksum"> = {
    v: 1,
    room,
    reader,
    contiguous_seq: 0,
    held: [
      {
        lease: leaseId,
        from,
        to,
        issued_at: nowIso,
        expires_at: new Date(Date.parse(nowIso) + 60000).toISOString(),
        attempt: 1,
      },
    ],
    acked_above: [],
    last_ack_at: null,
    last_ack_kind: null,
    updated_at: nowIso,
  };
  return {
    ...unsigned,
    checksum: computeCursorChecksum(unsigned),
  };
}

describe("cursor ack provenance and last_ack_kind persistence", () => {
  it("initializes cursor with last_ack_kind as null", () => {
    const cursor = createInitialCursor(ROOM, READER);
    expect(cursor.last_ack_kind).toBeNull();
  });

  it("ackLease with 'spooled' sets last_ack_kind to 'spooled'", () => {
    const nowIso = "2026-09-07T12:00:00.000Z";
    const cursor = createCursorWithLease(ROOM, READER, "lease-spool-1", 1, 5, nowIso);
    const confirmation: Confirmation = {
      kind: "spooled",
      at: nowIso,
      spool_path: `/rooms/${ROOM}/spool/${READER}.spool.jsonl`,
      spool_offset: 1024,
      fsynced: true,
    };

    const updated = ackLease(cursor, "lease-spool-1", 5, confirmation, { now: nowIso });
    expect(updated.last_ack_kind).toBe("spooled");
    expect(updated.last_ack_at).toBe(nowIso);
    expect(updated.contiguous_seq).toBe(5);
    expect(updated.checksum).toBe(computeCursorChecksum(updated));
  });

  it("ackLease with 'explicit' sets last_ack_kind to 'explicit'", () => {
    const nowIso = "2026-09-07T12:05:00.000Z";
    const cursor = createCursorWithLease(ROOM, READER, "lease-explicit-1", 1, 3, nowIso);
    const confirmation: Confirmation = {
      kind: "explicit",
      at: nowIso,
    };

    const updated = ackLease(cursor, "lease-explicit-1", 3, confirmation, { now: nowIso });
    expect(updated.last_ack_kind).toBe("explicit");
    expect(updated.last_ack_at).toBe(nowIso);
    expect(updated.contiguous_seq).toBe(3);
    expect(updated.checksum).toBe(computeCursorChecksum(updated));
  });
});

describe("health derivation recognizes explicit acks and ignores spool acks", () => {
  it("deriveConsumerLastAckAt resolves timestamp only for explicit ack kind", () => {
    const explicitCursor = {
      last_ack_at: "2026-09-07T14:00:00.000Z",
      last_ack_kind: "explicit" as const,
    };
    expect(deriveConsumerLastAckAt(explicitCursor)).toBe("2026-09-07T14:00:00.000Z");
    expect(deriveConsumerLastAckAt(explicitCursor, "fallback")).toBe("2026-09-07T14:00:00.000Z");

    const spooledCursor = {
      last_ack_at: "2026-09-07T14:00:00.000Z",
      last_ack_kind: "spooled" as const,
    };
    expect(deriveConsumerLastAckAt(spooledCursor)).toBeNull();
    expect(deriveConsumerLastAckAt(spooledCursor, "fallback")).toBe("fallback");

    const nullCursor = {
      last_ack_at: "2026-09-07T14:00:00.000Z",
      last_ack_kind: null,
    };
    expect(deriveConsumerLastAckAt(nullCursor)).toBeNull();
    expect(deriveConsumerLastAckAt(nullCursor, "fallback")).toBe("fallback");

    expect(deriveConsumerLastAckAt(null)).toBeNull();
    expect(deriveConsumerLastAckAt(null, "fallback")).toBe("fallback");
    expect(deriveConsumerLastAckAt(undefined)).toBeNull();
  });

  it("writeDerivedHealthRecord preserves existing ack on spooled and updates on explicit", () => {
    const vfs = new ChatVirtualFS();
    const ports = createHealthPorts(vfs);
    const base = createInitialHealthRecord(
      ROOM,
      READER,
      100,
      "2026-09-07T10:00:00.000Z",
      "boot-1",
      750,
    );
    writeHealthRecord(HEALTH_PATH, base, ports);

    const spooledDerived = writeDerivedHealthRecord(
      HEALTH_PATH,
      base,
      Date.parse("2026-09-07T10:01:00.000Z"),
      {
        cursor: {
          last_ack_at: "2026-09-07T10:01:00.000Z",
          last_ack_kind: "spooled",
        },
      },
      ports,
    );
    expect(spooledDerived.consumer_last_ack_at).toBeNull();

    const explicitDerived = writeDerivedHealthRecord(
      HEALTH_PATH,
      base,
      Date.parse("2026-09-07T10:02:00.000Z"),
      {
        cursor: {
          last_ack_at: "2026-09-07T10:02:00.000Z",
          last_ack_kind: "explicit",
        },
      },
      ports,
    );
    expect(explicitDerived.consumer_last_ack_at).toBe("2026-09-07T10:02:00.000Z");
  });

  it("syncDaemonHealth derives consumer_last_ack_at from cursor file on virtual fs", () => {
    const vfs = new ChatVirtualFS();
    const ports = createHealthPorts(vfs);
    const cursorPath = readerCursorPath(ROOM, READER);
    vfs.mkdirSync(dirname(cursorPath), { recursive: true });

    const spooledCursor: ReaderCursor = {
      v: 1,
      room: ROOM,
      reader: READER,
      contiguous_seq: 10,
      held: [],
      acked_above: [],
      last_ack_at: "2026-09-07T11:00:00.000Z",
      last_ack_kind: "spooled",
      updated_at: "2026-09-07T11:00:00.000Z",
      checksum: "",
    };
    const spooledChecksum = computeCursorChecksum(spooledCursor);
    const finalSpooled: ReaderCursor = { ...spooledCursor, checksum: spooledChecksum };
    vfs.writeFileSync(cursorPath, JSON.stringify(finalSpooled, null, 2));

    const syncedAfterSpool = syncDaemonHealth({
      healthPath: HEALTH_PATH,
      nowIso: "2026-09-07T11:00:01.000Z",
      metrics: { watch_active: true, watch_failures: 0, poll_interval_ms: 750 },
      claim: { room: ROOM, reader: READER, pid: 200, startTime: "2026-09-07T11:00:00.000Z" },
      ports,
    });
    expect(syncedAfterSpool).not.toBeNull();
    expect(syncedAfterSpool?.consumer_last_ack_at).toBeNull();

    const explicitCursor: ReaderCursor = {
      v: 1,
      room: ROOM,
      reader: READER,
      contiguous_seq: 10,
      held: [],
      acked_above: [],
      last_ack_at: "2026-09-07T11:05:00.000Z",
      last_ack_kind: "explicit",
      updated_at: "2026-09-07T11:05:00.000Z",
      checksum: "",
    };
    const explicitChecksum = computeCursorChecksum(explicitCursor);
    const finalExplicit: ReaderCursor = { ...explicitCursor, checksum: explicitChecksum };
    vfs.writeFileSync(cursorPath, JSON.stringify(finalExplicit, null, 2));

    const syncedAfterExplicit = syncDaemonHealth({
      healthPath: HEALTH_PATH,
      nowIso: "2026-09-07T11:05:01.000Z",
      metrics: { watch_active: true, watch_failures: 0, poll_interval_ms: 750 },
      claim: { room: ROOM, reader: READER, pid: 200, startTime: "2026-09-07T11:00:00.000Z" },
      ports,
    });
    expect(syncedAfterExplicit).not.toBeNull();
    expect(syncedAfterExplicit?.consumer_last_ack_at).toBe("2026-09-07T11:05:00.000Z");

    const persisted = readHealthRecord(HEALTH_PATH, ports);
    expect(persisted?.consumer_last_ack_at).toBe("2026-09-07T11:05:00.000Z");
  });
});
