import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import {
  createInitialHealthRecord,
  writeHealthRecord,
} from "../../../chatroom/scripts/src/daemon/health.ts";
import { stepDaemonLoop } from "../../../chatroom/scripts/src/daemon/loop.ts";
import {
  dispatchDeliveryNotification,
  dispatchRespawnNotification,
  type NotifyProcessChild,
  type NotifyProcessStream,
  type NotifySpawner,
  type RespawnNotificationPayload,
} from "../../../chatroom/scripts/src/daemon/notify.ts";
import {
  startDaemon,
  type SupervisorPorts,
} from "../../../chatroom/scripts/src/daemon/supervisor.ts";
import {
  daemonHealthPath,
  daemonOutSpoolPath,
  roomDir,
} from "../../../chatroom/scripts/src/core/paths.ts";
import { appendMessage } from "../../../chatroom/scripts/src/log/append.ts";
import { addMember } from "../../../chatroom/scripts/src/room/index.ts";
import { resolvePolicy } from "../../../chatroom/scripts/src/policy/resolve.ts";
import { type VirtualMemoryFS } from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import {
  cleanupVirtualChatroomFS,
  createTestRoom,
  getVirtualChatroomFS,
  setupVirtualChatroomFS,
} from "../helpers.ts";

class MockProcess extends EventEmitter implements NotifyProcessChild {
  public stdinChunks: string[] = [];
  public readonly stdin: NotifyProcessStream;

  public constructor() {
    super();
    this.stdin = {
      write: (chunk: string): boolean => {
        this.stdinChunks.push(chunk);
        return true;
      },
      end: (): void => {},
    };
  }

  public kill(): boolean {
    return true;
  }
}

