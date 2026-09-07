import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { type VirtualMemoryFS } from "../../olt/scripts/src/testing/virtual-fs/index.ts";
import { addMember } from "../../chatroom/scripts/src/room/index.ts";
import {
  formatConfirmationPreview,
  getConfirmationPreview,
  isInviteRecord,
  mintInvite,
  parseInviteUri,
} from "../../chatroom/scripts/src/handshake/index.ts";
import { joinCommand } from "../../chatroom/scripts/src/cli/commands/lifecycle/join.ts";
import { initCommand } from "../../chatroom/scripts/src/cli/commands/lifecycle/init.ts";
import { doctorCommand } from "../../chatroom/scripts/src/cli/commands/doctor.ts";
import { cleanupVirtualChatroomFS, createTestRoom, setupVirtualChatroomFS } from "./helpers.ts";

let vfs: VirtualMemoryFS;

beforeEach(() => {
  const ctx = setupVirtualChatroomFS();
  vfs = ctx.vfs;
});

afterEach(() => {
  cleanupVirtualChatroomFS();
});

describe("handshake atomicity and durable membership", () => {
  it("creates member record and increments member count on valid join", async () => {
    const room = "atomicity-valid-room";
    const host = "alice";
    const joiner = "bob";

    createTestRoom({
      id: room,
      title: "Atomicity Valid Room",
      visibility: "keyed",
      createdBy: host,
    });
    addMember(room, {
      id: host,
      role: "agent",
      host: "antigravity",
    });

    const docInitial = await doctorCommand({ room });
    expect(docInitial.rooms[0]?.members.length).toBe(1);

    const inviteUri = mintInvite(room, host, 3600);
    const parsed = parseInviteUri(inviteUri);
    const invitePath = `/virtual/chatroom/rooms/${room}/handshake/invites/${parsed.code}.json`;
    const consumedPath = `/virtual/chatroom/rooms/${room}/handshake/consumed/${parsed.code}.json`;
    const memberPath = `/virtual/chatroom/rooms/${room}/members/${joiner}.json`;

    expect(vfs.existsSync(invitePath)).toBe(true);
    expect(vfs.existsSync(consumedPath)).toBe(false);
    expect(vfs.existsSync(memberPath)).toBe(false);

    const joinResult = await joinCommand(
      {
        invite: inviteUri,
        as: joiner,
        yes: true,
        brief: "recovery instructions for joiner",
      },
      {},
      [],
    );

    expect(joinResult["joined"]).toBe(true);
    expect(vfs.existsSync(memberPath)).toBe(true);
    expect(vfs.existsSync(invitePath)).toBe(false);
    expect(vfs.existsSync(consumedPath)).toBe(true);

    const docAfter = await doctorCommand({ room });
    expect(docAfter.rooms[0]?.members.length).toBe(2);
    expect(docAfter.rooms[0]?.members).toContain(host);
    expect(docAfter.rooms[0]?.members).toContain(joiner);
    expect(docAfter.markdown).toContain("- **Members**: `2`");
  });

  it("leaves invite intact and consumable when member write fails", async () => {
    const room = "atomicity-fault-room";
    const host = "alice";
    const joiner = "bob";

    createTestRoom({
      id: room,
      title: "Atomicity Fault Room",
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

    expect(vfs.existsSync(invitePath)).toBe(true);

    let thrownError: Error | null = null;
    try {
      await joinCommand(
        {
          invite: inviteUri,
          as: joiner,
          yes: true,
          brief: "recovery instructions for joiner",
          writeFile: () => {
            throw new Error("simulated disk full failure");
          },
        },
        {},
        [],
      );
    } catch (error: unknown) {
      thrownError = error as Error;
    }

    expect(thrownError).not.toBeNull();
    expect(thrownError?.message).toContain("simulated disk full failure");
    expect(thrownError?.message).toContain(parsed.code);
    expect(thrownError?.message).toContain("preserved (unconsumed)");

    expect(vfs.existsSync(memberPath)).toBe(false);
    expect(vfs.existsSync(invitePath)).toBe(true);
    expect(vfs.existsSync(consumedPath)).toBe(false);

    const docMid = await doctorCommand({ room });
    expect(docMid.rooms[0]?.members.length).toBe(1);

    const successfulJoin = await joinCommand(
      {
        invite: inviteUri,
        as: joiner,
        yes: true,
        brief: "recovery instructions for joiner",
      },
      {},
      [],
    );

    expect(successfulJoin["joined"]).toBe(true);
    expect(vfs.existsSync(memberPath)).toBe(true);
    expect(vfs.existsSync(invitePath)).toBe(false);
    expect(vfs.existsSync(consumedPath)).toBe(true);

    const docFinal = await doctorCommand({ room });
    expect(docFinal.rooms[0]?.members.length).toBe(2);
    expect(docFinal.rooms[0]?.members).toContain(joiner);
  });

  it("creates member record and consumes invite on init with invite", async () => {
    const room = "atomicity-init-valid";
    const host = "alice";
    const joiner = "bob";

    createTestRoom({
      id: room,
      title: "Atomicity Init Valid",
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

    const initResult = await initCommand(
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

    expect(initResult["room"]).toBe(room);
    expect(initResult["as"]).toBe(joiner);
    expect(vfs.existsSync(memberPath)).toBe(true);
    expect(vfs.existsSync(invitePath)).toBe(false);
    expect(vfs.existsSync(consumedPath)).toBe(true);

    const docAfter = await doctorCommand({ room });
    expect(docAfter.rooms[0]?.members.length).toBe(2);
  });

  it("leaves invite consumable when init member write fails", async () => {
    const room = "atomicity-init-fault";
    const host = "alice";
    const joiner = "bob";

    createTestRoom({
      id: room,
      title: "Atomicity Init Fault",
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

    let thrownError: Error | null = null;
    try {
      await initCommand(
        {
          invite: inviteUri,
          as: joiner,
          repo: "/virtual/repo",
          "no-agent": true,
          "no-daemon": true,
          writeFile: () => {
            throw new Error("simulated init write error");
          },
        },
        {},
        [],
      );
    } catch (error: unknown) {
      thrownError = error as Error;
    }

    expect(thrownError).not.toBeNull();
    expect(thrownError?.message).toContain("simulated init write error");
    expect(thrownError?.message).toContain(parsed.code);
    expect(thrownError?.message).toContain("preserved (unconsumed)");

    expect(vfs.existsSync(memberPath)).toBe(false);
    expect(vfs.existsSync(invitePath)).toBe(true);
    expect(vfs.existsSync(consumedPath)).toBe(false);

    const docMid = await doctorCommand({ room });
    expect(docMid.rooms[0]?.members.length).toBe(1);

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
    expect(vfs.existsSync(memberPath)).toBe(true);
    expect(vfs.existsSync(invitePath)).toBe(false);
    expect(vfs.existsSync(consumedPath)).toBe(true);

    const docFinal = await doctorCommand({ room });
    expect(docFinal.rooms[0]?.members.length).toBe(2);
  });

  it("validates invite records and detects corruption with isInviteRecord", () => {
    const valid = {
      code: "ABC",
      created_at: new Date().toISOString(),
      created_by: "alice",
      expires_at: new Date(Date.now() + 60000).toISOString(),
      uses_remaining: 1,
      wrapped_key: "deadbeef",
    };
    expect(isInviteRecord(valid)).toBe(true);
    expect(isInviteRecord(null)).toBe(false);
    expect(isInviteRecord("string")).toBe(false);
    expect(isInviteRecord({ ...valid, expires_at: "not-a-date" })).toBe(false);
    expect(isInviteRecord({ ...valid, uses_remaining: NaN })).toBe(false);
    expect(isInviteRecord({ ...valid, wrapped_key: 123 })).toBe(false);
  });

  it("retrieves and formats confirmation preview correctly", () => {
    const room = "preview-room";
    const host = "alice";
    createTestRoom({
      id: room,
      title: "Preview Room Title",
      visibility: "keyed",
      createdBy: host,
    });
    addMember(room, {
      id: host,
      role: "agent",
      host: "antigravity",
    });

    const preview = getConfirmationPreview(room);
    expect(preview.roomId).toBe(room);
    expect(preview.roomTitle).toBe("Preview Room Title");
    expect(preview.memberList).toContain(host);
    expect(preview.messageCount).toBe(0);

    const formatted = formatConfirmationPreview(preview);
    expect(formatted).toContain("Preview Room Title");
    expect(formatted).toContain(host);
  });

  it("fails closed when invite record on disk is corrupted", async () => {
    const room = "corrupt-invite-room";
    const host = "alice";
    const joiner = "bob";
    createTestRoom({
      id: room,
      title: "Corrupt Room",
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

    vfs.writeFileSync(invitePath, JSON.stringify({ invalid: true }));

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
  });
});
