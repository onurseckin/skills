import { describe, expect, it } from "bun:test";
import { dirname } from "node:path";
import { roomLogSegmentPath, type Envelope } from "../../src/core/index.ts";
import { type HealthPorts } from "../../src/daemon/index.ts";
import { ChatVirtualFS } from "../../src/testing/virtual-fs/index.ts";
import { processAutoAcknowledge } from "../../src/work/index.ts";

function createHealthPorts(vfs: ChatVirtualFS): HealthPorts {
  return {
    existsSync: (target: string) => vfs.existsSync(target),
    readFileSync: (target: string, encoding: string) =>
      vfs.readFileSync(target, encoding) as string,
    writeFileSync: (target: string, content: string) => {
      const dir = dirname(target);
      if (!vfs.existsSync(dir)) {
        vfs.mkdirSync(dir, { recursive: true });
      }
      vfs.writeFileSync(target, content);
    },
  };
}

function createSampleEnvelope(options: {
  readonly id: string;
  readonly taskId?: string;
  readonly assignee: string;
  readonly status?: string;
  readonly schema?: string;
  readonly acceptedAt?: string;
  readonly seq?: number;
}): Envelope {
  const schema = options.schema ?? "chatroom.task.new.v1";
  const data: Record<string, unknown> = {
    assignee: options.assignee,
  };
  if (options.taskId !== undefined) {
    data["task_id"] = options.taskId;
  }
  if (options.status !== undefined) {
    data["status"] = options.status;
  }
  if (options.acceptedAt !== undefined) {
    data["accepted_at"] = options.acceptedAt;
  }

  return {
    v: 1,
    id: options.id,
    room: "test-room",
    seq: options.seq ?? 1,
    ts: "2026-09-07T10:00:00.000Z",
    sender: {
      id: "dispatcher-1",
      role: "dispatcher",
      host: "localhost",
    },
    kind: "message",
    reply_to: null,
    mentions: [options.assignee],
    text: "Work task assignment",
    body: {
      schema,
      data,
    },
    key_fingerprint: "test-fp",
    sig: "test-sig",
  };
}

function readVirtualLogEnvelopes(vfs: ChatVirtualFS, room: string): readonly Envelope[] {
  const segmentPath = roomLogSegmentPath(room, "000001.jsonl");
  if (!vfs.existsSync(segmentPath)) {
    return [];
  }
  const content = vfs.readFileSync(segmentPath, "utf8") as string;
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.map((line) => JSON.parse(line) as Envelope);
}

