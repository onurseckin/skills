import { describe, expect, it } from "bun:test";
import { readerCursorPath, roomDir } from "../../../src/core/index.ts";
import {
  ackLease,
  createInitialCursor,
  leaseNext,
  type LogEnvelope,
} from "../../../src/cursor/index.ts";
import { ChatVirtualFS } from "../../../src/testing/virtual-fs/index.ts";

function generateTestMessages(count: number): readonly LogEnvelope[] {
  const result: LogEnvelope[] = [];
  for (let i = 1; i <= count; i++) {
    result.push({
      v: 1,
      id: `env-${i}`,
      room: "room-d4",
      seq: i,
      ts: new Date().toISOString(),
      sender: { id: "writer", role: "communicator", host: "antigravity" },
      kind: "message",
      text: `Message content ${i}`,
      key_fingerprint: "fp-test",
      sig: "sig-test",
    });
  }
  return result;
}

describe("Defect D4: cursor is strictly per reader, never per mailbox or room", () => {
  it("enforces that readerCursorPath requires readerId and rejects invalid identity", () => {
    expect(() => readerCursorPath("room-d4", "")).toThrow();
    const path = readerCursorPath("room-d4", "agent-bob");
    expect(path.endsWith("/readers/agent-bob.cursor.json")).toBe(true);
  });

  it("drains a room concurrently across 10 readers with no room-root cursor.json created", async () => {
    const vfs = new ChatVirtualFS();
    const roomRoot = roomDir("room-d4");
    vfs.mkdirSync(`${roomRoot}/readers`, { recursive: true });
    vfs.mkdirSync(`${roomRoot}/log`, { recursive: true });

    const totalMessages = 10;
    const messages = generateTestMessages(totalMessages);
    const readerIds = Array.from({ length: 10 }, (_, i) => `reader-${i}`);

    await Promise.all(
      readerIds.map(async (readerId) => {
        let cursor = createInitialCursor("room-d4", readerId);
        const cursorFile = readerCursorPath("room-d4", readerId);
        vfs.writeFileSync(cursorFile, JSON.stringify(cursor));

        const leased = leaseNext(cursor, messages, 50);
        expect(leased.messages).toHaveLength(totalMessages);
        expect(leased.leaseId).toBeDefined();

        if (leased.leaseId) {
          cursor = ackLease(leased.cursor, leased.leaseId, totalMessages, {
            kind: "explicit",
            at: new Date().toISOString(),
          });
        }
        expect(cursor.contiguous_seq).toBe(totalMessages);
        vfs.writeFileSync(cursorFile, JSON.stringify(cursor));
      }),
    );

    const roomEntries = vfs.readdirSync(roomRoot);
    expect(roomEntries).not.toContain("cursor.json");

    const readerEntries = vfs.readdirSync(`${roomRoot}/readers`);
    expect(readerEntries).toHaveLength(10);
    for (const readerId of readerIds) {
      expect(readerEntries).toContain(`${readerId}.cursor.json`);
      const raw = vfs.readFileSync(readerCursorPath("room-d4", readerId), "utf-8") as string;
      const parsed = JSON.parse(raw) as {
        contiguous_seq: number;
        reader: string;
      };
      expect(parsed.reader).toBe(readerId);
      expect(parsed.contiguous_seq).toBe(totalMessages);
    }
  });
});
