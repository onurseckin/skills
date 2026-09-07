import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { initCommand } from "../../chatroom/scripts/src/cli/commands/lifecycle/init.ts";
import { joinCommand } from "../../chatroom/scripts/src/cli/commands/lifecycle/join.ts";
import { readRoomManifest } from "../../chatroom/scripts/src/room/index.ts";
import { HandshakeError } from "../../chatroom/scripts/src/handshake/index.ts";
import {
  cleanupVirtualChatroomFS,
  setupVirtualChatroomFS,
  type VirtualChatroomContext,
} from "./helpers.ts";

let context: VirtualChatroomContext;

beforeEach(() => {
  context = setupVirtualChatroomFS();
});

afterEach(() => {
  cleanupVirtualChatroomFS();
});

describe("chat:init key idempotency and rotation", () => {
  it("preserves room key and allows invite minted before re-init to join", async () => {
    const room = "atomicity-probe";
    const initFirst = await initCommand(
      {
        room,
        "print-invite": true,
        "no-daemon": true,
        "no-agent": true,
        json: true,
      },
      {},
      [],
    );

    const inviteA = initFirst["invite"] as string;
    expect(typeof inviteA).toBe("string");
    expect(inviteA.length).toBeGreaterThan(0);

    const manifestBefore = readRoomManifest(room);
    const fingerprintBefore = manifestBefore.key_fingerprint;

    await initCommand(
      {
        room,
        "print-invite": true,
        "no-daemon": true,
        "no-agent": true,
        json: true,
      },
      {},
      [],
    );

    const manifestAfter = readRoomManifest(room);
    const fingerprintAfter = manifestAfter.key_fingerprint;

    expect(fingerprintAfter).toBe(fingerprintBefore);

    const joinResult = await joinCommand(
      {
        invite: inviteA,
        as: "bob-joiner",
        yes: true,
        json: true,
      },
      {},
      [],
    );

    expect(joinResult["joined"]).toBe(true);
    expect(joinResult["as"]).toBe("bob-joiner");
    expect(joinResult["room"]).toBe(room);

    const memberPath = `${context.homeDir}/rooms/${room}/members/bob-joiner.json`;
    expect(context.vfs.existsSync(memberPath)).toBe(true);
  });

  it("rotates room key and invalidates outstanding invites when --rotate-key is specified", async () => {
    const room = "rotation-probe";
    const initFirst = await initCommand(
      {
        room,
        "print-invite": true,
        "no-daemon": true,
        "no-agent": true,
        json: true,
      },
      {},
      [],
    );

    const inviteOld = initFirst["invite"] as string;
    const fingerprintBefore = readRoomManifest(room).key_fingerprint;

    const initRotated = await initCommand(
      {
        room,
        "rotate-key": true,
        "print-invite": true,
        "no-daemon": true,
        "no-agent": true,
        json: true,
      },
      {},
      [],
    );

    const inviteNew = initRotated["invite"] as string;
    const fingerprintAfter = readRoomManifest(room).key_fingerprint;

    expect(fingerprintAfter).not.toBe(fingerprintBefore);

    let caughtError: HandshakeError | null = null;
    try {
      await joinCommand(
        {
          invite: inviteOld,
          as: "joiner-old",
          yes: true,
          json: true,
        },
        {},
        [],
      );
    } catch (error: unknown) {
      if (error instanceof HandshakeError) {
        caughtError = error;
      }
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError?.code).toBe("WRONG_ROOM");

    const joinNew = await joinCommand(
      {
        invite: inviteNew,
        as: "joiner-new",
        yes: true,
        json: true,
      },
      {},
      [],
    );

    expect(joinNew["joined"]).toBe(true);
  });
});
