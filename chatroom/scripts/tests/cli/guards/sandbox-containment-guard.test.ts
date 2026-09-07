import { describe, expect, it } from "bun:test";
import { join, resolve } from "node:path";
import { main } from "../../../../index.ts";

const mockFs = await import("node:fs");
const mockOs = await import("node:os");

describe("Sandbox Containment Guard", () => {
  it("ensures no orphan directories exist in live user rooms directory", () => {
    const liveRoomsDir = join(mockOs.homedir(), ".agents", "chatroom", "rooms");
    if (!mockFs.existsSync(liveRoomsDir)) return;
    const entries = mockFs.readdirSync(liveRoomsDir);
    for (const entry of entries) {
      const fullPath = join(liveRoomsDir, entry);
      let isDir = false;
      try {
        isDir = mockFs.statSync(fullPath).isDirectory();
      } catch {
        continue;
      }
      if (!isDir) continue;

      const isTestRoom =
        entry.startsWith("test-") ||
        entry.startsWith("integ-") ||
        entry.startsWith("room-") ||
        entry.startsWith("sandbox-") ||
        entry === "default";
      expect(isTestRoom).toBe(false);

      const manifestPath = join(fullPath, "room.json");
      expect(mockFs.existsSync(manifestPath)).toBe(true);

      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(mockFs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
      } catch {
        parsed = null;
      }
      expect(parsed !== null && typeof parsed === "object").toBe(true);
      expect(parsed?.id).toBe(entry);
      expect(parsed?.v).toBe(1);
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

      await main(["chat:rooms", "--mine", "--as", "agent-guard", "--json"]);

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
