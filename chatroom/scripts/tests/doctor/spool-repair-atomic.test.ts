import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { writeAtomic } from "../../src/core/index.ts";
import { createInitialHealthRecord } from "../../src/daemon/index.ts";
import {
  repairRoom,
  repairSpoolFile,
  repairTornSpools,
  type DoctorRepairOptions,
} from "../../src/doctor/index.ts";

const BASE_TEST_DIR =
  (process.env["TMPDIR"] ?? "/tmp") +
  "/chat-spool-repair-" +
  Date.now() +
  "-" +
  Math.random().toString(36).slice(2);

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
      ...createInitialHealthRecord(room, "agent-x", 88888, nowIso, "boot-x", 750),
      state: "IDLE" as const,
      last_wake_at: nowIso,
      updated_at: nowIso,
      last_delivered_seq: 0,
      room_head_seq: 0,
      lag_seqs: 0,
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
