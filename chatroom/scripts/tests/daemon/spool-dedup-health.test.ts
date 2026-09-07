import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { dirname, join } from "node:path";

const mockOs = await import("node:os");
const mockFs = await import("node:fs");

const tempHome = join(
  mockOs.tmpdir(),
  "chat-test-" + Date.now() + "-" + Math.random().toString(36).slice(2),
);
const prevHome = process.env.CHATROOM_HOME;
process.env.CHATROOM_HOME = tempHome;
import { daemonHealthPath, daemonOutSpoolPath, type Envelope } from "../../src/core/index.ts";
import {
  appendSpool,
  createInitialHealthRecord,
  readHealthRecord,
  repairSpool,
  startDaemon,
  writeHealthRecord,
  type HealthPorts,
  type SpoolOptions,
} from "../../src/daemon/index.ts";

type SpoolPorts = NonNullable<SpoolOptions["ports"]>;
import { ChatVirtualFS } from "../../src/testing/virtual-fs/index.ts";

const ROOM = "room-dedup-health";
const READER = "reader-1";
const HEALTH_PATH = daemonHealthPath(ROOM, READER);
const SPOOL_PATH = daemonOutSpoolPath(ROOM, READER);
const NOW_ISO = "2026-09-07T14:00:00.000Z";
const NOW_MS = Date.parse(NOW_ISO);

function makeEnvelope(seq: number): Envelope {
  return {
    v: 1,
    id: `env-${seq}`,
    room: ROOM,
    seq,
    ts: NOW_ISO,
    sender: { id: "test-agent", role: "tester", host: "virtual" },
    kind: "message",
    reply_to: null,
    mentions: [],
    text: `Message ${seq}`,
    body: { schema: "text", data: { text: `Message ${seq}` } },
    key_fingerprint: "test-key-fp",
    sig: `sig-${seq}`,
  };
}

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

function makeSpoolPorts(vfs: ChatVirtualFS): SpoolPorts {
  return {
    existsSync: (path: string) => vfs.existsSync(path),
    readFileSync: (path: string, encoding?: string) =>
      vfs.readFileSync(path, encoding ?? "utf8") as string,
    writeFileSync: (path: string, content: string | Uint8Array) => {
      vfs.mkdirSync(dirname(path), { recursive: true });
      vfs.writeFileSync(path, content);
    },
    statSync: (path: string) => {
      const stats = vfs.statSync(path);
      return { size: stats ? stats.size : 0 };
    },
    withLock: <T>(_lockPath: string, fn: () => T): T => fn(),
  };
}

