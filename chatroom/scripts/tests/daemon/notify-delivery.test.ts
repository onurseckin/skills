import { EventEmitter } from "node:events";
import { describe, expect, it } from "bun:test";
import { dirname } from "node:path";
import {
  createInitialHealthRecord,
  dispatchDeliveryNotification,
  dispatchNotify,
  executeNotifyCommand,
  readHealthRecord,
  recordConsumerReceipt,
  writeHealthRecord,
  type HealthPorts,
  type NotifyProcessChild,
  type NotifyProcessStream,
  type NotifySpawner,
} from "../../src/daemon/index.ts";
import { ChatVirtualFS } from "../../src/testing/virtual-fs/index.ts";
import { type Envelope } from "../../src/core/index.ts";

const HEALTH_PATH = "/rooms/review/daemon/reviewer.health.json";
const ROOM = "review";
const READER = "reviewer";
const NOW_ISO = "2026-09-07T12:00:00.000Z";

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

function createSampleEnvelope(seq: number): Envelope {
  return {
    v: 1,
    id: `msg-${seq}`,
    room: ROOM,
    seq,
    ts: NOW_ISO,
    sender: { id: "alice", role: "human", key_fingerprint: "key-fp" },
    kind: "chat",
    reply_to: null,
    mentions: [],
    text: `hello ${seq}`,
    body: { schema: "text", data: { text: `hello ${seq}` } },
    key_fingerprint: "key-fp",
    sig: "sig-hex",
  };
}

class MockProcess extends EventEmitter implements NotifyProcessChild {
  public killed = false;
  public signals: (NodeJS.Signals | number)[] = [];
  public stdinChunks: string[] = [];
  public stdinClosed = false;
  public readonly stdin: NotifyProcessStream;

  public constructor() {
    super();
    this.stdin = {
      write: (chunk: string): boolean => {
        this.stdinChunks.push(chunk);
        return true;
      },
      end: (): void => {
        this.stdinClosed = true;
      },
    };
  }

  public kill(signal?: NodeJS.Signals | number): boolean {
    this.killed = true;
    if (signal !== undefined) this.signals.push(signal);
    return true;
  }
}

describe("notify delivery process execution and timeout", () => {
  it("executes command, streams JSON envelopes to stdin, and reports ok on exit 0", async () => {
    let capturedCmd = "";
    let capturedChild: MockProcess | null = null;
    const spawner: NotifySpawner = (cmd) => {
      capturedCmd = cmd;
      const child = new MockProcess();
      capturedChild = child;
      queueMicrotask(() => {
        child.emit("exit", 0, null);
      });
      return child;
    };

    const batch = [createSampleEnvelope(1), createSampleEnvelope(2)];
    const result = await executeNotifyCommand("cat", batch, { spawnProcess: spawner });

    expect(capturedCmd).toBe("cat");
    expect(capturedChild).not.toBeNull();
    expect(capturedChild?.stdinClosed).toBe(true);
    expect(capturedChild?.stdinChunks.join("")).toBe(JSON.stringify(batch));
    expect(result).toEqual({ ok: true, exitCode: 0, timedOut: false });
  });

  it("reports ok false and preserves exit code on non-zero exit", async () => {
    const spawner: NotifySpawner = () => {
      const child = new MockProcess();
      queueMicrotask(() => {
        child.emit("exit", 1, null);
      });
      return child;
    };

    const batch = [createSampleEnvelope(1)];
    const result = await executeNotifyCommand("false", batch, { spawnProcess: spawner });

    expect(result).toEqual({ ok: false, exitCode: 1, timedOut: false });
  });

  it("reports ok false on process error", async () => {
    const spawner: NotifySpawner = () => {
      const child = new MockProcess();
      queueMicrotask(() => {
        child.emit("error", new Error("spawn ENOENT"));
      });
      return child;
    };

    const result = await executeNotifyCommand("bad-binary", [], { spawnProcess: spawner });

    expect(result).toEqual({ ok: false, exitCode: null, timedOut: false });
  });

  it("escalates SIGTERM then SIGKILL on timeout and does not hang", async () => {
    let capturedChild: MockProcess | null = null;
    const spawner: NotifySpawner = () => {
      const child = new MockProcess();
      capturedChild = child;
      child.kill = (sig) => {
        child.killed = true;
        if (sig !== undefined) {
          child.signals.push(sig);
        }
        if (sig === "SIGKILL" || sig === 9) {
          queueMicrotask(() => {
            child.emit("exit", null, "SIGKILL");
          });
        }
        return true;
      };
      return child;
    };

    const start = Date.now();
    const result = await executeNotifyCommand("sleep 100", [], {
      timeoutMs: 20,
      sigkillGraceMs: 20,
      spawnProcess: spawner,
    });
    const elapsed = Date.now() - start;

    expect(result).toEqual({ ok: false, exitCode: null, timedOut: true });
    expect(capturedChild).not.toBeNull();
    expect(capturedChild?.killed).toBe(true);
    expect(elapsed).toBeLessThan(500);
  });
});

