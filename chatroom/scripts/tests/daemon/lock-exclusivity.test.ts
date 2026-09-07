import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  acquireDaemonLock,
  createInitialHealthRecord,
  releaseDaemonLock,
  writeHealthRecord,
} from "../../src/daemon/index.ts";
import { type LockPayload } from "../../src/core/index.ts";
import { inspectRoom } from "../../src/doctor/index.ts";

const mockOs = await import("node:os");
const mockFs = await import("node:fs");

const tempHome = join(
  mockOs.tmpdir(),
  "chat-lock-test-" + Date.now() + "-" + Math.random().toString(36).slice(2),
);
const prevHome = process.env.CHATROOM_HOME;
process.env.CHATROOM_HOME = tempHome;

const ROOM = "test-lock-exclusivity";
const READER = "reader-lock";

function makeLockPayload(
  pid: number,
  bootId: string = "boot-1",
  startTime: string = "2026-09-07T12:00:00.000Z",
): LockPayload {
  return {
    pid,
    start_time: startTime,
    boot_id: bootId,
    holder: `daemon:${ROOM}:${READER}`,
    host: "virtual",
    created_at: startTime,
  };
}

function writeLockFile(payload: LockPayload): string {
  const lockDir = join(tempHome, "rooms", ROOM, "locks", "daemon");
  mockFs.mkdirSync(lockDir, { recursive: true });
  const lockPath = join(lockDir, `${READER}.lock`);
  mockFs.writeFileSync(lockPath, JSON.stringify(payload, null, 2) + "\n");
  return lockPath;
}

function setupRoomManifest(room: string): void {
  const roomDir = join(tempHome, "rooms", room);
  mockFs.mkdirSync(roomDir, { recursive: true });
  const manifest = {
    v: 1,
    id: room,
    title: "Lock Test Room",
    visibility: "keyed",
    key_fingerprint: "test-fp",
    created_at: new Date().toISOString(),
  };
  mockFs.writeFileSync(join(roomDir, "room.json"), JSON.stringify(manifest, null, 2));
}

