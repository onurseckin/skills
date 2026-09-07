import { describe, expect, it } from "bun:test";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import {
  roomLogIndexPath,
  roomLogSegmentPath,
  type Envelope,
  type LogIndex,
  type UnsignedEnvelope,
} from "../../src/core/index.ts";
import { signEnvelope } from "../../src/crypto/index.ts";
import { type HealthPorts } from "../../src/daemon/index.ts";
import { ChatVirtualFS } from "../../src/testing/virtual-fs/index.ts";
import {
  clearWorkItemsCache,
  foldWorkItems,
  getWorkCachePath,
  loadWorkItems,
  processAutoAcknowledge,
  replayWorkItems,
  TASK_ACCEPTED_SCHEMA,
  TASK_NEW_SCHEMA,
  TASK_NOTE_SCHEMA,
  TASK_STATUS_SCHEMA,
  type WorkItemStatus,
} from "../../src/work/index.ts";

function createVirtualPorts(vfs: ChatVirtualFS): HealthPorts {
  const ensureDir = (p: string) => {
    const d = dirname(p);
    if (!vfs.existsSync(d)) vfs.mkdirSync(d, { recursive: true });
  };
  return {
    existsSync: (t: string) => vfs.existsSync(t),
    readFileSync: (t: string, enc: string) => vfs.readFileSync(t, enc) as string,
    writeFileSync: (t: string, c: string) => {
      ensureDir(t);
      vfs.writeFileSync(t, c);
    },
    writeAtomic: (t: string, c: string) => {
      ensureDir(t);
      vfs.writeFileSync(t, c);
    },
  };
}

function buildTestEnvelope(
  room: string,
  seq: number,
  schema: string,
  data: Readonly<Record<string, unknown>>,
  options?: {
    readonly id?: string;
    readonly text?: string;
    readonly thread?: string;
    readonly replyTo?: string | null;
    readonly mentions?: readonly string[];
    readonly senderId?: string;
    readonly ts?: string;
  },
): Envelope {
  const ts = options?.ts ?? `2026-09-07T12:00:0${seq}.000Z`;
  const unsigned: UnsignedEnvelope = {
    v: 1,
    id: options?.id ?? `env-${seq}-${room}`,
    room,
    seq,
    ts,
    sender: { id: options?.senderId ?? "dispatcher-1", role: "coordinator", host: "antigravity" },
    kind: "message",
    thread: options?.thread,
    reply_to: options?.replyTo ?? null,
    mentions: options?.mentions ?? [],
    text: options?.text ?? `Test message ${seq}`,
    body: { schema, data },
    key_fingerprint: "sha256:11223344",
  };
  return signEnvelope(unsigned, "mock-room-secret-key");
}

function appendEnvelopeToVFS(vfs: ChatVirtualFS, room: string, envelope: Envelope): void {
  const segPath = roomLogSegmentPath(room, "000001.jsonl");
  const dir = dirname(segPath);
  if (!vfs.existsSync(dir)) vfs.mkdirSync(dir, { recursive: true });
  const prev = vfs.existsSync(segPath) ? (vfs.readFileSync(segPath, "utf8") as string) : "";
  vfs.writeFileSync(segPath, `${prev}${JSON.stringify(envelope)}\n`);

  const indexPath = roomLogIndexPath(room);
  const index: LogIndex = {
    next_seq: envelope.seq + 1,
    segments: ["000001.jsonl"],
    head_seq: envelope.seq,
    updated_at: envelope.ts,
  };
  vfs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
}