describe("consumer receipt updates on notify delivery", () => {
  it("writes consumer_last_ack_at and consumer_last_delivered_seq on exit 0", async () => {
    const vfs = new ChatVirtualFS();
    const ports = createHealthPorts(vfs);
    const initial = createInitialHealthRecord(ROOM, READER, 100, NOW_ISO, "boot", 750);
    writeHealthRecord(HEALTH_PATH, initial, ports);

    const spawner: NotifySpawner = () => {
      const child = new MockProcess();
      queueMicrotask(() => {
        child.emit("exit", 0, null);
      });
      return child;
    };

    const ackTime = "2026-09-07T12:00:05.000Z";
    const envelopes = [createSampleEnvelope(10), createSampleEnvelope(11)];
    const result = await dispatchNotify({
      command: "notify-bin",
      envelopes,
      lastSeq: 11,
      healthPath: HEALTH_PATH,
      nowIso: ackTime,
      ports,
      spawnProcess: spawner,
    });

    expect(result?.ok).toBe(true);
    expect(result?.exitCode).toBe(0);

    const persisted = readHealthRecord(HEALTH_PATH, ports);
    expect(persisted?.consumer_last_ack_at).toBe(ackTime);
    expect(persisted?.consumer_last_delivered_seq).toBe(11);
  });

  it("does not update consumer_last_ack_at when notify exits non-zero", async () => {
    const vfs = new ChatVirtualFS();
    const ports = createHealthPorts(vfs);
    const initial = createInitialHealthRecord(ROOM, READER, 100, NOW_ISO, "boot", 750);
    writeHealthRecord(HEALTH_PATH, initial, ports);

    const spawner: NotifySpawner = () => {
      const child = new MockProcess();
      queueMicrotask(() => {
        child.emit("exit", 1, null);
      });
      return child;
    };

    const result = await dispatchNotify({
      command: "notify-bin",
      envelopes: [createSampleEnvelope(10)],
      lastSeq: 10,
      healthPath: HEALTH_PATH,
      nowIso: "2026-09-07T12:00:05.000Z",
      ports,
      spawnProcess: spawner,
    });

    expect(result?.ok).toBe(false);
    expect(result?.exitCode).toBe(1);

    const persisted = readHealthRecord(HEALTH_PATH, ports);
    expect(persisted?.consumer_last_ack_at).toBeNull();
    expect(persisted?.consumer_last_delivered_seq).toBeNull();
  });

  it("does not update consumer_last_ack_at when notify times out", async () => {
    const vfs = new ChatVirtualFS();
    const ports = createHealthPorts(vfs);
    const initial = createInitialHealthRecord(ROOM, READER, 100, NOW_ISO, "boot", 750);
    writeHealthRecord(HEALTH_PATH, initial, ports);

    const spawner: NotifySpawner = () => {
      const child = new MockProcess();
      child.kill = (sig) => {
        child.killed = true;
        queueMicrotask(() => {
          child.emit("exit", null, typeof sig === "string" ? sig : "SIGTERM");
        });
        return true;
      };
      return child;
    };

    const result = await dispatchNotify({
      command: "notify-bin",
      envelopes: [createSampleEnvelope(10)],
      lastSeq: 10,
      healthPath: HEALTH_PATH,
      nowIso: "2026-09-07T12:00:05.000Z",
      timeoutMs: 15,
      ports,
      spawnProcess: spawner,
    });

    expect(result?.ok).toBe(false);
    expect(result?.timedOut).toBe(true);

    const persisted = readHealthRecord(HEALTH_PATH, ports);
    expect(persisted?.consumer_last_ack_at).toBeNull();
    expect(persisted?.consumer_last_delivered_seq).toBeNull();
  });

  it("does nothing when command is missing or empty", async () => {
    const vfs = new ChatVirtualFS();
    const ports = createHealthPorts(vfs);
    const initial = createInitialHealthRecord(ROOM, READER, 100, NOW_ISO, "boot", 750);
    writeHealthRecord(HEALTH_PATH, initial, ports);

    const result = await dispatchNotify({
      command: null,
      envelopes: [createSampleEnvelope(10)],
      lastSeq: 10,
      healthPath: HEALTH_PATH,
      nowIso: "2026-09-07T12:00:05.000Z",
      ports,
    });

    expect(result).toBeNull();
    const persisted = readHealthRecord(HEALTH_PATH, ports);
    expect(persisted?.consumer_last_ack_at).toBeNull();
  });

  it("records consumer receipt directly via recordConsumerReceipt helper", () => {
    const vfs = new ChatVirtualFS();
    const ports = createHealthPorts(vfs);
    const initial = createInitialHealthRecord(ROOM, READER, 100, NOW_ISO, "boot", 750);
    writeHealthRecord(HEALTH_PATH, initial, ports);

    const ackTime = "2026-09-07T12:00:10.000Z";
    const updated = recordConsumerReceipt(HEALTH_PATH, ackTime, 99, ports);

    expect(updated?.consumer_last_ack_at).toBe(ackTime);
    expect(updated?.consumer_last_delivered_seq).toBe(99);

    const persisted = readHealthRecord(HEALTH_PATH, ports);
    expect(persisted?.consumer_last_ack_at).toBe(ackTime);
    expect(persisted?.consumer_last_delivered_seq).toBe(99);
  });
});

