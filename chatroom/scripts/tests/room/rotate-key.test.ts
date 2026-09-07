import { describe, expect, it, spyOn } from "bun:test";
import { initCommand } from "../../src/cli/index.ts";
import { ChatError, type RoomManifest } from "../../src/core/index.ts";
import { computeFingerprint } from "../../src/crypto/index.ts";
import * as roomModule from "../../src/room/index.ts";
import {
  DEFAULT_ROOM_SETTINGS,
  rotateRoomKey,
  type RotateRoomKeyPorts,
} from "../../src/room/index.ts";
import { ChatVirtualFS } from "../../src/testing/virtual-fs/index.ts";

describe("rotateRoomKey and init --rotate-key behavior", () => {
  it("throws INVALID_ARGUMENT when rotateRoomKey is called on a public room", () => {
    const publicManifest: RoomManifest = {
      v: 1,
      id: "public-room-1",
      title: "Public Room 1",
      visibility: "public",
      key_fingerprint: "none",
      created_at: new Date().toISOString(),
      created_by: "agent-admin",
      settings: DEFAULT_ROOM_SETTINGS,
    };

    const ports: RotateRoomKeyPorts = {
      readManifest: (roomId: string): RoomManifest => {
        expect(roomId).toBe("public-room-1");
        return publicManifest;
      },
    };

    let caughtError: unknown;
    try {
      rotateRoomKey("public-room-1", ports);
    } catch (error: unknown) {
      caughtError = error;
    }

    expect(caughtError instanceof ChatError).toBe(true);
    const chatError = caughtError as ChatError;
    expect(chatError.code).toBe("INVALID_ARGUMENT");
    expect(chatError.message).toBe(
      "cannot rotate room key for public room 'public-room-1': public rooms have no secret key",
    );
  });

  it("rotates key on a keyed room, updates key_fingerprint in manifest, and returns new key", () => {
    const vfs = new ChatVirtualFS();
    const oldFingerprint = "sha256:old-fingerprint-12345678";
    let currentManifest: RoomManifest = {
      v: 1,
      id: "keyed-room-1",
      title: "Keyed Room 1",
      visibility: "keyed",
      key_fingerprint: oldFingerprint,
      created_at: new Date().toISOString(),
      created_by: "agent-admin",
      settings: DEFAULT_ROOM_SETTINGS,
    };

    let writtenManifest: RoomManifest | undefined;
    let writtenKeyPath = "";
    let writtenKeyContent = "";

    const ports: RotateRoomKeyPorts = {
      readManifest: (roomId: string): RoomManifest => {
        expect(roomId).toBe("keyed-room-1");
        return currentManifest;
      },
      writeManifest: (manifest: RoomManifest): void => {
        writtenManifest = manifest;
        currentManifest = manifest;
      },
      writeAtomic: (path: string, content: string): void => {
        writtenKeyPath = path;
        writtenKeyContent = content;
        vfs.writeFileSync(path, content);
      },
      mkdirSync: (path: string): void => {
        vfs.mkdirSync(path, { recursive: true });
      },
    };

    const newKey = rotateRoomKey("keyed-room-1", ports);

    expect(typeof newKey).toBe("string");
    expect(newKey.length).toBe(64);
    expect(/^[0-9a-f]{64}$/.test(newKey)).toBe(true);

    expect(writtenKeyContent).toBe(newKey);
    expect(writtenKeyPath.endsWith("keyed-room-1.key")).toBe(true);

    expect(writtenManifest).toBeDefined();
    if (writtenManifest !== undefined) {
      expect(writtenManifest.id).toBe("keyed-room-1");
      expect(writtenManifest.visibility).toBe("keyed");
      expect(writtenManifest.key_fingerprint).toBe(computeFingerprint(newKey));
      expect(writtenManifest.key_fingerprint).not.toBe(oldFingerprint);
    }

    expect(vfs.existsSync(writtenKeyPath)).toBe(true);
    expect(vfs.readFileSync(writtenKeyPath, "utf-8")).toBe(newKey);
  });

  it("fails with INVALID_ARGUMENT when calling init command with rotateKeyFlag on a public room without printing warning", async () => {
    const publicManifest: RoomManifest = {
      v: 1,
      id: "public-lounge",
      title: "Public Lounge",
      visibility: "public",
      key_fingerprint: "none",
      created_at: new Date().toISOString(),
      created_by: "agent-founder",
      settings: DEFAULT_ROOM_SETTINGS,
    };

    const existsSpy = spyOn(roomModule, "roomManifestExists").mockImplementation(
      (roomId: string): boolean => roomId === "public-lounge",
    );
    const readSpy = spyOn(roomModule, "readRoomManifest").mockImplementation(
      (roomId: string): RoomManifest => {
        if (roomId === "public-lounge") {
          return publicManifest;
        }
        throw new ChatError("UNKNOWN_ROOM", `Room '${roomId}' not found`);
      },
    );

    let stderrOutput = "";
    const origStderrWrite = process.stderr.write;
    process.stderr.write = (
      chunk: string | Uint8Array,
      encodingOrCb?: BufferEncoding | ((error?: Error | null) => void),
      cb?: (error?: Error | null) => void,
    ): boolean => {
      stderrOutput += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      if (typeof encodingOrCb === "function") {
        encodingOrCb();
      } else if (typeof cb === "function") {
        cb();
      }
      return true;
    };

    let caughtError: unknown;
    try {
      await initCommand(
        {
          room: "public-lounge",
          "rotate-key": true,
          "no-daemon": true,
          "no-agent": true,
        },
        {},
        [],
      );
    } catch (error: unknown) {
      caughtError = error;
    } finally {
      process.stderr.write = origStderrWrite;
      existsSpy.mockRestore();
      readSpy.mockRestore();
    }

    expect(caughtError instanceof ChatError).toBe(true);
    const chatError = caughtError as ChatError;
    expect(chatError.code).toBe("INVALID_ARGUMENT");
    expect(chatError.message).toContain(
      "cannot rotate room key for public room 'public-lounge': public rooms have no secret key",
    );
    expect(stderrOutput).toBe("");
    expect(stderrOutput.includes("invalidates outstanding invites")).toBe(false);
  });
});
