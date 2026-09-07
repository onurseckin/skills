import { describe, expect, it } from "bun:test";
import { dirname } from "node:path";
import { ChatError } from "../../src/core/index.ts";
import {
  ackLease,
  assertCursorInvariants,
  computeCursorChecksum,
  createInitialCursor,
  type ReaderCursor,
} from "../../src/cursor/index.ts";
import {
  createInitialHealthRecord,
  deriveConsumerLastAckAt,
  syncDaemonHealth,
  writeDerivedHealthRecord,
  writeHealthRecord,
  type HealthPorts,
} from "../../src/daemon/index.ts";
import { ChatVirtualFS } from "../../src/testing/virtual-fs/index.ts";

function createHealthPorts(vfs: ChatVirtualFS): HealthPorts {
  return {
    existsSync: (target: string) => vfs.existsSync(target),
    readFileSync: (target: string, encoding: string) =>
      vfs.readFileSync(target, encoding) as string,
    writeFileSync: (target: string, content: string) => {
      const dir = dirname(target);
      if (!vfs.existsSync(dir)) vfs.mkdirSync(dir, { recursive: true });
      vfs.writeFileSync(target, content);
    },
  };
}

function loadVirtualCursor(vfs: ChatVirtualFS, path: string): ReaderCursor {
  const content = vfs.readFileSync(path, "utf8");
  const parsed = JSON.parse(content) as ReaderCursor;
  assertCursorInvariants(parsed);
  return parsed;
}

function saveVirtualCursor(vfs: ChatVirtualFS, path: string, cursor: ReaderCursor): void {
  assertCursorInvariants(cursor);
  const dir = dirname(path);
  if (!vfs.existsSync(dir)) vfs.mkdirSync(dir, { recursive: true });
  vfs.writeFileSync(path, JSON.stringify(cursor, null, 2));
}

function holdLease(
  cursor: ReaderCursor,
  lease: string,
  from: number,
  to: number,
  issuedAt: string,
): ReaderCursor {
  return {
    ...cursor,
    held: [
      { lease, from, to, issued_at: issuedAt, expires_at: "2026-09-07T14:00:00.000Z", attempt: 1 },
    ],
  };
}

