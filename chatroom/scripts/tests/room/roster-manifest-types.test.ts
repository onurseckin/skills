import { describe, expect, it } from "bun:test";
import {
  isMemberRecord,
  isRoomManifest,
  isRoomSettings,
  type MemberRecord,
  type RoomManifest,
} from "../../src/core/index.ts";
import {
  addMember,
  assertMember,
  createDefaultRoomSettings,
  DEFAULT_ROOM_SETTINGS,
  listMembers,
  resolveMention,
  type AddMemberInput,
  type RosterOptions,
} from "../../src/room/index.ts";
import { ChatVirtualFS } from "../../src/testing/virtual-fs/index.ts";

function createRosterOptions(vfs: ChatVirtualFS, roomDir: string): RosterOptions {
  return {
    roomDir,
    readFile: (p: string) => {
      try {
        return vfs.readFileSync(p, "utf-8");
      } catch {
        return undefined;
      }
    },
    writeFile: (p: string, c: string) => {
      vfs.writeFileSync(p, c);
    },
    exists: (p: string) => vfs.existsSync(p),
    readdir: (p: string) => {
      try {
        return vfs.readdirSync(p);
      } catch {
        return [];
      }
    },
    mkdir: (p: string) => {
      vfs.mkdirSync(p, { recursive: true });
    },
  };
}

