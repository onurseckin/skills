import { describe, expect, it } from "bun:test";
import {
  ChatError,
  createInitialCursor,
  leaseNext,
  scanFromDirectory,
  scanFromFile,
  type LogEnvelope,
} from "../../src/cursor/index.ts";
import { ChatVirtualFS } from "../../src/testing/virtual-fs/index.ts";

function makeEnvelope(room: string, seq: number): LogEnvelope {
  return {
    v: 1,
    id: `msg-${seq}`,
    room,
    seq,
    ts: new Date(1700000000000 + seq * 1000).toISOString(),
    sender: {
      id: "agent-test",
      role: "tester",
      host: "virtual",
    },
    kind: "chat",
    text: `Message ${seq}`,
    key_fingerprint: "fp-virtual",
    sig: `sig-${seq}`,
  };
}

function serializeEnvelopes(envelopes: readonly LogEnvelope[]): string {
  return envelopes.map((env) => JSON.stringify(env)).join("\n") + "\n";
}

describe("leaseNext spool reading and segment awareness", () => {
  it("maintains leaseNext.length === 3", () => {
    expect(leaseNext.length).toBe(3);
  });

  it("reads from a single unsegmented spool file", () => {
    const vfs = new ChatVirtualFS();
    const room = "alpha";
    const reader = "reader-1";
    const spoolDir = "/rooms/alpha/daemon";
    vfs.mkdirSync(spoolDir, { recursive: true });
    const spoolPath = `${spoolDir}/${reader}.out.jsonl`;
    const envs = [makeEnvelope(room, 1), makeEnvelope(room, 2), makeEnvelope(room, 3)];
    vfs.writeFileSync(spoolPath, serializeEnvelopes(envs));

    const cursor = createInitialCursor(room, reader);
    const result = leaseNext(cursor, spoolPath, 10, { fs: vfs });

    expect(result.leaseId).toBeString();
    expect(result.messages.length).toBe(3);
    expect(result.messages[0]?.seq).toBe(1);
    expect(result.messages[1]?.seq).toBe(2);
    expect(result.messages[2]?.seq).toBe(3);
    expect(result.cursor.held.length).toBe(1);
    expect(result.cursor.held[0]?.from).toBe(1);
    expect(result.cursor.held[0]?.to).toBe(3);
  });

  it("reads from segmented spool files in correct sequence followed by active file", () => {
    const vfs = new ChatVirtualFS();
    const room = "segmented-room";
    const reader = "reader-seg";
    const spoolDir = "/rooms/segmented-room/daemon";
    vfs.mkdirSync(spoolDir, { recursive: true });

    vfs.writeFileSync(
      `${spoolDir}/${reader}.out.1.jsonl`,
      serializeEnvelopes([makeEnvelope(room, 1), makeEnvelope(room, 2)]),
    );
    vfs.writeFileSync(
      `${spoolDir}/${reader}.out.2.jsonl`,
      serializeEnvelopes([makeEnvelope(room, 3), makeEnvelope(room, 4)]),
    );
    vfs.writeFileSync(
      `${spoolDir}/${reader}.out.jsonl`,
      serializeEnvelopes([makeEnvelope(room, 5), makeEnvelope(room, 6)]),
    );

    const cursor = createInitialCursor(room, reader);
    const spoolPath = `${spoolDir}/${reader}.out.jsonl`;
    const result = leaseNext(cursor, spoolPath, 10, { fs: vfs });

    expect(result.messages.length).toBe(6);
    expect(result.messages.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result.cursor.held.length).toBe(1);
    expect(result.cursor.held[0]?.from).toBe(1);
    expect(result.cursor.held[0]?.to).toBe(6);
  });

  it("respects batch limits across segmented files", () => {
    const vfs = new ChatVirtualFS();
    const room = "limit-room";
    const reader = "reader-limit";
    const spoolDir = "/rooms/limit-room/daemon";
    vfs.mkdirSync(spoolDir, { recursive: true });

    vfs.writeFileSync(
      `${spoolDir}/${reader}.out.1.jsonl`,
      serializeEnvelopes([makeEnvelope(room, 1), makeEnvelope(room, 2)]),
    );
    vfs.writeFileSync(
      `${spoolDir}/${reader}.out.2.jsonl`,
      serializeEnvelopes([makeEnvelope(room, 3), makeEnvelope(room, 4)]),
    );
    vfs.writeFileSync(
      `${spoolDir}/${reader}.out.jsonl`,
      serializeEnvelopes([makeEnvelope(room, 5), makeEnvelope(room, 6)]),
    );

    const cursor = createInitialCursor(room, reader);
    const spoolPath = `${spoolDir}/${reader}.out.jsonl`;

    const batch1 = leaseNext(cursor, spoolPath, 3, { fs: vfs });
    expect(batch1.messages.map((m) => m.seq)).toEqual([1, 2, 3]);
    expect(batch1.cursor.held[0]?.from).toBe(1);
    expect(batch1.cursor.held[0]?.to).toBe(3);

    const batch2 = leaseNext(batch1.cursor, spoolPath, 3, { fs: vfs });
    expect(batch2.messages.map((m) => m.seq)).toEqual([4, 5, 6]);
    expect(batch2.cursor.held.length).toBe(2);
    expect(batch2.cursor.held[1]?.from).toBe(4);
    expect(batch2.cursor.held[1]?.to).toBe(6);
  });

  it("sorts segments numerically rather than lexicographically", () => {
    const vfs = new ChatVirtualFS();
    const room = "num-room";
    const reader = "reader-num";
    const spoolDir = "/rooms/num-room/daemon";
    vfs.mkdirSync(spoolDir, { recursive: true });

    vfs.writeFileSync(
      `${spoolDir}/${reader}.out.1.jsonl`,
      serializeEnvelopes([makeEnvelope(room, 1)]),
    );
    vfs.writeFileSync(
      `${spoolDir}/${reader}.out.2.jsonl`,
      serializeEnvelopes([makeEnvelope(room, 2)]),
    );
    vfs.writeFileSync(
      `${spoolDir}/${reader}.out.10.jsonl`,
      serializeEnvelopes([makeEnvelope(room, 3)]),
    );
    vfs.writeFileSync(
      `${spoolDir}/${reader}.out.jsonl`,
      serializeEnvelopes([makeEnvelope(room, 4)]),
    );

    const cursor = createInitialCursor(room, reader);
    const spoolPath = `${spoolDir}/${reader}.out.jsonl`;
    const result = leaseNext(cursor, spoolPath, 10, { fs: vfs });

    expect(result.messages.map((m) => m.seq)).toEqual([1, 2, 3, 4]);
  });

  it("handles directory input without ENOTDIR crash on files", () => {
    const vfs = new ChatVirtualFS();
    const room = "dir-room";
    const reader = "reader-dir";
    const roomDir = "/rooms/dir-room/logs";
    vfs.mkdirSync(roomDir, { recursive: true });
    vfs.writeFileSync(`${roomDir}/0001.jsonl`, serializeEnvelopes([makeEnvelope(room, 1)]));
    vfs.writeFileSync(`${roomDir}/not-a-log.txt`, "arbitrary text");

    const cursor = createInitialCursor(room, reader);
    const result = leaseNext(cursor, roomDir, 10, { fs: vfs });

    expect(result.messages.length).toBe(1);
    expect(result.messages[0]?.seq).toBe(1);
  });

  it("handles regular non-spool file targets directly without throwing ENOTDIR", () => {
    const vfs = new ChatVirtualFS();
    const room = "file-room";
    const reader = "reader-file";
    const filePath = "/rooms/file-room/plain.jsonl";
    vfs.mkdirSync("/rooms/file-room", { recursive: true });
    vfs.writeFileSync(filePath, serializeEnvelopes([makeEnvelope(room, 1), makeEnvelope(room, 2)]));

    const cursor = createInitialCursor(room, reader);
    const result = leaseNext(cursor, filePath, 10, { fs: vfs });

    expect(result.messages.length).toBe(2);
    expect(result.messages.map((m) => m.seq)).toEqual([1, 2]);
  });

  it("throws ChatError INVALID_STATE in scanFromDirectory when target is a regular file", () => {
    const vfs = new ChatVirtualFS();
    const filePath = "/rooms/test/file.jsonl";
    vfs.mkdirSync("/rooms/test", { recursive: true });
    vfs.writeFileSync(filePath, "dummy");

    let thrown: unknown;
    try {
      scanFromDirectory(filePath, 1, 10, vfs);
    } catch (error) {
      thrown = error;
    }
    expect(thrown instanceof ChatError).toBe(true);
    expect((thrown as ChatError).code).toBe("INVALID_STATE");
  });

  it("throws ChatError INVALID_STATE in scanFromFile when target is a directory", () => {
    const vfs = new ChatVirtualFS();
    const dirPath = "/rooms/test/dir";
    vfs.mkdirSync(dirPath, { recursive: true });

    let thrown: unknown;
    try {
      scanFromFile(dirPath, 1, 10, vfs);
    } catch (error) {
      thrown = error;
    }
    expect(thrown instanceof ChatError).toBe(true);
    expect((thrown as ChatError).code).toBe("INVALID_STATE");
  });

  it("handles non-existent paths gracefully without throwing", () => {
    const vfs = new ChatVirtualFS();
    const cursor = createInitialCursor("r", "r");

    const resDir = leaseNext(cursor, "/nonexistent/dir", 10, { fs: vfs });
    expect(resDir.messages).toEqual([]);
    expect(resDir.leaseId).toBeNull();

    const resFile = leaseNext(cursor, "/nonexistent/file.out.jsonl", 10, { fs: vfs });
    expect(resFile.messages).toEqual([]);
    expect(resFile.leaseId).toBeNull();
  });
});