describe("Daemon Spool & Health Dedup", () => {
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

  describe("Spool Deduplication & Idempotency (T-4e55)", () => {
    it("appendSpool filters out all envelopes when all sequences are <= highestSeq", () => {
      const vfs = new ChatVirtualFS(NOW_MS);
      const ports = makeSpoolPorts(vfs);

      appendSpool(ROOM, READER, [makeEnvelope(1), makeEnvelope(2), makeEnvelope(3)], { ports });

      const dupRes = appendSpool(
        ROOM,
        READER,
        [makeEnvelope(1), makeEnvelope(2), makeEnvelope(3)],
        {
          ports,
        },
      );
      expect(dupRes.bytesWritten).toBe(0);

      const content = vfs.readFileSync(SPOOL_PATH, "utf8") as string;
      const lines = content.trim().split("\n");
      expect(lines.length).toBe(3);
    });

    it("appendSpool appends only unique higher sequence numbers when batch is partially duplicate", () => {
      const vfs = new ChatVirtualFS(NOW_MS);
      const ports = makeSpoolPorts(vfs);

      appendSpool(ROOM, READER, [makeEnvelope(1), makeEnvelope(2), makeEnvelope(3)], { ports });

      const partialRes = appendSpool(
        ROOM,
        READER,
        [makeEnvelope(2), makeEnvelope(3), makeEnvelope(4), makeEnvelope(5)],
        { ports },
      );
      expect(partialRes.bytesWritten).toBeGreaterThan(0);

      const content = vfs.readFileSync(SPOOL_PATH, "utf8") as string;
      const lines = content.trim().split("\n");
      expect(lines.length).toBe(5);

      const parsedSeqs = lines.map((l) => (JSON.parse(l) as { seq: number }).seq);
      expect(parsedSeqs).toEqual([1, 2, 3, 4, 5]);
    });

    it("repairSpool deduplicates duplicate sequence numbers keeping first occurrence in sequence order", () => {
      const vfs = new ChatVirtualFS(NOW_MS);
      const ports = makeSpoolPorts(vfs);

      const rawEnvelopes = [
        makeEnvelope(1),
        makeEnvelope(2),
        makeEnvelope(2),
        makeEnvelope(3),
        makeEnvelope(1),
      ];
      const rawContent = rawEnvelopes.map((e) => JSON.stringify(e)).join("\n") + "\n";
      vfs.mkdirSync(dirname(SPOOL_PATH), { recursive: true });
      vfs.writeFileSync(SPOOL_PATH, rawContent);

      const res = repairSpool(ROOM, READER, { ports });
      expect(res.repaired).toBe(true);
      expect(res.highestSeq).toBe(3);

      const repairedContent = vfs.readFileSync(SPOOL_PATH, "utf8") as string;
      const lines = repairedContent.trim().split("\n");
      expect(lines.length).toBe(3);

      const parsedSeqs = lines.map((l) => (JSON.parse(l) as { seq: number }).seq);
      expect(parsedSeqs).toEqual([1, 2, 3]);
    });
  });

  describe("Absence of heartbeat.json overwrite (T-3789)", () => {
    it("writeHealthRecord writes reader health record without clobbering room heartbeat.json", () => {
      const vfs = new ChatVirtualFS(NOW_MS);
      const ports = makeHealthPorts(vfs);
      const livePid = vfs.spawnProcess({ cmd: "chatroom-daemon" });

      const initial = createInitialHealthRecord(ROOM, READER, livePid, NOW_ISO, "boot-1", 750);
      writeHealthRecord(HEALTH_PATH, initial, ports);

      expect(vfs.existsSync(HEALTH_PATH)).toBe(true);
      const readBack = readHealthRecord(HEALTH_PATH, ports);
      expect(readBack?.pid).toBe(livePid);

      const heartbeatPath = `${dirname(HEALTH_PATH)}/heartbeat.json`;
      expect(vfs.existsSync(heartbeatPath)).toBe(false);
    });
  });

  describe("Cap and Timestamp errors_recent (T-9195)", () => {
    it("formats respawn_budget_exhausted with timestamp and caps errors_recent to 20 entries", () => {
      const vfs = new ChatVirtualFS(NOW_MS);
      const ports = makeHealthPorts(vfs);
      const deadPid = vfs.spawnProcess({ cmd: "chatroom-daemon" });
      vfs.killProcess(deadPid);

      const priorErrors: string[] = [];
      for (let i = 1; i <= 25; i++) {
        priorErrors.push(`prior_error_${i} at 2026-09-07T13:00:00.000Z`);
      }

      const initialHealth = {
        ...createInitialHealthRecord(ROOM, READER, deadPid, NOW_ISO, "boot-old", 750),
        errors_recent: priorErrors,
      };
      writeHealthRecord(HEALTH_PATH, initialHealth, ports);

      const respawnPath = `${dirname(HEALTH_PATH)}/${READER}.respawn.json`;
      const exhaustedTimestamps: string[] = [];
      for (let i = 0; i < 20; i++) {
        exhaustedTimestamps.push(new Date(NOW_MS - i * 1000).toISOString());
      }
      vfs.mkdirSync(dirname(respawnPath), { recursive: true });
      vfs.writeFileSync(respawnPath, JSON.stringify({ timestamps: exhaustedTimestamps }));

      const supervisorPorts = {
        ...makeHealthPorts(vfs),
        now: () => NOW_MS,
        isProcessAlive: (pid: number) => vfs.isProcessAlive(pid),
        spawnDetached: () => null,
        daemonRespawnPath: (r: string, rd: string) => `${dirname(HEALTH_PATH)}/${rd}.respawn.json`,
      };

      const res = startDaemon({
        room: ROOM,
        reader: READER,
        ports: supervisorPorts,
        policy: {
          v: 1,
          poll_interval_ms: 750,
          batch_size: 50,
          lease_ttl_ms: 30000,
          max_spool_bytes: 33554432,
          max_spool_lines: 20000,
          respawn_budget_per_hour: 5,
          harness_path: "mock-harness",
          runtime_command: "mock-runtime",
          notify_command: "",
        },
      });

      expect(res.status).toBe("exhausted");

      const afterHealth = readHealthRecord(HEALTH_PATH, ports);
      expect(afterHealth).not.toBeNull();
      expect(afterHealth?.state).toBe("STOPPED");
      expect(afterHealth?.errors_recent.length).toBe(20);

      const lastError = afterHealth?.errors_recent[afterHealth.errors_recent.length - 1];
      expect(lastError).toBeDefined();
      expect(lastError?.startsWith("respawn_budget_exhausted at ")).toBe(true);
    });
  });
});
