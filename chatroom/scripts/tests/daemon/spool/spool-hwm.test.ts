import { describe, expect, it } from "bun:test";
import { dirname } from "node:path";
import { daemonOutSpoolPath, type Envelope } from "../../../src/core/index.ts";
import {
  appendSpool,
  getSpoolHighestSeq,
  rotateSpoolIfNeeded,
  type SpoolPorts,
} from "../../../src/daemon/index.ts";
import { ChatVirtualFS } from "../../../src/testing/virtual-fs/index.ts";

interface ReadLogEntry {
  readonly path: string;
  readonly bytes: number;
}

const ROOM = "room-spool-hwm";
const READER = "reader-spool-hwm";
const SPOOL_PATH = daemonOutSpoolPath(ROOM, READER);
const HWM_PATH = `${SPOOL_PATH}.hwm`;
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
    text: `Message content for sequence number ${seq} which has some substantial text payload`,
    body: {
      schema: "text",
      data: {
        text: `Message payload ${seq} padding to increase byte length per line substantially`,
      },
    },
    key_fingerprint: "test-key-fingerprint-hex",
    sig: `signature-${seq}`,
  };
}

function makePorts(vfs: ChatVirtualFS, readLog?: ReadLogEntry[]): SpoolPorts {
  return {
    existsSync: (path: string) => vfs.existsSync(path),
    readFileSync: (path: string, encoding?: string) => {
      const result = vfs.readFileSync(path, encoding ?? "utf8");
      const str = typeof result === "string" ? result : Buffer.from(result).toString("utf8");
      if (readLog) {
        readLog.push({ path, bytes: Buffer.byteLength(str, "utf8") });
      }
      return str;
    },
    writeFileSync: (path: string, content: string | Uint8Array) => {
      vfs.mkdirSync(dirname(path), { recursive: true });
      vfs.writeFileSync(path, content);
    },
    writeAtomic: (path: string, content: string | Uint8Array) => {
      vfs.mkdirSync(dirname(path), { recursive: true });
      vfs.writeFileSync(path, content);
    },
    appendFileSync: (path: string, content: string | Uint8Array) => {
      vfs.mkdirSync(dirname(path), { recursive: true });
      vfs.appendFileSync(path, content);
    },
    statSync: (path: string) => {
      const stats = vfs.statSync(path);
      return { size: stats ? stats.size : 0 };
    },
    unlinkSync: (path: string) => {
      vfs.rmSync(path);
    },
    renameSync: (oldPath: string, newPath: string) => {
      vfs.renameSync(oldPath, newPath);
    },
    withLock: <T>(_lockPath: string, fn: () => T): T => fn(),
  };
}

