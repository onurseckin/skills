import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { startDaemon, type SupervisorPorts } from "../../chatroom/scripts/src/daemon/supervisor.ts";
import { doctorCommand } from "../../chatroom/scripts/src/cli/commands/doctor.ts";
import { addMember } from "../../chatroom/scripts/src/room/index.ts";
import { daemonHealthPath } from "../../chatroom/scripts/src/core/paths.ts";
import {
  createInitialHealthRecord,
  writeHealthRecord,
} from "../../chatroom/scripts/src/daemon/health.ts";
import {
  cleanupVirtualChatroomFS,
  createTestRoom,
  getVirtualChatroomFS,
  setupVirtualChatroomFS,
} from "./helpers.ts";

beforeEach(() => {
  setupVirtualChatroomFS();
});

afterEach(() => {
  cleanupVirtualChatroomFS();
});

describe("daemon survival and truthful liveness reporting", () => {
  it("verifies process is alive and heartbeat file exists, then reports STOPPED when killed", async () => {
    const room = "survival-test-room";
    const reader = "test-agent";

    createTestRoom({
      id: room,
      title: "Survival Test Room",
      visibility: "public",
      createdBy: reader,
    });
    addMember(room, {
      id: reader,
      role: "agent",
      host: "antigravity",
    });

    let processAlive = true;
    const testPid = 99881;
    const healthPath = daemonHealthPath(room, reader);
    const heartbeatPath = join("/virtual/chatroom/rooms", room, "daemon", "heartbeat.json");

    const ports: SupervisorPorts = {
      isProcessAlive: (pid: number): boolean => pid === testPid && processAlive,
      spawnDetached: (): number => {
        const record = createInitialHealthRecord(
          room,
          reader,
          testPid,
          new Date().toISOString(),
          "test-boot-id",
        );
        writeHealthRecord(healthPath, record);
        return testPid;
      },
    };

    const startResult = startDaemon({
      room,
      reader,
      ports,
      verifyAlive: true,
    });

    expect(startResult.status).toBe("started");
    expect(startResult.pid).toBe(testPid);
    expect(ports.isProcessAlive !== undefined && ports.isProcessAlive(testPid)).toBe(true);
    expect(getVirtualChatroomFS().existsSync(healthPath)).toBe(true);
    expect(getVirtualChatroomFS().existsSync(heartbeatPath)).toBe(true);

    const docBefore = await doctorCommand({
      room,
      isProcessAlive: ports.isProcessAlive,
    });
    expect(docBefore.is_healthy).toBe(true);
    expect(docBefore.liveness_states[room]?.[reader]).toBe("IDLE");

    processAlive = false;
    expect(ports.isProcessAlive !== undefined && ports.isProcessAlive(testPid)).toBe(false);

    const docAfter = await doctorCommand({
      room,
      isProcessAlive: ports.isProcessAlive,
    });
    expect(docAfter.is_healthy).toBe(false);
    expect(docAfter.total_issues).toBeGreaterThan(0);
    expect(docAfter.liveness_states[room]?.[reader]).toBe("STOPPED");
    expect(docAfter.markdown).toContain("STOPPED");
  });

  it("fails loud when daemon process dies immediately on spawn", () => {
    const room = "premature-death-room";
    const reader = "failing-agent";

    createTestRoom({
      id: room,
      title: "Premature Death Room",
      visibility: "public",
      createdBy: reader,
    });
    addMember(room, {
      id: reader,
      role: "agent",
      host: "antigravity",
    });

    const deadPid = 99882;
    const ports: SupervisorPorts = {
      isProcessAlive: (): boolean => false,
      spawnDetached: (): number => deadPid,
    };

    const startResult = startDaemon({
      room,
      reader,
      ports,
      gracePeriodMs: 50,
      verifyAlive: true,
    });

    expect(startResult.status).toBe("failed");
    expect(startResult.reason).toContain("exited prematurely");
  });
});