describe("auto-ack work item processing", () => {
  it("reading a work item automatically records ACCEPTED without changing status", () => {
    const vfs = new ChatVirtualFS();
    const ports = createHealthPorts(vfs);
    const room = "test-room";
    const readerId = "worker-1";

    const taskEnvelope = createSampleEnvelope({
      id: "env-task-1",
      taskId: "T-001",
      assignee: readerId,
      status: "pending",
    });

    const result = processAutoAcknowledge(room, readerId, [taskEnvelope], ports);

    expect(result.length).toBe(1);
    const processedTask = result[0];
    expect(processedTask).toBeDefined();
    if (processedTask === undefined) {
      throw new Error("unreachable");
    }

    const processedData = processedTask.body.data as Record<string, unknown>;
    expect(processedData["status"]).toBe("pending");
    expect(typeof processedData["accepted_at"]).toBe("string");
    expect(processedData["accepted_at"]).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const logEnvelopes = readVirtualLogEnvelopes(vfs, room);
    expect(logEnvelopes.length).toBe(1);
    const acceptedEnvelope = logEnvelopes[0];
    expect(acceptedEnvelope).toBeDefined();
    if (acceptedEnvelope === undefined) {
      throw new Error("unreachable");
    }

    expect(acceptedEnvelope.body.schema).toBe("chatroom.task.accepted.v1");
    const acceptedData = acceptedEnvelope.body.data as Record<string, unknown>;
    expect(acceptedData["task_id"]).toBe("T-001");
    expect(acceptedData["assignee"]).toBe(readerId);
    expect(acceptedData["accepted_at"]).toBe(processedData["accepted_at"]);
    expect(acceptedData["status"]).toBeUndefined();
    expect(acceptedEnvelope.reply_to).toBe("env-task-1");
    expect(acceptedEnvelope.mentions).toContain("dispatcher-1");
  });

  it("leaves status unchanged across multiple distinct task states", () => {
    const vfs = new ChatVirtualFS();
    const ports = createHealthPorts(vfs);
    const room = "test-room";
    const readerId = "worker-1";

    const states = ["assigned", "in_progress", "open", "custom_state"];
    const envelopes = states.map((status, index) =>
      createSampleEnvelope({
        id: `env-${index}`,
        taskId: `T-STATE-${index}`,
        assignee: readerId,
        status,
        seq: index + 1,
      }),
    );

    const result = processAutoAcknowledge(room, readerId, envelopes, ports);

    for (let i = 0; i < states.length; i++) {
      const resItem = result[i];
      expect(resItem).toBeDefined();
      if (resItem === undefined) {
        throw new Error("unreachable");
      }
      const itemData = resItem.body.data as Record<string, unknown>;
      expect(itemData["status"]).toBe(states[i]);
      expect(typeof itemData["accepted_at"]).toBe("string");
    }

    const logEnvelopes = readVirtualLogEnvelopes(vfs, room);
    expect(logEnvelopes.length).toBe(states.length);
    for (const env of logEnvelopes) {
      const data = env.body.data as Record<string, unknown>;
      expect(env.body.schema).toBe("chatroom.task.accepted.v1");
      expect(data["status"]).toBeUndefined();
    }
  });

  it("ignores envelopes assigned to other readers", () => {
    const vfs = new ChatVirtualFS();
    const ports = createHealthPorts(vfs);
    const room = "test-room";
    const readerId = "worker-1";

    const foreignTask = createSampleEnvelope({
      id: "env-other-1",
      taskId: "T-FOREIGN-1",
      assignee: "worker-2",
      status: "pending",
    });

    const result = processAutoAcknowledge(room, readerId, [foreignTask], ports);

    expect(result.length).toBe(1);
    const resItem = result[0];
    expect(resItem).toBeDefined();
    if (resItem === undefined) {
      throw new Error("unreachable");
    }
    const resData = resItem.body.data as Record<string, unknown>;
    expect(resData["accepted_at"]).toBeUndefined();
    expect(resData["status"]).toBe("pending");

    const logEnvelopes = readVirtualLogEnvelopes(vfs, room);
    expect(logEnvelopes.length).toBe(0);
  });

  it("ignores non-task schema envelopes", () => {
    const vfs = new ChatVirtualFS();
    const ports = createHealthPorts(vfs);
    const room = "test-room";
    const readerId = "worker-1";

    const msgEnvelope = createSampleEnvelope({
      id: "env-msg-1",
      assignee: readerId,
      schema: "chatroom.message.v1",
    });

    const result = processAutoAcknowledge(room, readerId, [msgEnvelope], ports);

    expect(result.length).toBe(1);
    const logEnvelopes = readVirtualLogEnvelopes(vfs, room);
    expect(logEnvelopes.length).toBe(0);
  });

  it("is idempotent and does not re-append on subsequent reads", () => {
    const vfs = new ChatVirtualFS();
    const ports = createHealthPorts(vfs);
    const room = "test-room";
    const readerId = "worker-1";

    const taskEnvelope = createSampleEnvelope({
      id: "env-idem-1",
      taskId: "T-IDEM",
      assignee: readerId,
      status: "pending",
    });

    const firstRun = processAutoAcknowledge(room, readerId, [taskEnvelope], ports);
    const logAfterFirst = readVirtualLogEnvelopes(vfs, room);
    expect(logAfterFirst.length).toBe(1);

    const firstItem = firstRun[0];
    expect(firstItem).toBeDefined();
    if (firstItem === undefined) {
      throw new Error("unreachable");
    }
    const firstAcceptedAt = (firstItem.body.data as Record<string, unknown>)["accepted_at"];

    const secondRun = processAutoAcknowledge(room, readerId, firstRun, ports);
    const logAfterSecond = readVirtualLogEnvelopes(vfs, room);
    expect(logAfterSecond.length).toBe(1);

    const thirdRun = processAutoAcknowledge(room, readerId, [taskEnvelope], ports);
    const logAfterThird = readVirtualLogEnvelopes(vfs, room);
    expect(logAfterThird.length).toBe(1);

    const thirdItem = thirdRun[0];
    expect(thirdItem).toBeDefined();
    if (thirdItem === undefined) {
      throw new Error("unreachable");
    }
    const thirdAcceptedAt = (thirdItem.body.data as Record<string, unknown>)["accepted_at"];
    expect(thirdAcceptedAt).toBe(firstAcceptedAt);
  });

  it("handles duplicate tasks within the same batch without double recording", () => {
    const vfs = new ChatVirtualFS();
    const ports = createHealthPorts(vfs);
    const room = "test-room";
    const readerId = "worker-1";

    const task1 = createSampleEnvelope({
      id: "env-dup-1",
      taskId: "T-MULTI",
      assignee: readerId,
      status: "pending",
    });
    const task2 = createSampleEnvelope({
      id: "env-dup-2",
      taskId: "T-MULTI",
      assignee: readerId,
      status: "pending",
    });

    const result = processAutoAcknowledge(room, readerId, [task1, task2], ports);
    expect(result.length).toBe(2);

    const res1 = result[0];
    const res2 = result[1];
    expect(res1).toBeDefined();
    expect(res2).toBeDefined();
    if (res1 === undefined || res2 === undefined) {
      throw new Error("unreachable");
    }

    const t1Data = res1.body.data as Record<string, unknown>;
    const t2Data = res2.body.data as Record<string, unknown>;
    expect(t1Data["accepted_at"]).toBe(t2Data["accepted_at"]);

    const logEnvelopes = readVirtualLogEnvelopes(vfs, room);
    expect(logEnvelopes.length).toBe(1);
  });

  it("skips appending when task already has accepted_at recorded", () => {
    const vfs = new ChatVirtualFS();
    const ports = createHealthPorts(vfs);
    const room = "test-room";
    const readerId = "worker-1";

    const priorTimestamp = "2026-09-07T08:00:00.000Z";
    const alreadyAccepted = createSampleEnvelope({
      id: "env-prev-1",
      taskId: "T-PREV",
      assignee: readerId,
      status: "pending",
      acceptedAt: priorTimestamp,
    });

    const result = processAutoAcknowledge(room, readerId, [alreadyAccepted], ports);
    expect(result.length).toBe(1);

    const resItem = result[0];
    expect(resItem).toBeDefined();
    if (resItem === undefined) {
      throw new Error("unreachable");
    }
    const resData = resItem.body.data as Record<string, unknown>;
    expect(resData["accepted_at"]).toBe(priorTimestamp);
    expect(resData["status"]).toBe("pending");

    const logEnvelopes = readVirtualLogEnvelopes(vfs, room);
    expect(logEnvelopes.length).toBe(0);
  });
});
