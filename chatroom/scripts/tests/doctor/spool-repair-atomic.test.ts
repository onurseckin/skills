import { afterAll, describe, expect, it, spyOn } from "bun:test";
import { dirname, join } from "node:path";
import * as coreModule from "../../src/core/index.ts";
import { writeAtomic } from "../../src/core/index.ts";
import {
  repairRoom,
  repairSpoolFile,
  repairTornSpools,
  type DoctorRepairOptions,
} from "../../src/doctor/index.ts";
import { ChatVirtualFS } from "../../src/testing/virtual-fs/index.ts";

const mockFs = await import("node:fs");

const BASE_TEST_DIR = "/virtual-doctor-spool-repair";
const vfs = new ChatVirtualFS();

const tmpDirPath = process.env.TMPDIR ?? "/tmp";
const initialTmpEntries = new Set(mockFs.readdirSync(tmpDirPath));

const origExists = mockFs.existsSync;
const origRead = mockFs.readFileSync;
const origReaddir = mockFs.readdirSync;
const origStat = mockFs.statSync;
const origMkdir = mockFs.mkdirSync;
const origWrite = mockFs.writeFileSync;
const origAppend = mockFs.appendFileSync;
const origUnlink = mockFs.unlinkSync;
const origWriteAtomic = coreModule.writeAtomic;

const existsSpy = spyOn(mockFs, "existsSync").mockImplementation((target: unknown): boolean => {
  const p = String(target);
  return p.startsWith(BASE_TEST_DIR)
    ? vfs.existsSync(p)
    : origExists(target as Parameters<typeof origExists>[0]);
});

const readSpy = spyOn(mockFs, "readFileSync").mockImplementation(
  (target: unknown, options?: unknown): string | Buffer => {
    const p = String(target);
    if (p.startsWith(BASE_TEST_DIR)) {
      const result = vfs.readFileSync(p, options as Parameters<typeof vfs.readFileSync>[1]);
      if (typeof result === "string") return result;
      return Buffer.from(result);
    }
    return origRead(
      target as Parameters<typeof origRead>[0],
      options as Parameters<typeof origRead>[1],
    );
  },
);

const readdirSpy = spyOn(mockFs, "readdirSync").mockImplementation(
  (target: unknown, options?: unknown): string[] => {
    const p = String(target);
    return p.startsWith(BASE_TEST_DIR)
      ? vfs.readdirSync(p).map((item) => (typeof item === "string" ? item : item.name))
      : (origReaddir(
          target as Parameters<typeof origReaddir>[0],
          options as Parameters<typeof origReaddir>[1],
        ) as string[]);
  },
);

const statSpy = spyOn(mockFs, "statSync").mockImplementation((target: unknown) => {
  const p = String(target);
  return p.startsWith(BASE_TEST_DIR)
    ? (vfs.statSync(p) as unknown as ReturnType<typeof origStat>)
    : origStat(target as Parameters<typeof origStat>[0]);
});

const mkdirSpy = spyOn(mockFs, "mkdirSync").mockImplementation(
  (target: unknown, options?: unknown): unknown => {
    const p = String(target);
    if (p.startsWith(BASE_TEST_DIR)) {
      return vfs.mkdirSync(p, options as Parameters<typeof vfs.mkdirSync>[1]);
    }
    return origMkdir(
      target as Parameters<typeof origMkdir>[0],
      options as Parameters<typeof origMkdir>[1],
    );
  },
);

const writeSpy = spyOn(mockFs, "writeFileSync").mockImplementation(
  (target: unknown, data: unknown, options?: unknown): void => {
    const p = String(target);
    if (p.startsWith(BASE_TEST_DIR)) {
      vfs.mkdirSync(dirname(p), { recursive: true });
      vfs.writeFileSync(
        p,
        typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf-8"),
        options as Parameters<typeof vfs.writeFileSync>[2],
      );
      return;
    }
    origWrite(
      target as Parameters<typeof origWrite>[0],
      data as Parameters<typeof origWrite>[1],
      options as Parameters<typeof origWrite>[2],
    );
  },
);