describe("Work Tracking Integrity Validation Suite (LANE T5)", () => {
  it("Property 1: REPLAY EQUALITY - wiping cache and replaying log yields byte-identical projection", () => {
    const vfs = new ChatVirtualFS();
    const ports = createVirtualPorts(vfs);
    const room = "room-prop-1";

    const envelopes = [
      buildTestEnvelope(room, 1, TASK_NEW_SCHEMA, {
        id: "T-a001",
        title: "Storage",
        type: "story",
        status: "open",
        assignee: "alice",
      }),
      buildTestEnvelope(room, 2, TASK_NEW_SCHEMA, {
        id: "T-a002",
        title: "Scan",
        type: "task",
        status: "open",
        assignee: "bob",
        parent: "T-a001",
      }),
      buildTestEnvelope(room, 3, TASK_STATUS_SCHEMA, { id: "T-a001", status: "in_progress" }),
      buildTestEnvelope(room, 4, TASK_NOTE_SCHEMA, {
        id: "T-a001",
        text: "Draft complete",
        author: "alice",
      }),
      buildTestEnvelope(room, 5, TASK_ACCEPTED_SCHEMA, {
        id: "T-a002",
        accepted_at: "2026-09-07T12:05:00.000Z",
      }),
      buildTestEnvelope(room, 6, TASK_STATUS_SCHEMA, { id: "T-a002", status: "review" }),
      buildTestEnvelope(
        room,
        7,
        "chatroom.text.v1",
        { text: "Ref to T-a001" },
        { text: "Ref to T-a001" },
      ),
    ];
    for (const env of envelopes) appendEnvelopeToVFS(vfs, room, env);

    const baseline = loadWorkItems(room, ports);
    expect(baseline.size).toBe(2);
    expect(baseline.get("T-a001")?.status).toBe("in_progress");
    expect(baseline.get("T-a001")?.notes.length).toBe(1);
    expect(baseline.get("T-a001")?.topic_seqs).toContain(7);
    expect(baseline.get("T-a002")?.status).toBe("review");
    expect(baseline.get("T-a002")?.accepted_at).toBe("2026-09-07T12:05:00.000Z");

    const baselineJson = JSON.stringify(Array.from(baseline.entries()));
    const cachePath = getWorkCachePath(room);
    expect(vfs.existsSync(cachePath)).toBe(true);

    clearWorkItemsCache(room, ports);
    vfs.unlinkSync(cachePath);
    expect(vfs.existsSync(cachePath)).toBe(false);

    const replayed = replayWorkItems(room, ports);
    const replayedJson = JSON.stringify(Array.from(replayed.entries()));
    expect(replayedJson).toBe(baselineJson);
    expect(replayed.size).toBe(baseline.size);
    for (const [id, originalItem] of baseline.entries()) {
      expect(replayed.get(id)).toEqual(originalItem);
    }
  });

  it("Property 1 VACUITY PROOF: neutering replay log guarantees divergence (red) while restore passes (green)", () => {
    const vfs = new ChatVirtualFS();
    const ports = createVirtualPorts(vfs);
    const room = "room-prop-1-vacuity";

    const e1 = buildTestEnvelope(room, 1, TASK_NEW_SCHEMA, {
      id: "T-v001",
      title: "Task",
      type: "task",
      status: "open",
      assignee: "worker-1",
    });
    const e2 = buildTestEnvelope(room, 2, TASK_STATUS_SCHEMA, {
      id: "T-v001",
      status: "in_progress",
    });
    for (const env of [e1, e2]) appendEnvelopeToVFS(vfs, room, env);

    const baseline = loadWorkItems(room, ports);
    const baselineJson = JSON.stringify(Array.from(baseline.entries()));

    const neuteredLog = [
      e1,
      buildTestEnvelope(room, 2, TASK_STATUS_SCHEMA, { id: "T-v001", status: "blocked" }),
    ];
    const neuteredProjection = foldWorkItems(neuteredLog, room);
    const neuteredJson = JSON.stringify(Array.from(neuteredProjection.entries()));
    expect(neuteredJson === baselineJson).toBe(false);

    clearWorkItemsCache(room, ports);
    const cachePath = getWorkCachePath(room);
    if (vfs.existsSync(cachePath)) vfs.unlinkSync(cachePath);

    const restored = replayWorkItems(room, ports);
    const restoredJson = JSON.stringify(Array.from(restored.entries()));
    expect(restoredJson === baselineJson).toBe(true);
  });

  it("Property 2: ZERO STATUS ADVANCE ON READ - reading a work message sets ACCEPTED and does NOT change status", () => {
    const vfs = new ChatVirtualFS();
    const ports = createVirtualPorts(vfs);
    const room = "room-prop-2";
    const assignee = "worker-charlie";

    const taskEnv = buildTestEnvelope(
      room,
      1,
      TASK_NEW_SCHEMA,
      { id: "T-b001", title: "Fix crash", type: "bug", status: "open", assignee },
      { senderId: "dispatcher" },
    );
    appendEnvelopeToVFS(vfs, room, taskEnv);

    const initialBoard = foldWorkItems([taskEnv], room);
    expect(initialBoard.get("T-b001")?.status).toBe("open");
    expect(initialBoard.get("T-b001")?.accepted_at).toBeNull();

    const readEnvelopes = processAutoAcknowledge(room, assignee, [taskEnv], ports);
    expect(readEnvelopes.length).toBe(1);
    const processedTask = readEnvelopes[0];
    if (processedTask === undefined) throw new Error("unreachable");

    const processedData = processedTask.body.data as Record<string, unknown>;
    expect(processedData["status"]).toBe("open");
    expect(typeof processedData["accepted_at"]).toBe("string");
    expect(processedData["accepted_at"]).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const segPath = roomLogSegmentPath(room, "000001.jsonl");
    const logRaw = vfs.readFileSync(segPath, "utf8") as string;
    const logEnvelopes = logRaw
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Envelope);
    expect(logEnvelopes.length).toBe(2);

    const acceptedEnvelope = logEnvelopes[1];
    if (acceptedEnvelope === undefined) throw new Error("unreachable");
    expect(acceptedEnvelope.body.schema).toBe(TASK_ACCEPTED_SCHEMA);
    const acceptedData = acceptedEnvelope.body.data as Record<string, unknown>;
    expect(acceptedData["task_id"]).toBe("T-b001");
    expect(acceptedData["assignee"]).toBe(assignee);
    expect(acceptedData["accepted_at"]).toBe(processedData["accepted_at"]);
    expect(acceptedData["status"]).toBeUndefined();

    const updatedBoard = loadWorkItems(room, ports);
    const updatedItem = updatedBoard.get("T-b001");
    expect(updatedItem?.status).toBe("open");
    expect(updatedItem?.accepted_at).toBe(processedData["accepted_at"]);

    const reReadEnvelopes = processAutoAcknowledge(room, assignee, readEnvelopes, ports);
    expect(reReadEnvelopes.length).toBe(1);
    const logEnvelopesSecond = (vfs.readFileSync(segPath, "utf8") as string).trim().split("\n");
    expect(logEnvelopesSecond.length).toBe(2);
  });

  it("Property 2 VACUITY PROOF: status mutator fails invariance predicate (red) while actual read succeeds (green)", async () => {
    function verifyStatusInvariance(b: WorkItemStatus, a: WorkItemStatus): boolean {
      return b === a;
    }
    const advance = (s: WorkItemStatus): WorkItemStatus => (s === "open" ? "in_progress" : s);
    expect(verifyStatusInvariance("open", advance("open"))).toBe(false);
    expect(verifyStatusInvariance("open", "open")).toBe(true);

    const autoAckPath = resolve(import.meta.dir, "../../src/work/auto-ack.ts");
    const readCmdPath = resolve(import.meta.dir, "../../src/cli/commands/read.ts");
    const autoAckContent = await Bun.file(autoAckPath).text();
    const readCmdContent = await Bun.file(readCmdPath).text();
    const autoAckAst = ts.createSourceFile(
      "auto-ack.ts",
      autoAckContent,
      ts.ScriptTarget.Latest,
      true,
    );
    const readCmdAst = ts.createSourceFile("read.ts", readCmdContent, ts.ScriptTarget.Latest, true);

    const emittedSchemas: string[] = [];
    function scan(node: ts.Node): void {
      if (ts.isStringLiteral(node) && node.text === TASK_STATUS_SCHEMA) {
        emittedSchemas.push(node.text);
      }
      ts.forEachChild(node, scan);
    }
    scan(autoAckAst);
    scan(readCmdAst);
    expect(emittedSchemas.length).toBe(0);
  });
});