describe("Spool High-Water Mark (T-7ca0)", () => {
  it("creates .hwm sidecar with format seq:byteSize on initial append", () => {
    const vfs = new ChatVirtualFS(NOW_MS);
    const ports = makePorts(vfs);

    const result = appendSpool(ROOM, READER, [makeEnvelope(1), makeEnvelope(2), makeEnvelope(5)], {
      ports,
    });

    expect(result.bytesWritten).toBeGreaterThan(0);
    expect(vfs.existsSync(SPOOL_PATH)).toBe(true);
    expect(vfs.existsSync(HWM_PATH)).toBe(true);

    const spoolSize = vfs.statSync(SPOOL_PATH)?.size ?? 0;
    const hwmContent = vfs.readFileSync(HWM_PATH, "utf8") as string;
    expect(hwmContent.trim()).toBe(`5:${spoolSize}`);
  });

  it("reads ONLY .hwm with bounded bytes and never reads large spool file on subsequent append", () => {
    const vfs = new ChatVirtualFS(NOW_MS);
    const initialPorts = makePorts(vfs);

    const largeBatch: Envelope[] = [];
    for (let seq = 1; seq <= 1000; seq++) {
      largeBatch.push(makeEnvelope(seq));
    }
    appendSpool(ROOM, READER, largeBatch, { ports: initialPorts });

    const spoolStats = vfs.statSync(SPOOL_PATH);
    expect(spoolStats).toBeDefined();
    const spoolSize = spoolStats ? spoolStats.size : 0;
    expect(spoolSize).toBeGreaterThan(200000);

    const initialHwm = vfs.readFileSync(HWM_PATH, "utf8") as string;
    expect(initialHwm.trim()).toBe(`1000:${spoolSize}`);

    const readLog: ReadLogEntry[] = [];
    const monitoredPorts = makePorts(vfs, readLog);

    const appendResult = appendSpool(ROOM, READER, [makeEnvelope(1001), makeEnvelope(1002)], {
      ports: monitoredPorts,
    });

    expect(appendResult.bytesWritten).toBeGreaterThan(0);

    const spoolFileReads = readLog.filter((entry) => entry.path === SPOOL_PATH);
    expect(spoolFileReads).toHaveLength(0);

    const hwmReads = readLog.filter((entry) => entry.path === HWM_PATH);
    expect(hwmReads).toHaveLength(1);
    expect(hwmReads[0]!.bytes).toBeLessThan(30);

    const totalBytesRead = readLog.reduce((acc, entry) => acc + entry.bytes, 0);
    expect(totalBytesRead).toBeLessThan(30);

    const updatedSize = vfs.statSync(SPOOL_PATH)?.size ?? 0;
    const updatedHwm = vfs.readFileSync(HWM_PATH, "utf8") as string;
    expect(updatedHwm.trim()).toBe(`1002:${updatedSize}`);
  });

  it("filters out envelopes with seq <= highest and leaves .hwm unchanged", () => {
    const vfs = new ChatVirtualFS(NOW_MS);
    const ports = makePorts(vfs);

    appendSpool(ROOM, READER, [makeEnvelope(10), makeEnvelope(20), makeEnvelope(30)], { ports });

    const sizeBefore = vfs.statSync(SPOOL_PATH)?.size ?? 0;
    expect((vfs.readFileSync(HWM_PATH, "utf8") as string).trim()).toBe(`30:${sizeBefore}`);

    const dupResult = appendSpool(
      ROOM,
      READER,
      [makeEnvelope(5), makeEnvelope(20), makeEnvelope(30)],
      { ports },
    );

    expect(dupResult.bytesWritten).toBe(0);
    expect((vfs.readFileSync(HWM_PATH, "utf8") as string).trim()).toBe(`30:${sizeBefore}`);
  });

  it("reconstructs .hwm with seq:byteSize when .hwm is deleted or missing", () => {
    const vfs = new ChatVirtualFS(NOW_MS);
    const ports = makePorts(vfs);

    appendSpool(ROOM, READER, [makeEnvelope(1), makeEnvelope(42), makeEnvelope(99)], { ports });

    const spoolSize = vfs.statSync(SPOOL_PATH)?.size ?? 0;
    expect(vfs.existsSync(HWM_PATH)).toBe(true);
    expect((vfs.readFileSync(HWM_PATH, "utf8") as string).trim()).toBe(`99:${spoolSize}`);

    vfs.rmSync(HWM_PATH);
    expect(vfs.existsSync(HWM_PATH)).toBe(false);

    const reconstructedSeq = getSpoolHighestSeq(SPOOL_PATH, ports);
    expect(reconstructedSeq).toBe(99);

    expect(vfs.existsSync(HWM_PATH)).toBe(true);
    expect((vfs.readFileSync(HWM_PATH, "utf8") as string).trim()).toBe(`99:${spoolSize}`);

    const readLog: ReadLogEntry[] = [];
    const monitoredPorts = makePorts(vfs, readLog);
    const cachedSeq = getSpoolHighestSeq(SPOOL_PATH, monitoredPorts);
    expect(cachedSeq).toBe(99);
    expect(readLog).toHaveLength(1);
    expect(readLog[0]!.path).toBe(HWM_PATH);
    expect(readLog[0]!.bytes).toBeLessThan(30);
  });

  it("detects size mismatch on truncated sidecar, rescans spool, and restores correct high-water mark", () => {
    const vfs = new ChatVirtualFS(NOW_MS);
    const ports = makePorts(vfs);

    appendSpool(ROOM, READER, [makeEnvelope(1), makeEnvelope(1547)], { ports });
    const spoolSize = vfs.statSync(SPOOL_PATH)?.size ?? 0;
    expect((vfs.readFileSync(HWM_PATH, "utf8") as string).trim()).toBe(`1547:${spoolSize}`);

    vfs.writeFileSync(HWM_PATH, "1:5");

    const recovered = getSpoolHighestSeq(SPOOL_PATH, ports);
    expect(recovered).toBe(1547);
    expect((vfs.readFileSync(HWM_PATH, "utf8") as string).trim()).toBe(`1547:${spoolSize}`);

    vfs.writeFileSync(HWM_PATH, "1");

    const recoveredFromRawInt = getSpoolHighestSeq(SPOOL_PATH, ports);
    expect(recoveredFromRawInt).toBe(1547);
    expect((vfs.readFileSync(HWM_PATH, "utf8") as string).trim()).toBe(`1547:${spoolSize}`);
  });

  it("removes .hwm sidecar when spool is rotated", () => {
    const vfs = new ChatVirtualFS(NOW_MS);
    const ports = makePorts(vfs);

    appendSpool(ROOM, READER, [makeEnvelope(1), makeEnvelope(2)], { ports });
    expect(vfs.existsSync(HWM_PATH)).toBe(true);

    const rotated = rotateSpoolIfNeeded(ROOM, READER, 10, ports);
    expect(rotated).toBe(true);
    expect(vfs.existsSync(HWM_PATH)).toBe(false);
  });
});
