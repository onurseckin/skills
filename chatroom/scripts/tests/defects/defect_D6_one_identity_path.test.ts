import { describe, expect, it } from "bun:test";
import { readCommand, sayCommand } from "../../src/cli/commands/index.ts";
import { type MemberRecord, type RoomManifest } from "../../src/core/index.ts";
import { ChatError, resolveIdentity, type Identity } from "../../src/identity/index.ts";
import { assertMember, listMembers } from "../../src/room/index.ts";

function createRoomManifest(id: string): RoomManifest {
  return {
    v: 1,
    id,
    title: `Title of ${id}`,
    visibility: "keyed",
    key_fingerprint: "fp-test",
    created_at: new Date().toISOString(),
    created_by: "creator",
  };
}

describe("Defect D6: one identity path with strict send/read authorization equivalence", () => {
  it("ensures resolveIdentity throws IDENTITY_UNRESOLVED without fallback constant", () => {
    expect(() => resolveIdentity({ env: {}, cwd: "/nonexistent-repo" })).toThrow(ChatError);

    let caughtCode = "";
    try {
      resolveIdentity({ env: {}, cwd: "/nonexistent-repo" });
    } catch (err: unknown) {
      if (err instanceof ChatError) {
        caughtCode = err.code;
      }
    }
    expect(caughtCode).toBe("IDENTITY_UNRESOLVED");
  });

  it("ensures resolved identities always have verified: true", () => {
    const ident = resolveIdentity({ as: "agent-alice" });
    expect(ident.id).toBe("agent-alice");
    expect(ident.verified).toBe(true);
    expect(ident.source).toBe("explicit");
  });

  it("enforces symmetric authorization rejection across send and read command pipelines", async () => {
    const unauthorizedAgents = ["stranger-1", "rogue-agent", "unregistered-reader"];

    for (const agentId of unauthorizedAgents) {
      let sendErrorCode = "";
      try {
        await sayCommand({ room: "room-d6", as: agentId, text: "hello" }, {});
      } catch (err: unknown) {
        if (err instanceof ChatError) {
          sendErrorCode = err.code;
        }
      }

      let readErrorCode = "";
      try {
        await readCommand({ room: "room-d6", as: agentId, peek: true }, {});
      } catch (err: unknown) {
        if (err instanceof ChatError) {
          readErrorCode = err.code;
        }
      }

      expect(sendErrorCode).toBe("NOT_MEMBER");
      expect(readErrorCode).toBe("NOT_MEMBER");
      expect(sendErrorCode).toBe(readErrorCode);
    }
  });

  it("property test: send assertMember equals read listMembers membership across generated pairs", () => {
    const sampleIds = [
      "alpha",
      "beta",
      "gamma",
      "delta",
      "member-registered",
      "non-member-stranger",
      "rogue-agent",
      "observer",
    ];

    const registeredMembers: MemberRecord[] = [
      {
        v: 1,
        id: "alpha",
        role: "communicator",
        host: "local",
        joined_at: new Date().toISOString(),
      },
      {
        v: 1,
        id: "member-registered",
        role: "executor",
        host: "claude_code",
        joined_at: new Date().toISOString(),
        aliases: ["observer"],
      },
    ];

    const rosterMockOptions = {
      readdir: () => registeredMembers.map((m) => `${m.id}.json`),
      readFile: (p: string) => {
        const leaf = p.split("/").pop()?.replace(".json", "");
        const member = registeredMembers.find((m) => m.id === leaf);
        return member ? JSON.stringify(member) : undefined;
      },
      exists: (p: string) => {
        if (p.endsWith("/members") || p.endsWith("members")) return true;
        const leaf = p.split("/").pop()?.replace(".json", "");
        return registeredMembers.some((m) => m.id === leaf);
      },
    };

    const room = createRoomManifest("room-prop-test");
    const activeMembers = listMembers(room, rosterMockOptions);

    for (const testId of sampleIds) {
      const identity: Identity = {
        id: testId,
        role: "communicator",
        host: "local",
        source: "explicit",
        verified: true,
      };

      let sendAuthorized = false;
      try {
        assertMember(room, identity, rosterMockOptions);
        sendAuthorized = true;
      } catch {
        sendAuthorized = false;
      }

      const readAuthorized = activeMembers.some(
        (m) => m.id === testId || (m.aliases !== undefined && m.aliases.includes(testId)),
      );

      expect(sendAuthorized).toBe(readAuthorized);
    }
  });
});
