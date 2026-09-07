import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  type VirtualFSSession,
  type VirtualMemoryFS,
} from "../../olt/scripts/src/testing/virtual-fs/index.ts";
import { addMember } from "../../chatroom/scripts/src/room/index.ts";
import { mintInvite, parseInviteUri } from "../../chatroom/scripts/src/handshake/index.ts";
import { joinCommand } from "../../chatroom/scripts/src/cli/commands/lifecycle/join.ts";
import { initCommand } from "../../chatroom/scripts/src/cli/commands/lifecycle/init.ts";
import { doctorCommand } from "../../chatroom/scripts/src/cli/commands/doctor.ts";
import { cleanupVirtualChatroomFS, createTestRoom, setupVirtualChatroomFS } from "./helpers.ts";

let vfs: VirtualMemoryFS;
let session: VirtualFSSession;

beforeEach(() => {
  const ctx = setupVirtualChatroomFS();
  vfs = ctx.vfs;
  session = ctx.session;
});

afterEach(() => {
  cleanupVirtualChatroomFS();
});

describe("handshake join key atomicity", () => {
  it("leaves invite unconsumed when key write throws due to read-only keys dir during join", async () => {
    const room = "key-readonly-join-room";
    const host = "alice";
    const joiner = "bob";

    createTestRoom({
      id: room,
      title: "Key Readonly Join Room",
      visibility: "keyed",
      createdBy: host,
    });
    addMember(room, {
      id: host,
      role: "agent",
      host: "antigravity",
    });

    const inviteUri = mintInvite(room, host, 3600);
    const parsed = parseInviteUri(inviteUri);
    const invitePath = `/virtual/chatroom/rooms/${room}/handshake/invites/${parsed.code}.json`;
    const consumedPath = `/virtual/chatroom/rooms/${room}/handshake/consumed/${parsed.code}.json`;
    const memberPath = `/virtual/chatroom/rooms/${room}/members/${joiner}.json`;
    const keyPath = `/virtual/chatroom/keys/${room}.key`;
    const keysDir = "/virtual/chatroom/keys";

    if (vfs.existsSync(keyPath)) {
      vfs.unlinkSync(keyPath);
    }
    expect(vfs.existsSync(keyPath)).toBe(false);
    expect(vfs.existsSync(invitePath)).toBe(true);

    session.chmodSync(keysDir, 0o555);

    let thrownError: Error | null = null;
    try {
      await joinCommand(
        {
          invite: inviteUri,
          as: joiner,
          yes: true,
        },
        {},
        [],
      );
    } catch (error: unknown) {
      thrownError = error as Error;
    }

    expect(thrownError).not.toBeNull();
    expect(thrownError?.message).toContain("permission denied");
    expect(thrownError?.message).toContain(parsed.code);
    expect(thrownError?.message).toContain("preserved (unconsumed)");

    expect(vfs.existsSync(keyPath)).toBe(false);
    expect(vfs.existsSync(memberPath)).toBe(false);
    expect(vfs.existsSync(invitePath)).toBe(true);
    expect(vfs.existsSync(consumedPath)).toBe(false);

    const inviteData = JSON.parse(vfs.readFileSync(invitePath, "utf8")) as {
      readonly uses_remaining: number;
    };
    expect(inviteData.uses_remaining).toBe(1);

    const docMid = await doctorCommand({ room });
    expect(docMid.rooms[0]?.members.length).toBe(1);

    session.chmodSync(keysDir, 0o755);

    const successfulJoin = await joinCommand(
      {
        invite: inviteUri,
        as: joiner,
        yes: true,
        brief: "Recovery brief: testing join key atomicity",
      },
      {},
      [],
    );

    expect(successfulJoin["joined"]).toBe(true);
    expect(vfs.existsSync(keyPath)).toBe(true);
    expect(vfs.existsSync(memberPath)).toBe(true);
    expect(vfs.existsSync(invitePath)).toBe(false);
    expect(vfs.existsSync(consumedPath)).toBe(true);

    const consumedData = JSON.parse(vfs.readFileSync(consumedPath, "utf8")) as {
      readonly uses_remaining: number;
      readonly consumed_by: string;
    };
    expect(consumedData.uses_remaining).toBe(0);
    expect(consumedData.consumed_by).toBe(joiner);

    const docFinal = await doctorCommand({ room });
    expect(docFinal.rooms[0]?.members.length).toBe(2);
    expect(docFinal.rooms[0]?.members).toContain(joiner);
  });

  it("leaves invite unconsumed when keys directory is blocked by a file during join", async () => {
    const room = "key-blocked-join-room";
    const host = "alice";
    const joiner = "bob";

    createTestRoom({
      id: room,
      title: "Key Blocked Join Room",
      visibility: "keyed",
      createdBy: host,
    });
    addMember(room, {
      id: host,
      role: "agent",
      host: "antigravity",
    });

    const inviteUri = mintInvite(room, host, 3600);
    const parsed = parseInviteUri(inviteUri);
    const invitePath = `/virtual/chatroom/rooms/${room}/handshake/invites/${parsed.code}.json`;
    const consumedPath = `/virtual/chatroom/rooms/${room}/handshake/consumed/${parsed.code}.json`;
    const memberPath = `/virtual/chatroom/rooms/${room}/members/${joiner}.json`;
    const keyPath = `/virtual/chatroom/keys/${room}.key`;
    const keysDir = "/virtual/chatroom/keys";

    if (vfs.existsSync(keysDir)) {
      vfs.rmSync(keysDir, { recursive: true });
    }
    vfs.writeFileSync(keysDir, "blocking-file-not-a-directory");

    let thrownError: Error | null = null;
    try {
      await joinCommand(
        {
          invite: inviteUri,
          as: joiner,
          yes: true,
        },
        {},
        [],
      );
    } catch (error: unknown) {
      thrownError = error as Error;
    }

    expect(thrownError).not.toBeNull();
    expect(thrownError?.message).toContain("preserved (unconsumed)");

    expect(vfs.existsSync(keyPath)).toBe(false);
    expect(vfs.existsSync(memberPath)).toBe(false);
    expect(vfs.existsSync(invitePath)).toBe(true);
    expect(vfs.existsSync(consumedPath)).toBe(false);

    const inviteData = JSON.parse(vfs.readFileSync(invitePath, "utf8")) as {
      readonly uses_remaining: number;
    };
    expect(inviteData.uses_remaining).toBe(1);

    vfs.unlinkSync(keysDir);

    const successfulJoin = await joinCommand(
      {
        invite: inviteUri,
        as: joiner,
        yes: true,
        brief: "Recovery brief: testing join key atomicity",
      },
      {},
      [],
    );

    expect(successfulJoin["joined"]).toBe(true);
    expect(vfs.existsSync(keyPath)).toBe(true);
    expect(vfs.existsSync(memberPath)).toBe(true);
    expect(vfs.existsSync(invitePath)).toBe(false);
    expect(vfs.existsSync(consumedPath)).toBe(true);

    const docFinal = await doctorCommand({ room });
    expect(docFinal.rooms[0]?.members.length).toBe(2);
    expect(docFinal.rooms[0]?.members).toContain(joiner);
  });

  it("leaves invite unconsumed when key write throws due to read-only keys dir during init", async () => {
    const room = "key-readonly-init-room";
    const host = "alice";
    const joiner = "bob";

    createTestRoom({
      id: room,
      title: "Key Readonly Init Room",
      visibility: "keyed",
      createdBy: host,
    });
    addMember(room, {
      id: host,
      role: "agent",
      host: "antigravity",
    });

    const inviteUri = mintInvite(room, host, 3600);
    const parsed = parseInviteUri(inviteUri);
    const invitePath = `/virtual/chatroom/rooms/${room}/handshake/invites/${parsed.code}.json`;
    const consumedPath = `/virtual/chatroom/rooms/${room}/handshake/consumed/${parsed.code}.json`;
    const memberPath = `/virtual/chatroom/rooms/${room}/members/${joiner}.json`;
    const keyPath = `/virtual/chatroom/keys/${room}.key`;
    const keysDir = "/virtual/chatroom/keys";

    if (vfs.existsSync(keyPath)) {
      vfs.unlinkSync(keyPath);
    }
    expect(vfs.existsSync(keyPath)).toBe(false);

    session.chmodSync(keysDir, 0o555);

    let thrownError: Error | null = null;
    try {
      await initCommand(
        {
          invite: inviteUri,
          as: joiner,
          repo: "/virtual/repo",
          "no-agent": true,
          "no-daemon": true,
        },
        {},
        [],
      );
    } catch (error: unknown) {
      thrownError = error as Error;
    }

    expect(thrownError).not.toBeNull();
    expect(thrownError?.message).toContain("permission denied");
    expect(thrownError?.message).toContain(parsed.code);
    expect(thrownError?.message).toContain("preserved (unconsumed)");

    expect(vfs.existsSync(keyPath)).toBe(false);
    expect(vfs.existsSync(memberPath)).toBe(false);
    expect(vfs.existsSync(invitePath)).toBe(true);
    expect(vfs.existsSync(consumedPath)).toBe(false);

    const inviteData = JSON.parse(vfs.readFileSync(invitePath, "utf8")) as {
      readonly uses_remaining: number;
    };
    expect(inviteData.uses_remaining).toBe(1);

    session.chmodSync(keysDir, 0o755);

    const successfulInit = await initCommand(
      {
        invite: inviteUri,
        as: joiner,
        repo: "/virtual/repo",
        "no-agent": true,
        "no-daemon": true,
      },
      {},
      [],
    );

    expect(successfulInit["room"]).toBe(room);
    expect(vfs.existsSync(keyPath)).toBe(true);
    expect(vfs.existsSync(memberPath)).toBe(true);
    expect(vfs.existsSync(invitePath)).toBe(false);
    expect(vfs.existsSync(consumedPath)).toBe(true);

    const docFinal = await doctorCommand({ room });
    expect(docFinal.rooms[0]?.members.length).toBe(2);
    expect(docFinal.rooms[0]?.members).toContain(joiner);
  });
});