const appendSpy = spyOn(mockFs, "appendFileSync").mockImplementation(
  (target: unknown, data: unknown, options?: unknown): void => {
    const p = String(target);
    if (p.startsWith(BASE_TEST_DIR)) {
      vfs.mkdirSync(dirname(p), { recursive: true });
      const current = vfs.existsSync(p) ? (vfs.readFileSync(p, "utf-8") as string) : "";
      const toAppend =
        typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf-8");
      vfs.writeFileSync(p, current + toAppend);
      return;
    }
    origAppend(
      target as Parameters<typeof origAppend>[0],
      data as Parameters<typeof origAppend>[1],
      options as Parameters<typeof origAppend>[2],
    );
  },
);

const unlinkSpy = spyOn(mockFs, "unlinkSync").mockImplementation((target: unknown): void => {
  const p = String(target);
  if (p.startsWith(BASE_TEST_DIR)) {
    vfs.unlinkSync(p);
    return;
  }
  origUnlink(target as Parameters<typeof origUnlink>[0]);
});

const writeAtomicSpy = spyOn(coreModule, "writeAtomic").mockImplementation(
  (filePath: string, content: string | Uint8Array): void => {
    const p = String(filePath);
    if (p.startsWith(BASE_TEST_DIR)) {
      vfs.mkdirSync(dirname(p), { recursive: true });
      vfs.writeFileSync(
        p,
        typeof content === "string" ? content : Buffer.from(content).toString("utf-8"),
      );
      return;
    }
    origWriteAtomic(filePath, content);
  },
);

afterAll(() => {
  existsSpy.mockRestore();
  readSpy.mockRestore();
  readdirSpy.mockRestore();
  statSpy.mockRestore();
  mkdirSpy.mockRestore();
  writeSpy.mockRestore();
  appendSpy.mockRestore();
  unlinkSpy.mockRestore();
  writeAtomicSpy.mockRestore();

  const currentTmpEntries = origReaddir(tmpDirPath);
  const leaked = currentTmpEntries.filter((entry) => !initialTmpEntries.has(entry));
  expect(leaked).toEqual([]);
});

const VALID_ENTRY_1 = JSON.stringify({ seq: 1, text: "msg-1" });
const VALID_ENTRY_2 = JSON.stringify({ seq: 2, text: "msg-2" });
const TORN_SUFFIX = '{"seq":3,"text":"incomplete_paylo';