function collectFilePaths(vfs: VirtualMemoryFS, dir: string): string[] {
  if (!vfs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of vfs.readdirSync(dir)) {
    const fullPath = `${dir}/${entry}`;
    if (vfs.statSync(fullPath).isDirectory()) {
      results.push(...collectFilePaths(vfs, fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

function createMockPorts(
  pid: number,
  room: string,
  reader: string,
  healthPath: string,
): SupervisorPorts {
  return {
    isProcessAlive: (p: number) => p === pid,
    spawnDetached: () => {
      writeHealthRecord(
        healthPath,
        createInitialHealthRecord(room, reader, pid, new Date().toISOString(), "boot"),
      );
      return pid;
    },
  };
}

beforeEach(() => {
  setupVirtualChatroomFS();
});

afterEach(() => {
  cleanupVirtualChatroomFS();
});

describe("daemon respawn wake notification and pure projection", () => {
  it("fires notify command with payload containing reason respawn on respawn", async () => {
    const room = "respawn-wake-room";
    const reader = "agent-reviewer";
    createTestRoom({
      id: room,
      title: "Respawn Wake Room",
      visibility: "public",
      createdBy: reader,
    });
    addMember(room, { id: reader, role: "agent", host: "antigravity" });

    const deadPid = 91001;
    const newPid = 91002;
    const healthPath = daemonHealthPath(room, reader);
    const priorHealth = createInitialHealthRecord(
      room,
      reader,
      deadPid,
      "2026-09-07T10:00:00.000Z",
      "boot-1",
    );
    writeHealthRecord(healthPath, { ...priorHealth, state: "STOPPED" });

    let capturedCommand = "";
    let capturedChild: MockProcess | null = null;
    const spawner: NotifySpawner = (cmd) => {
      capturedCommand = cmd;
      const child = new MockProcess();
      capturedChild = child;
      queueMicrotask(() => child.emit("exit", 0, null));
      return child;
    };

    const ports = createMockPorts(newPid, room, reader, healthPath);
    const res = startDaemon({
      room,
      reader,
      notifyCommand: "echo respawn-wake",
      ports,
      notifyOptions: { spawnProcess: spawner },
    });

    expect(res.status).toBe("started");
    expect(res.pid).toBe(newPid);

    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    expect(capturedCommand).toBe("echo respawn-wake");
    expect(capturedChild).not.toBeNull();
    const rawStdin = capturedChild ? capturedChild.stdinChunks.join("") : "";
    const parsedPayload = JSON.parse(rawStdin) as RespawnNotificationPayload[];
    expect(Array.isArray(parsedPayload)).toBe(true);
    expect(parsedPayload).toHaveLength(1);
    const payload = parsedPayload[0];
    expect(payload?.reason).toBe("respawn");
    expect(payload?.room).toBe(room);
    expect(payload?.reader).toBe(reader);
    expect(payload?.message).toBe("daemon respawned, run chat mine to recover context");
    expect(typeof payload?.ts).toBe("string");
    expect(Number.isNaN(Date.parse(payload?.ts ?? ""))).toBe(false);
  });

  it("does NOT write recovery brief to spool, log, or filesystem (pure projection)", async () => {
    const room = "projection-audit-room";
    const reader = "audit-agent";
    createTestRoom({
      id: room,
      title: "Projection Audit Room",
      visibility: "public",
      createdBy: reader,
    });
    addMember(room, { id: reader, role: "agent", host: "antigravity" });

    const deadPid = 92001;
    const newPid = 92002;
    const healthPath = daemonHealthPath(room, reader);
    const priorHealth = createInitialHealthRecord(
      room,
      reader,
      deadPid,
      "2026-09-07T10:00:00.000Z",
      "boot-1",
    );
    writeHealthRecord(healthPath, priorHealth);

    let capturedChild: MockProcess | null = null;
    const spawner: NotifySpawner = () => {
      const child = new MockProcess();
      capturedChild = child;
      queueMicrotask(() => child.emit("exit", 0, null));
      return child;
    };

    const ports = createMockPorts(newPid, room, reader, healthPath);
    const vfs = getVirtualChatroomFS();
    const filesBefore = collectFilePaths(vfs, roomDir(room));

    startDaemon({
      room,
      reader,
      notifyCommand: "echo wake",
      ports,
      notifyOptions: { spawnProcess: spawner },
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(capturedChild).not.toBeNull();

    const filesAfter = collectFilePaths(vfs, roomDir(room));
    expect(filesAfter.length).toBeGreaterThan(0);

    const forbiddenPhrase = "daemon respawned, run chat mine to recover context";
    for (const filePath of filesAfter) {
      const content = vfs.readFileSync(filePath, "utf8");
      expect(content).not.toContain(forbiddenPhrase);
      expect(content).not.toContain('"reason":"respawn"');
    }

    const newFiles = filesAfter.filter((f) => !filesBefore.includes(f));
    for (const newFile of newFiles) {
      expect(newFile.includes("/log/")).toBe(false);
    }

    const spoolPath = daemonOutSpoolPath(room, reader);
    if (vfs.existsSync(spoolPath)) {
      const spoolContent = vfs.readFileSync(spoolPath, "utf8");
      expect(spoolContent).not.toContain(forbiddenPhrase);
      expect(spoolContent).not.toContain('"reason":"respawn"');
    }
  });

  it("ensures ordinary delivery wake does NOT carry the respawn reason", async () => {
    const room = "delivery-wake-room";
    const reader = "delivery-agent";
    createTestRoom({
      id: room,
      title: "Delivery Wake Room",
      visibility: "public",
      createdBy: reader,
    });
    addMember(room, { id: reader, role: "agent", host: "antigravity" });

    const chatEnv = appendMessage(room, {
      sender: { id: reader, role: "agent", host: "antigravity" },
      kind: "message",
      body: { schema: "text", data: { text: "normal chat message" } },
    });

    let deliveryPayload: unknown = null;
    const deliverySpawner: NotifySpawner = () => {
      const child = new MockProcess();
      child.stdin = {
        write: (chunk: string): boolean => {
          deliveryPayload = JSON.parse(chunk);
          return true;
        },
        end: (): void => {},
      };
      queueMicrotask(() => child.emit("exit", 0, null));
      return child;
    };

    const policy = { ...resolvePolicy(), notify_command: "echo delivery" };
    const stepRes = stepDaemonLoop({
      room,
      reader,
      policy,
      spawnNotify: deliverySpawner,
      now: new Date().toISOString(),
    });

    expect(stepRes.delivered).toBe(1);
    await stepRes.notifyPromise;

    expect(deliveryPayload).not.toBeNull();
    expect(Array.isArray(deliveryPayload)).toBe(true);
    const envelopes = deliveryPayload as Record<string, unknown>[];
    expect(envelopes.length).toBe(1);
    const env = envelopes[0];
    expect(env).toBeDefined();
    expect(env?.["kind"]).toBe("message");
    expect(env?.["seq"]).toBe(1);
    expect("reason" in (env ?? {})).toBe(false);
    expect(env?.["reason"]).toBeUndefined();

    const directResult = await dispatchDeliveryNotification({
      command: "echo direct",
      envelopes: [chatEnv],
      lastSeq: 1,
      healthPath: daemonHealthPath(room, reader),
      nowIso: new Date().toISOString(),
      recentErrors: [],
      spawnProcess: deliverySpawner,
    });
    expect(directResult).not.toBeNull();
    expect(directResult?.ok).toBe(true);
    const directBatch = deliveryPayload as Record<string, unknown>[];
    expect("reason" in (directBatch[0] ?? {})).toBe(false);
  });

  it("vacuity: does NOT fire respawn notification on fresh start or without respawn trigger", async () => {
    const room = "vacuity-test-room";
    const reader = "vacuity-agent";
    createTestRoom({
      id: room,
      title: "Vacuity Test Room",
      visibility: "public",
      createdBy: reader,
    });
    addMember(room, { id: reader, role: "agent", host: "antigravity" });

    let spawnerCalled = false;
    const spawner: NotifySpawner = () => {
      spawnerCalled = true;
      const child = new MockProcess();
      queueMicrotask(() => child.emit("exit", 0, null));
      return child;
    };

    const testPid = 93001;
    const healthPath = daemonHealthPath(room, reader);
    const ports = createMockPorts(testPid, room, reader, healthPath);

    const resFresh = startDaemon({
      room,
      reader,
      notifyCommand: "echo fresh-wake",
      ports,
      notifyOptions: { spawnProcess: spawner },
    });

    expect(resFresh.status).toBe("started");
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(spawnerCalled).toBe(false);

    let explicitFalseCalled = false;
    const spawnerExplicit: NotifySpawner = () => {
      explicitFalseCalled = true;
      const child = new MockProcess();
      queueMicrotask(() => child.emit("exit", 0, null));
      return child;
    };

    startDaemon({
      room,
      reader,
      notifyCommand: "echo explicit-false",
      isRespawn: false,
      ports,
      notifyOptions: { spawnProcess: spawnerExplicit },
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(explicitFalseCalled).toBe(false);

    const nullResult = await dispatchRespawnNotification(null, {
      reason: "respawn",
      room,
      reader,
      ts: new Date().toISOString(),
      message: "daemon respawned, run chat mine to recover context",
    });
    expect(nullResult).toBeNull();
  });
});
