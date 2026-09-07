import { describe, expect, it } from "bun:test";
import { join, resolve } from "node:path";
import { main } from "../../../../index.ts";

const mockFs = await import("node:fs");
const mockOs = await import("node:os");

describe("Sandbox Containment Guard", () => {
  it("ensures no orphan directories exist in live user rooms directory", () => {
    const liveRoomsDir = join(mockOs.homedir(), ".agents", "chatroom", "rooms");
    const orphanRooms = ["default", "integ-room", "room-1", "test-room"];
    for (const orphan of orphanRooms) {
      expect(mockFs.existsSync(join(liveRoomsDir, orphan))).toBe(false);
    }
  });

  it("ensures no undefined directory exists in chatroom/scripts or repository root", () => {
    const scriptsUndefined = resolve(import.meta.dir, "../../../undefined");
    const repoRootUndefined = resolve(import.meta.dir, "../../../../../undefined");
    expect(mockFs.existsSync(scriptsUndefined)).toBe(false);
    expect(mockFs.existsSync(repoRootUndefined)).toBe(false);
  });

  it("ensures running CLI commands with isolated CHATROOM_HOME writes only inside CHATROOM_HOME and never leaks to homedir", async () => {
    const liveRoomsDir = join(mockOs.homedir(), ".agents", "chatroom", "rooms");
    const liveEntriesBefore = mockFs.existsSync(liveRoomsDir)
      ? mockFs.readdirSync(liveRoomsDir)
      : [];

    const tempDir = mockFs.mkdtempSync(join(mockOs.tmpdir(), "chat-containment-"));
    const prevHome = process.env.CHATROOM_HOME;
    process.env.CHATROOM_HOME = tempDir;

    const originalWrite = process.stdout.write;
    process.stdout.write = (): boolean => true;

    try {
      await main([
        "chat:init",
        "--room",
        "sandbox-guard-room",
        "--as",
        "agent-guard",
        "--title",
        "Sandbox Guard Room",
        "--repo",
        tempDir,
        "--json",
      ]);

      await main(["chat:rooms", "--mine", "--json"]);

      await main([
        "chat:say",
        "--room",
        "sandbox-guard-room",
        "--as",
        "agent-guard",
        "--text",
        "Containment check verified",
        "--json",
      ]);

      const isolatedRoomDir = join(tempDir, "rooms", "sandbox-guard-room");
      expect(mockFs.existsSync(isolatedRoomDir)).toBe(true);
      expect(mockFs.existsSync(join(isolatedRoomDir, "room.json"))).toBe(true);
      expect(mockFs.existsSync(join(isolatedRoomDir, "log"))).toBe(true);

      expect(mockFs.existsSync(join(liveRoomsDir, "sandbox-guard-room"))).toBe(false);

      const liveEntriesAfter = mockFs.existsSync(liveRoomsDir)
        ? mockFs.readdirSync(liveRoomsDir)
        : [];
      expect(liveEntriesAfter.sort()).toEqual(liveEntriesBefore.sort());
    } finally {
      process.stdout.write = originalWrite;
      if (prevHome === undefined) {
        delete process.env.CHATROOM_HOME;
      } else {
        process.env.CHATROOM_HOME = prevHome;
      }
      if (mockFs.existsSync(tempDir)) {
        mockFs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  });
});