describe("Daemon Lock Exclusivity & Identity Discrepancy (T-83d7)", () => {
  beforeAll(() => {
    mockFs.mkdirSync(tempHome, { recursive: true });
    setupRoomManifest(ROOM);
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

  it("strictly refuses lock acquisition when checkAlive is true even if heartbeat is stale", () => {
    const incumbentPid = 99111;
    writeLockFile(makeLockPayload(incumbentPid, "system-boot-default", "2026-09-07T10:00:00.000Z"));

    const result = acquireDaemonLock(
      ROOM,
      READER,
      "test-host",
      {
        isProcessAlive: (pid: number) => pid === incumbentPid,
        getBootId: () => "system-boot-default",
        getStartTime: (pid: number) =>
          pid === incumbentPid ? "2026-09-07T10:00:00.000Z" : undefined,
        now: () => Date.parse("2026-09-07T12:00:00.000Z"),
      },
      {
        v: 1,
        poll_interval_ms: 1000,
        batch_size: 50,
        lease_ttl_ms: 30000,
        max_spool_bytes: 33554432,
        max_spool_lines: 20000,
        respawn_budget_per_hour: 20,
        harness_path: "mock",
        runtime_command: "mock",
        notify_command: "",
        heartbeat_interval_ms: 1000,
        stale_after_ms: 5000,
      },
    );

    expect(result.acquired).toBe(false);
    expect(result.lockFd).toBeNull();
    expect(result.holderPid).toBe(incumbentPid);
    expect(result.reason).toBe("already_running");
  });

  it("reclaims stale lock when checkAlive is false", () => {
    const deadPid = 99222;
    writeLockFile(makeLockPayload(deadPid, "system-boot-default", "2026-09-07T10:00:00.000Z"));

    const result = acquireDaemonLock(ROOM, READER, "test-host", {
      isProcessAlive: (pid: number) => pid !== deadPid && pid === process.pid,
      getBootId: () => "system-boot-default",
    });

    expect(result.acquired).toBe(true);
    expect(result.holderPid).toBe(process.pid);
    releaseDaemonLock(ROOM, READER, result.lockFd);
  });

  it("reclaims stale lock when boot_id mismatch indicates recycled PID", () => {
    const recycledPid = 99333;
    writeLockFile(makeLockPayload(recycledPid, "prior-boot-old", "2026-09-07T10:00:00.000Z"));

    const result = acquireDaemonLock(ROOM, READER, "test-host", {
      isProcessAlive: (pid: number) => pid === recycledPid || pid === process.pid,
      getBootId: () => "current-boot-new",
    });

    expect(result.acquired).toBe(true);
    expect(result.holderPid).toBe(process.pid);
    releaseDaemonLock(ROOM, READER, result.lockFd);
  });

  it("reclaims stale lock when start_time mismatch indicates recycled PID", () => {
    const recycledPid = 99444;
    writeLockFile(makeLockPayload(recycledPid, "same-boot", "2026-09-07T08:00:00.000Z"));

    const result = acquireDaemonLock(ROOM, READER, "test-host", {
      isProcessAlive: (pid: number) => pid === recycledPid || pid === process.pid,
      getBootId: () => "same-boot",
      getStartTime: (pid: number) => (pid === recycledPid ? "2026-09-07T11:00:00.000Z" : undefined),
    });

    expect(result.acquired).toBe(true);
    expect(result.holderPid).toBe(process.pid);
    releaseDaemonLock(ROOM, READER, result.lockFd);
  });

  it("reports PID discrepancy in doctor when daemon lock and health record disagree on live PID", () => {
    const lockPid = 88111;
    const healthPid = 88222;
    writeLockFile(makeLockPayload(lockPid, "boot-1", "2026-09-07T12:00:00.000Z"));

    const daemonDir = join(tempHome, "rooms", ROOM, "daemon");
    mockFs.mkdirSync(daemonDir, { recursive: true });
    const healthRecord = createInitialHealthRecord(
      ROOM,
      READER,
      healthPid,
      "2026-09-07T12:00:00.000Z",
      "boot-1",
      750,
    );
    writeHealthRecord(join(daemonDir, `${READER}.health.json`), healthRecord);

    const report = inspectRoom(ROOM, {
      baseDir: tempHome,
      isProcessAlive: (pid: number) => pid === lockPid || pid === healthPid,
    });

    const expectedIssue = `daemon lock PID ${lockPid} disagrees with health record PID ${healthPid}`;
    expect(report.issues.includes(expectedIssue)).toBe(true);
    expect(report.is_healthy).toBe(false);
  });

  it("does not report PID discrepancy when lock and health record have identical PID", () => {
    const sharedPid = 77111;
    writeLockFile(makeLockPayload(sharedPid, "boot-1", "2026-09-07T12:00:00.000Z"));

    const daemonDir = join(tempHome, "rooms", ROOM, "daemon");
    mockFs.mkdirSync(daemonDir, { recursive: true });
    const healthRecord = createInitialHealthRecord(
      ROOM,
      READER,
      sharedPid,
      "2026-09-07T12:00:00.000Z",
      "boot-1",
      750,
    );
    writeHealthRecord(join(daemonDir, `${READER}.health.json`), healthRecord);

    const report = inspectRoom(ROOM, {
      baseDir: tempHome,
      isProcessAlive: (pid: number) => pid === sharedPid,
    });

    const hasDiscrepancyIssue = report.issues.some((i) =>
      i.includes("disagrees with health record PID"),
    );
    expect(hasDiscrepancyIssue).toBe(false);
  });

  it("does not report PID discrepancy when lock PID is dead", () => {
    const deadLockPid = 66111;
    const healthPid = 66222;
    writeLockFile(makeLockPayload(deadLockPid, "boot-1", "2026-09-07T12:00:00.000Z"));

    const daemonDir = join(tempHome, "rooms", ROOM, "daemon");
    mockFs.mkdirSync(daemonDir, { recursive: true });
    const healthRecord = createInitialHealthRecord(
      ROOM,
      READER,
      healthPid,
      "2026-09-07T12:00:00.000Z",
      "boot-1",
      750,
    );
    writeHealthRecord(join(daemonDir, `${READER}.health.json`), healthRecord);

    const report = inspectRoom(ROOM, {
      baseDir: tempHome,
      isProcessAlive: (pid: number) => pid === healthPid,
    });

    const hasDiscrepancyIssue = report.issues.some((i) =>
      i.includes("disagrees with health record PID"),
    );
    expect(hasDiscrepancyIssue).toBe(false);
  });
});