describe("RoomManifest and MemberRecord canonical types", () => {
  it("validates canonical RoomSettings with guard", () => {
    expect(isRoomSettings(DEFAULT_ROOM_SETTINGS)).toBe(true);
    const customSettings = createDefaultRoomSettings({ lease_ttl_ms: 60000 });
    expect(customSettings.lease_ttl_ms).toBe(60000);
    expect(isRoomSettings(customSettings)).toBe(true);
  });

  it("validates canonical RoomManifest contract", () => {
    const manifest: RoomManifest = {
      v: 1,
      id: "room-test",
      title: "Test Room",
      visibility: "public",
      key_fingerprint: "fp-123",
      created_at: new Date().toISOString(),
      created_by: "agent-admin",
      settings: DEFAULT_ROOM_SETTINGS,
    };
    expect(isRoomManifest(manifest)).toBe(true);
    expect(manifest.v).toBe(1);
    expect(manifest.visibility).toBe("public");
    const invalidV: Record<string, unknown> = { ...manifest, v: 2 };
    expect(isRoomManifest(invalidV)).toBe(false);
    const missingSettings: Record<string, unknown> = { ...manifest, settings: undefined };
    expect(isRoomManifest(missingSettings)).toBe(false);
  });

  it("addMember populates non-optional fields of canonical MemberRecord", () => {
    const vfs = new ChatVirtualFS();
    const roomDir = "/virtual/rooms/room-alpha";
    const options = createRosterOptions(vfs, roomDir);

    const input: AddMemberInput = {
      id: "member-one",
    };

    const record = addMember("room-alpha", input, options);
    expect(record.v).toBe(1);
    expect(record.id).toBe("member-one");
    expect(record.display_name).toBe("member-one");
    expect(record.key_fingerprint).toBe("");
    expect(record.aliases).toEqual([]);
    expect(record.role).toBe("communicator");
    expect(record.host).toBe("local");
    expect(typeof record.key_fingerprint).toBe("string");
    expect(typeof record.joined_at).toBe("string");

    const storedRaw = vfs.readFileSync(`${roomDir}/members/member-one.json`, "utf-8");
    const storedParsed = JSON.parse(storedRaw) as MemberRecord;
    expect(storedParsed.display_name).toBe("member-one");
    expect(storedParsed.key_fingerprint).toBe("");
    expect(storedParsed.aliases).toEqual([]);
  });

  it("addMember preserves custom display_name, aliases, and key_fingerprint", () => {
    const vfs = new ChatVirtualFS();
    const roomDir = "/virtual/rooms/room-alpha";
    const options = createRosterOptions(vfs, roomDir);

    const input: AddMemberInput = {
      id: "member-two",
      display_name: "Agent Two",
      key_fingerprint: "fp-agent-2",
      aliases: ["two", "agent2"],
      role: "lead",
      host: "cluster-1",
    };

    const record = addMember("room-alpha", input, options);
    expect(record.display_name).toBe("Agent Two");
    expect(record.key_fingerprint).toBe("fp-agent-2");
    expect(record.aliases).toEqual(["two", "agent2"]);
    expect(record.role).toBe("lead");
    expect(record.host).toBe("cluster-1");
    expect(isMemberRecord(record)).toBe(true);
  });

  it("assertMember parses member file with fallbacks and validates MemberRecord", () => {
    const vfs = new ChatVirtualFS();
    const roomDir = "/virtual/rooms/room-beta";
    const options = createRosterOptions(vfs, roomDir);

    vfs.mkdirSync(`${roomDir}/members`, { recursive: true });
    vfs.writeFileSync(
      `${roomDir}/members/agent-minimal.json`,
      JSON.stringify({
        id: "agent-minimal",
      }),
    );

    const identity = { id: "agent-minimal", source: "cli" };
    const member = assertMember("room-beta", identity, options);
    expect(member.v).toBe(1);
    expect(member.id).toBe("agent-minimal");
    expect(member.display_name).toBe("agent-minimal");
    expect(member.key_fingerprint).toBe("");
    expect(member.aliases).toEqual([]);
    expect(member.role).toBe("communicator");
    expect(member.host).toBe("local");
  });

  it("assertMember accepts both argument orders (room, identity) and (identity, room)", () => {
    const vfs = new ChatVirtualFS();
    const roomDir = "/virtual/rooms/room-gamma";
    const options = createRosterOptions(vfs, roomDir);

    const memberInput: AddMemberInput = { id: "agent-worker" };
    addMember("room-gamma", memberInput, options);

    const identity = { id: "agent-worker", source: "cli" };
    const res1 = assertMember("room-gamma", identity, options);
    const res2 = assertMember(identity, "room-gamma", options);
    expect(res1.id).toBe("agent-worker");
    expect(res2.id).toBe("agent-worker");
  });

  it("assertMember throws INVALID_IDENTITY when identity is invalid", () => {
    const vfs = new ChatVirtualFS();
    const roomDir = "/virtual/rooms/room-delta";
    const options = createRosterOptions(vfs, roomDir);

    expect(() => {
      assertMember("room-delta", { id: "" }, options);
    }).toThrow();
  });

  it("extractIdentityAndRoom rejects two RoomManifests", () => {
    const vfs = new ChatVirtualFS();
    const roomDir = "/virtual/rooms/room-delta";
    const options = createRosterOptions(vfs, roomDir);

    const manifest: RoomManifest = {
      v: 1,
      id: "room-manifest-1",
      title: "Title",
      visibility: "public",
      key_fingerprint: "",
      created_at: "",
      created_by: "",
      settings: DEFAULT_ROOM_SETTINGS,
    };

    expect(() => {
      assertMember(manifest, manifest, options);
    }).toThrow();
  });

  it("resolveMention finds members by direct id and aliases", () => {
    const vfs = new ChatVirtualFS();
    const roomDir = "/virtual/rooms/room-epsilon";
    const options = createRosterOptions(vfs, roomDir);

    addMember(
      "room-epsilon",
      {
        id: "charlie",
        display_name: "Charlie Brown",
        aliases: ["chuck"],
      },
      options,
    );

    const byId = resolveMention("room-epsilon", "@charlie", options);
    expect(byId.id).toBe("charlie");

    const byAlias = resolveMention("@chuck", "room-epsilon", options);
    expect(byAlias.id).toBe("charlie");
  });

  it("listMembers returns sorted MemberRecord list with canonical fields", () => {
    const vfs = new ChatVirtualFS();
    const roomDir = "/virtual/rooms/room-zeta";
    const options = createRosterOptions(vfs, roomDir);

    addMember("room-zeta", { id: "bravo", key_fingerprint: "fp-bravo" }, options);
    addMember("room-zeta", { id: "alpha", key_fingerprint: "fp-alpha" }, options);

    const list = listMembers("room-zeta", options);
    expect(list.length).toBe(2);
    expect(list[0]?.id).toBe("alpha");
    expect(list[1]?.id).toBe("bravo");
    expect(list.every((m) => isMemberRecord(m))).toBe(true);
  });
});