describe("dispatchDeliveryNotification integration", () => {
  it("updates recentErrors when notify command fails and keeps consumer_last_ack_at intact", async () => {
    const vfs = new ChatVirtualFS();
    const ports = createHealthPorts(vfs);
    const initial = createInitialHealthRecord(ROOM, READER, 100, NOW_ISO, "boot", 750);
    writeHealthRecord(HEALTH_PATH, initial, ports);

    const spawner: NotifySpawner = () => {
      const child = new MockProcess();
      queueMicrotask(() => {
        child.emit("exit", 2, null);
      });
      return child;
    };

    const recentErrors: string[] = [];
    let recordedErrors: string[] = [];
    const promise = dispatchDeliveryNotification({
      command: "failing-cmd",
      envelopes: [createSampleEnvelope(1)],
      lastSeq: 1,
      healthPath: HEALTH_PATH,
      nowIso: NOW_ISO,
      recentErrors,
      ports,
      spawnProcess: spawner,
      onErrorsUpdated: (errs) => {
        recordedErrors = [...errs];
      },
    });

    expect(promise).not.toBeUndefined();
    const res = await promise;
    expect(res?.ok).toBe(false);
    expect(recentErrors.length).toBe(1);
    expect(recentErrors[0]).toContain("notify_command failed");
    expect(recordedErrors.length).toBe(1);

    const persisted = readHealthRecord(HEALTH_PATH, ports);
    expect(persisted?.consumer_last_ack_at).toBeNull();
  });

  it("does not wedge execution when delivery notification times out", async () => {
    const vfs = new ChatVirtualFS();
    const ports = createHealthPorts(vfs);
    const initial = createInitialHealthRecord(ROOM, READER, 100, NOW_ISO, "boot", 750);
    writeHealthRecord(HEALTH_PATH, initial, ports);

    const spawner: NotifySpawner = () => {
      const child = new MockProcess();
      child.kill = (sig) => {
        child.killed = true;
        queueMicrotask(() => {
          child.emit("exit", null, typeof sig === "string" ? sig : "SIGTERM");
        });
        return true;
      };
      return child;
    };

    const recentErrors: string[] = [];
    const promise = dispatchDeliveryNotification({
      command: "hanging-cmd",
      envelopes: [createSampleEnvelope(1)],
      lastSeq: 1,
      healthPath: HEALTH_PATH,
      nowIso: NOW_ISO,
      recentErrors,
      timeoutMs: 20,
      ports,
      spawnProcess: spawner,
    });

    expect(promise).not.toBeUndefined();
    const res = await promise;
    expect(res?.ok).toBe(false);
    expect(res?.timedOut).toBe(true);
    expect(recentErrors.length).toBe(1);

    const persisted = readHealthRecord(HEALTH_PATH, ports);
    expect(persisted?.consumer_last_ack_at).toBeNull();
  });
});