describe("doctor repair atomic spool writing", () => {
  it("repairSpoolFile writes repaired content via writeAtomic spy when spool is torn", () => {
    const spoolDir = join(BASE_TEST_DIR, "case-a", "daemon");
    const spoolPath = join(spoolDir, "reader-torn.out.jsonl");
    const tornContent = `${VALID_ENTRY_1}\n${VALID_ENTRY_2}\n${TORN_SUFFIX}`;
    writeAtomic(spoolPath, tornContent);

    const spyCalls: Array<{ path: string; content: string }> = [];
    const spyWriteAtomic = (path: string, content: string): void => {
      spyCalls.push({ path, content });
      writeAtomic(path, content);
    };

    const repairResult = repairSpoolFile(spoolPath, "reader-torn", spyWriteAtomic);

    expect(repairResult.repaired).toBe(true);
    expect(repairResult.reader).toBe("reader-torn");
    expect(repairResult.spool_path).toBe(spoolPath);
    expect(repairResult.valid_lines).toBe(2);
    expect(repairResult.original_bytes).toBe(Buffer.byteLength(tornContent, "utf-8"));
    expect(repairResult.truncated_bytes).toBeGreaterThan(0);

    const expectedRepairedContent = `${VALID_ENTRY_1}\n${VALID_ENTRY_2}\n`;
    expect(repairResult.repaired_bytes).toBe(Buffer.byteLength(expectedRepairedContent, "utf-8"));

    expect(spyCalls.length).toBe(1);
    expect(spyCalls[0]?.path).toBe(spoolPath);
    expect(spyCalls[0]?.content).toBe(expectedRepairedContent);

    const rerun = repairSpoolFile(spoolPath, "reader-torn", spyWriteAtomic);
    expect(rerun.repaired).toBe(false);
    expect(rerun.valid_lines).toBe(2);
    expect(spyCalls.length).toBe(1);
  });

  it("repairSpoolFile uses default writeAtomic to durably persist repaired content", () => {
    const spoolDir = join(BASE_TEST_DIR, "case-default", "daemon");
    const spoolPath = join(spoolDir, "reader-default.out.jsonl");
    const tornContent = `${VALID_ENTRY_1}\n${VALID_ENTRY_2}\n${TORN_SUFFIX}`;
    writeAtomic(spoolPath, tornContent);

    const result = repairSpoolFile(spoolPath, "reader-default");
    expect(result.repaired).toBe(true);
    expect(result.valid_lines).toBe(2);
    expect(result.truncated_bytes).toBeGreaterThan(0);

    const verifyResult = repairSpoolFile(spoolPath, "reader-default");
    expect(verifyResult.repaired).toBe(false);
    expect(verifyResult.valid_lines).toBe(2);
    expect(verifyResult.truncated_bytes).toBe(0);
  });

  it("repairSpoolFile does not invoke write function when spool has no torn lines", () => {
    const spoolDir = join(BASE_TEST_DIR, "case-clean", "daemon");
    const spoolPath = join(spoolDir, "reader-clean.out.jsonl");
    const cleanContent = `${VALID_ENTRY_1}\n${VALID_ENTRY_2}\n`;
    writeAtomic(spoolPath, cleanContent);

    const spyCalls: Array<{ path: string; content: string }> = [];
    const spyWriteAtomic = (path: string, content: string): void => {
      spyCalls.push({ path, content });
    };

    const repairResult = repairSpoolFile(spoolPath, "reader-clean", spyWriteAtomic);

    expect(repairResult.repaired).toBe(false);
    expect(repairResult.valid_lines).toBe(2);
    expect(repairResult.truncated_bytes).toBe(0);
    expect(repairResult.original_bytes).toBe(Buffer.byteLength(cleanContent, "utf-8"));
    expect(repairResult.repaired_bytes).toBe(repairResult.original_bytes);
    expect(spyCalls.length).toBe(0);
  });

  it("repairSpoolFile returns repaired false for non-existent file without calling write", () => {
    const missingPath = join(BASE_TEST_DIR, "case-missing", "nonexistent.out.jsonl");
    const spyCalls: Array<{ path: string; content: string }> = [];
    const spyWriteAtomic = (path: string, content: string): void => {
      spyCalls.push({ path, content });
    };

    const repairResult = repairSpoolFile(missingPath, "reader-none", spyWriteAtomic);

    expect(repairResult.repaired).toBe(false);
    expect(repairResult.valid_lines).toBe(0);
    expect(spyCalls.length).toBe(0);
  });

  it("repairTornSpools propagates custom writeFn to repairSpoolFile", () => {
    const roomDir = join(BASE_TEST_DIR, "case-torn-spools", "rooms", "test-room");
    const daemonDir = join(roomDir, "daemon");
    const spoolPath = join(daemonDir, "reader-spool.out.jsonl");
    const tornContent = `${VALID_ENTRY_1}\n${TORN_SUFFIX}`;
    writeAtomic(spoolPath, tornContent);

    const spyCalls: Array<{ path: string; content: string }> = [];
    const spyWriteAtomic = (path: string, content: string): void => {
      spyCalls.push({ path, content });
      writeAtomic(path, content);
    };

    const repairs = repairTornSpools(roomDir, ["reader-spool"], spyWriteAtomic);

    expect(repairs.length).toBe(1);
    expect(repairs[0]?.reader).toBe("reader-spool");
    expect(repairs[0]?.repaired).toBe(true);
    expect(spyCalls.length).toBe(1);
    expect(spyCalls[0]?.path).toBe(spoolPath);
  });

  it("repairRoom repairs reader daemon torn spool via writeAtomic option", async () => {
    const room = "atomic-room";
    const roomBase = join(BASE_TEST_DIR, "case-integration", "rooms", room);

    const manifestPath = join(roomBase, "manifest.json");
    writeAtomic(
      manifestPath,
      JSON.stringify({ v: 1, room, created_at: "2026-09-07T14:00:00.000Z" }),
    );

    const memberPath = join(roomBase, "members", "agent-x.json");
    writeAtomic(
      memberPath,
      JSON.stringify({ room, member: "agent-x", joined_at: "2026-09-07T14:00:00.000Z" }),
    );

    const nowMs = Date.parse("2026-09-07T14:00:00.000Z");
    const nowIso = new Date(nowMs).toISOString();
    const healthRecord = {
      v: 1,
      room,
      reader: "agent-x",
      pid: 88888,
      start_time: nowIso,
      boot_id: "boot-x",
      state: "IDLE",
      last_wake_at: nowIso,
      last_wake_source: "start",
      poll_interval_ms: 750,
      updated_at: nowIso,
      last_delivered_seq: 0,
      room_head_seq: 0,
      lag_seqs: 0,
      watch_active: false,
      watch_failures: 0,
      spool_bytes: 0,
      spool_lines: 0,
      consumer_last_ack_at: null,
      consumer_last_delivered_seq: null,
      consumer_lag_ms: null,
      respawns_this_hour: 0,
      errors_recent: [] as readonly string[],
      wakes_by_source: { watch: 0, poll: 0, tick: 0, token: 0 },
    };
    const healthPath = join(roomBase, "daemon", "agent-x.health.json");
    writeAtomic(healthPath, JSON.stringify(healthRecord));

    const lockPath = join(roomBase, "locks", "daemon", "agent-x.lock");
    writeAtomic(
      lockPath,
      JSON.stringify({
        pid: 88888,
        boot_id: "boot-x",
        start_time: nowIso,
        holder: `daemon:${room}:agent-x`,
      }),
    );

    const spoolPath = join(roomBase, "daemon", "agent-x.out.jsonl");
    const tornContent = `${VALID_ENTRY_1}\n${VALID_ENTRY_2}\n${TORN_SUFFIX}`;
    writeAtomic(spoolPath, tornContent);

    const spyCalls: Array<{ path: string; content: string }> = [];
    const spyWriteAtomic = (path: string, content: string): void => {
      spyCalls.push({ path, content });
      writeAtomic(path, content);
    };

    const repairOptions: DoctorRepairOptions = {
      baseDir: join(BASE_TEST_DIR, "case-integration"),
      writeAtomic: spyWriteAtomic,
      now: () => nowMs,
      isProcessAlive: (pid: number) => pid === 88888,
      ensureDaemon: () => {},
    };

    const report = await repairRoom(room, repairOptions);

    expect(report.room).toBe(room);
    expect(report.success).toBe(true);
    expect(report.total_repairs).toBe(1);
    expect(report.repaired_spools.length).toBe(1);

    const repairedSpool = report.repaired_spools[0];
    expect(repairedSpool?.reader).toBe("agent-x");
    expect(repairedSpool?.repaired).toBe(true);
    expect(repairedSpool?.valid_lines).toBe(2);
    expect(repairedSpool?.truncated_bytes).toBeGreaterThan(0);

    expect(spyCalls.length).toBe(1);
    expect(spyCalls[0]?.path).toBe(spoolPath);
    expect(spyCalls[0]?.content).toBe(`${VALID_ENTRY_1}\n${VALID_ENTRY_2}\n`);

    const secondReport = await repairRoom(room, repairOptions);
    expect(secondReport.repaired_spools.length).toBe(0);
    expect(secondReport.total_repairs).toBe(0);
    expect(spyCalls.length).toBe(1);
  });
});
