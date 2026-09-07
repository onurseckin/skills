import { describe, expect, it } from "bun:test";
import { type MemberRecord, type RoomManifest } from "../../src/core/index.ts";
import * as pathsModule from "../../src/core/index.ts";
import { createInitialCursor, leaseNext, type LogEnvelope } from "../../src/cursor/index.ts";
import { resolveMention } from "../../src/room/index.ts";
import { ChatVirtualFS } from "../../src/testing/virtual-fs/index.ts";

function createRoomManifest(id: string): RoomManifest {
  return {
    v: 1,
    id,
    title: `Room ${id}`,
    visibility: "keyed",
    key_fingerprint: "fp-test",
    created_at: new Date().toISOString(),
    created_by: "creator",
  };
}

describe("Defect D7: typo cannot misroute or create phantom mailboxes", () => {
  it("fails with UNKNOWN_MENTION and did-you-mean suggestion on typo", () => {
    const room = createRoomManifest("room-d7");
    const members: MemberRecord[] = [
      {
        v: 1,
        id: "alice",
        role: "communicator",
        host: "local",
        joined_at: new Date().toISOString(),
      },
      {
        v: 1,
        id: "bob",
        role: "communicator",
        host: "local",
        joined_at: new Date().toISOString(),
      },
    ];

    const rosterMockOptions = {
      readdir: () => members.map((m) => `${m.id}.json`),
      readFile: (p: string) => {
        const leaf = p.split("/").pop()?.replace(".json", "");
        const member = members.find((m) => m.id === leaf);
        return member ? JSON.stringify(member) : undefined;
      },
      exists: (p: string) => {
        if (p.endsWith("members") || p.endsWith("/members")) {
          return true;
        }
        const leaf = p.split("/").pop()?.replace(".json", "");
        return members.some((m) => m.id === leaf);
      },
    };

    let caughtError: unknown;
    try {
      resolveMention(room, "bbo", rosterMockOptions);
    } catch (err: unknown) {
      caughtError = err;
    }

    expect(caughtError).toBeDefined();
    const chatErr = caughtError as { code: string; message: string };
    expect(chatErr.code).toBe("UNKNOWN_MENTION");
    expect(chatErr.message.includes("did you mean @bob")).toBe(true);
  });

  it("creates zero files on disk when mention resolution fails", () => {
    const vfs = new ChatVirtualFS();
    vfs.mkdirSync("/rooms/room-d7/members", { recursive: true });
    vfs.writeFileSync(
      "/rooms/room-d7/members/alice.json",
      JSON.stringify({ v: 1, id: "alice", role: "communicator", host: "local" }),
    );

    const snapshotBefore = vfs.dumpTree();

    try {
      resolveMention(createRoomManifest("room-d7"), "nonexistent-agent", {
        readdir: (p: string) => vfs.readdirSync(p) as string[],
        readFile: (p: string) =>
          vfs.existsSync(p) ? (vfs.readFileSync(p, "utf-8") as string) : undefined,
        exists: (p: string) => vfs.existsSync(p),
      });
    } catch {}

    const snapshotAfter = vfs.dumpTree();
    expect(snapshotAfter).toEqual(snapshotBefore);
  });

  it("ensures cursor delivery to real members is unaffected by envelope mentions", () => {
    const cursor = createInitialCursor("room-d7", "bob");
    const messages: readonly LogEnvelope[] = [
      {
        v: 1,
        id: "env-1",
        room: "room-d7",
        seq: 1,
        ts: new Date().toISOString(),
        sender: { id: "alice", role: "communicator", host: "local" },
        kind: "message",
        mentions: ["carol"],
        text: "Hey carol",
        key_fingerprint: "fp",
        sig: "sig",
      },
    ];

    const leased = leaseNext(cursor, messages, 10);
    expect(leased.messages).toHaveLength(1);
    expect(leased.messages[0]?.seq).toBe(1);
  });

  it("verifies core/paths.ts has no function deriving path from a recipient string", () => {
    const exportedKeys = Object.keys(pathsModule);
    const recipientFns = exportedKeys.filter((k) => k.toLowerCase().includes("recipient"));
    expect(recipientFns).toHaveLength(0);
  });
});