describe("Task T-af7a: cursor ack provenance and health derivation contract", () => {
  describe("Property 1: Spool Ack Invariant", () => {
    it("leaves consumer_last_ack_at null after repeated daemon spool acks with kind spooled", () => {
      const vfs = new ChatVirtualFS();
      const ports = createHealthPorts(vfs);
      const room = "prov-room-1";
      const reader = "prov-reader-1";
      const cursorPath = `/rooms/${room}/readers/${reader}.cursor.json`;
      const healthPath = `/rooms/${room}/daemon/${reader}.health.json`;

      let cursor = createInitialCursor(room, reader, "2026-09-07T10:00:00.000Z");
      saveVirtualCursor(vfs, cursorPath, cursor);

      const health = createInitialHealthRecord(
        room,
        reader,
        1001,
        "2026-09-07T10:00:00.000Z",
        "boot-prov-1",
        750,
      );
      writeHealthRecord(healthPath, health, ports);

      cursor = holdLease(cursor, "lease-spool-1", 1, 5, "2026-09-07T10:01:00.000Z");
      cursor = ackLease(cursor, "lease-spool-1", 5, {
        kind: "spooled",
        at: "2026-09-07T10:01:30.000Z",
        spool_path: "/spool/out.jsonl",
        spool_offset: 512,
        fsynced: true,
      });
      saveVirtualCursor(vfs, cursorPath, cursor);
      expect(cursor.last_ack_kind).toBe("spooled");
      expect(deriveConsumerLastAckAt(cursor)).toBeNull();

      let derived = writeDerivedHealthRecord(
        healthPath,
        health,
        Date.parse("2026-09-07T10:01:30.000Z"),
        { cursor },
        ports,
      );
      expect(derived.consumer_last_ack_at).toBeNull();

      cursor = holdLease(cursor, "lease-spool-2", 6, 10, "2026-09-07T10:02:00.000Z");
      cursor = ackLease(cursor, "lease-spool-2", 10, {
        kind: "spooled",
        at: "2026-09-07T10:02:30.000Z",
        spool_path: "/spool/out.jsonl",
        spool_offset: 1024,
        fsynced: true,
      });
      saveVirtualCursor(vfs, cursorPath, cursor);
      expect(cursor.last_ack_kind).toBe("spooled");
      expect(deriveConsumerLastAckAt(cursor)).toBeNull();

      derived = writeDerivedHealthRecord(
        healthPath,
        health,
        Date.parse("2026-09-07T10:02:30.000Z"),
        { cursor },
        ports,
      );
      expect(derived.consumer_last_ack_at).toBeNull();

      cursor = holdLease(cursor, "lease-spool-3", 11, 15, "2026-09-07T10:03:00.000Z");
      cursor = ackLease(cursor, "lease-spool-3", 15, {
        kind: "spooled",
        at: "2026-09-07T10:03:30.000Z",
        spool_path: "/spool/out.jsonl",
        spool_offset: 2048,
        fsynced: true,
      });
      saveVirtualCursor(vfs, cursorPath, cursor);

      expect(cursor.contiguous_seq).toBe(15);
      expect(cursor.last_ack_kind).toBe("spooled");
      expect(cursor.last_ack_at).toBe("2026-09-07T10:03:30.000Z");
      expect(deriveConsumerLastAckAt(cursor)).toBeNull();

      derived = writeDerivedHealthRecord(
        healthPath,
        health,
        Date.parse("2026-09-07T10:03:30.000Z"),
        { cursor },
        ports,
      );
      expect(derived.consumer_last_ack_at).toBeNull();

      const synced = syncDaemonHealth({
        healthPath,
        nowIso: "2026-09-07T10:03:30.000Z",
        metrics: { watch_active: true, watch_failures: 0, poll_interval_ms: 750 },
        claim: { room, reader, pid: 1001, startTime: "2026-09-07T10:00:00.000Z" },
        compute: { cursor },
        ports,
      });
      expect(synced?.consumer_last_ack_at).toBeNull();
    });

    it("vacuity proof: dispatching a single explicit ack immediately sets last_ack_kind explicit and derives consumer_last_ack_at", () => {
      const vfs = new ChatVirtualFS();
      const ports = createHealthPorts(vfs);
      const room = "prov-room-1";
      const reader = "prov-reader-1";
      const cursorPath = `/rooms/${room}/readers/${reader}.cursor.json`;
      const healthPath = `/rooms/${room}/daemon/${reader}.health.json`;

      let cursor = createInitialCursor(room, reader, "2026-09-07T10:00:00.000Z");
      cursor = holdLease(cursor, "lease-spool-prev", 1, 5, "2026-09-07T10:01:00.000Z");
      cursor = ackLease(cursor, "lease-spool-prev", 5, {
        kind: "spooled",
        at: "2026-09-07T10:01:30.000Z",
        spool_path: "/spool/out.jsonl",
        spool_offset: 512,
        fsynced: true,
      });
      expect(cursor.last_ack_kind).toBe("spooled");

      const health = createInitialHealthRecord(
        room,
        reader,
        1001,
        "2026-09-07T10:00:00.000Z",
        "boot-prov-1",
        750,
      );
      writeHealthRecord(healthPath, health, ports);

      const explicitTimestamp = "2026-09-07T10:10:00.000Z";
      cursor = holdLease(cursor, "lease-explicit-1", 6, 10, "2026-09-07T10:09:00.000Z");
      cursor = ackLease(cursor, "lease-explicit-1", 10, {
        kind: "explicit",
        at: explicitTimestamp,
      });
      saveVirtualCursor(vfs, cursorPath, cursor);

      expect(cursor.last_ack_kind).toBe("explicit");
      expect(cursor.last_ack_at).toBe(explicitTimestamp);
      expect(cursor.contiguous_seq).toBe(10);
      expect(deriveConsumerLastAckAt(cursor)).toBe(explicitTimestamp);

      const derived = writeDerivedHealthRecord(
        healthPath,
        health,
        Date.parse(explicitTimestamp),
        { cursor },
        ports,
      );
      expect(derived.consumer_last_ack_at).toBe(explicitTimestamp);

      const synced = syncDaemonHealth({
        healthPath,
        nowIso: explicitTimestamp,
        metrics: { watch_active: true, watch_failures: 0, poll_interval_ms: 750 },
        claim: { room, reader, pid: 1001, startTime: "2026-09-07T10:00:00.000Z" },
        compute: { cursor },
        ports,
      });
      expect(synced?.consumer_last_ack_at).toBe(explicitTimestamp);
    });
  });

  describe("Property 2: Backward Compatibility & Checksum Invariant", () => {
    it("verifies checksum correctly without throwing for legacy cursor loaded without last_ack_kind or with null", () => {
      const vfs = new ChatVirtualFS();
      const room = "compat-room";
      const reader = "compat-reader";

      const legacyUnsignedWithoutKind = {
        v: 1 as const,
        room,
        reader,
        contiguous_seq: 7,
        held: [],
        acked_above: [],
        last_ack_at: "2026-09-07T08:00:00.000Z",
        updated_at: "2026-09-07T08:00:00.000Z",
      };
      const legacyChecksum = computeCursorChecksum(legacyUnsignedWithoutKind);

      const legacyCursorWithoutKind: ReaderCursor = {
        ...legacyUnsignedWithoutKind,
        checksum: legacyChecksum,
      };

      const pathWithoutKind = `/rooms/${room}/readers/without-kind.cursor.json`;
      vfs.mkdirSync(dirname(pathWithoutKind), { recursive: true });
      vfs.writeFileSync(pathWithoutKind, JSON.stringify(legacyCursorWithoutKind, null, 2));

      const loadedWithoutKind = loadVirtualCursor(vfs, pathWithoutKind);
      expect(loadedWithoutKind.contiguous_seq).toBe(7);
      expect(loadedWithoutKind.last_ack_kind).toBeUndefined();
      expect(loadedWithoutKind.checksum).toBe(legacyChecksum);
      expect(() => assertCursorInvariants(loadedWithoutKind)).not.toThrow();

      const legacyCursorWithNull: ReaderCursor = {
        ...legacyUnsignedWithoutKind,
        last_ack_kind: null,
        checksum: legacyChecksum,
      };

      const pathWithNull = `/rooms/${room}/readers/with-null.cursor.json`;
      vfs.writeFileSync(pathWithNull, JSON.stringify(legacyCursorWithNull, null, 2));

      const loadedWithNull = loadVirtualCursor(vfs, pathWithNull);
      expect(loadedWithNull.contiguous_seq).toBe(7);
      expect(loadedWithNull.last_ack_kind).toBeNull();
      expect(loadedWithNull.checksum).toBe(legacyChecksum);
      expect(() => assertCursorInvariants(loadedWithNull)).not.toThrow();
    });

    it("vacuity proof: tampering with last_ack_kind without updating checksum fails checksum verification", () => {
      const vfs = new ChatVirtualFS();
      const room = "compat-room";
      const reader = "compat-reader";

      const unsignedSpooled = {
        v: 1 as const,
        room,
        reader,
        contiguous_seq: 14,
        held: [],
        acked_above: [],
        last_ack_at: "2026-09-07T11:00:00.000Z",
        last_ack_kind: "spooled" as const,
        updated_at: "2026-09-07T11:00:00.000Z",
      };
      const spooledChecksum = computeCursorChecksum(unsignedSpooled);
      const validSpooledCursor: ReaderCursor = {
        ...unsignedSpooled,
        checksum: spooledChecksum,
      };

      expect(() => assertCursorInvariants(validSpooledCursor)).not.toThrow();

      const tamperedExplicit: ReaderCursor = {
        ...validSpooledCursor,
        last_ack_kind: "explicit",
      };

      const assertCorrupt = (tampered: ReaderCursor) => {
        let caught = false;
        try {
          assertCursorInvariants(tampered);
        } catch (err) {
          caught = true;
          expect(err instanceof ChatError).toBe(true);
          const chatErr = err as ChatError;
          expect(chatErr.code).toBe("CURSOR_CORRUPT");
          expect(chatErr.message).toContain("Checksum mismatch");
        }
        expect(caught).toBe(true);
      };

      assertCorrupt(tamperedExplicit);

      const tamperedPath = `/rooms/${room}/readers/tampered.cursor.json`;
      vfs.mkdirSync(dirname(tamperedPath), { recursive: true });
      vfs.writeFileSync(tamperedPath, JSON.stringify(tamperedExplicit, null, 2));
      expect(() => loadVirtualCursor(vfs, tamperedPath)).toThrow();

      const tamperedNull: ReaderCursor = {
        ...validSpooledCursor,
        last_ack_kind: null,
      };
      assertCorrupt(tamperedNull);

      const tamperedUndefined: ReaderCursor = {
        ...validSpooledCursor,
        last_ack_kind: undefined,
      };
      assertCorrupt(tamperedUndefined);
    });
  });

  describe("Property 3: Provenance State Transitions", () => {
    it("tracks confirming entity through state transitions null -> spooled -> explicit and explicit -> spooled", () => {
      const room = "trans-room";
      const reader = "trans-reader";

      let cursor = createInitialCursor(room, reader, "2026-09-07T12:00:00.000Z");
      expect(cursor.last_ack_kind).toBeNull();
      expect(cursor.last_ack_at).toBeNull();
      expect(deriveConsumerLastAckAt(cursor)).toBeNull();

      cursor = holdLease(cursor, "lease-trans-1", 1, 5, "2026-09-07T12:01:00.000Z");
      cursor = ackLease(cursor, "lease-trans-1", 5, {
        kind: "spooled",
        at: "2026-09-07T12:01:30.000Z",
        spool_path: "/spool/trans.jsonl",
        spool_offset: 100,
        fsynced: true,
      });
      expect(cursor.last_ack_kind).toBe("spooled");
      expect(cursor.last_ack_at).toBe("2026-09-07T12:01:30.000Z");
      expect(cursor.contiguous_seq).toBe(5);
      expect(deriveConsumerLastAckAt(cursor)).toBeNull();

      cursor = holdLease(cursor, "lease-trans-2", 6, 10, "2026-09-07T12:02:00.000Z");
      cursor = ackLease(cursor, "lease-trans-2", 10, {
        kind: "explicit",
        at: "2026-09-07T12:02:30.000Z",
      });
      expect(cursor.last_ack_kind).toBe("explicit");
      expect(cursor.last_ack_at).toBe("2026-09-07T12:02:30.000Z");
      expect(cursor.contiguous_seq).toBe(10);
      expect(deriveConsumerLastAckAt(cursor)).toBe("2026-09-07T12:02:30.000Z");

      cursor = holdLease(cursor, "lease-trans-3", 11, 15, "2026-09-07T12:03:00.000Z");
      cursor = ackLease(cursor, "lease-trans-3", 15, {
        kind: "spooled",
        at: "2026-09-07T12:03:30.000Z",
        spool_path: "/spool/trans.jsonl",
        spool_offset: 200,
        fsynced: true,
      });
      expect(cursor.last_ack_kind).toBe("spooled");
      expect(cursor.last_ack_at).toBe("2026-09-07T12:03:30.000Z");
      expect(cursor.contiguous_seq).toBe(15);
      expect(deriveConsumerLastAckAt(cursor)).toBeNull();

      cursor = holdLease(cursor, "lease-trans-4", 16, 20, "2026-09-07T12:04:00.000Z");
      cursor = ackLease(cursor, "lease-trans-4", 20, {
        kind: "explicit",
        at: "2026-09-07T12:04:30.000Z",
      });
      expect(cursor.last_ack_kind).toBe("explicit");
      expect(cursor.last_ack_at).toBe("2026-09-07T12:04:30.000Z");
      expect(cursor.contiguous_seq).toBe(20);
      expect(deriveConsumerLastAckAt(cursor)).toBe("2026-09-07T12:04:30.000Z");
    });
  });
});
