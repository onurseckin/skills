import { afterAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { readCommand, sayCommand } from "../../src/cli/commands/index.ts";
import {
  ChatError,
  type Envelope,
  type LogEnvelope,
  type MemberRecord,
} from "../../src/core/index.ts";
import type { AppendMessageInput } from "../../src/log/index.ts";
import * as logModule from "../../src/log/index.ts";
import * as roomModule from "../../src/room/index.ts";
import * as daemonModule from "../../src/daemon/index.ts";
import * as cursorModule from "../../src/cursor/index.ts";
import { ChatVirtualFS } from "../../src/testing/virtual-fs/index.ts";

describe("sayCommand and readCommand text resolution and validation", () => {
  const vfs = new ChatVirtualFS();

  let capturedAppendInput: AppendMessageInput | undefined;

  const assertMemberSpy = spyOn(roomModule, "assertMember").mockImplementation(
    (_room, identity): MemberRecord => ({
      v: 1,
      id: typeof identity === "string" ? identity : identity.id,
      role: "communicator",
      host: "local",
      joined_at: new Date().toISOString(),
    }),
  );

  const ensureDaemonSpy = spyOn(daemonModule, "ensureDaemon").mockImplementation(() => ({
    status: "running",
    healthy: true,
    probedMs: 0,
  }));

  const appendMessageSpy = spyOn(logModule, "appendMessage").mockImplementation(
    (roomId: string, msg: AppendMessageInput): Envelope => {
      capturedAppendInput = msg;
      return {
        v: 1,
        id: "msg-test-1",
        room: roomId,
        seq: 1,
        ts: new Date().toISOString(),
        sender: {
          id: msg.sender.id,
          role: msg.sender.role,
          host: msg.sender.host,
        },
        kind: msg.kind,
        mentions: msg.mentions ?? [],
        reply_to: msg.reply_to ?? null,
        ...(msg.text !== undefined ? { text: msg.text } : {}),
        body: {
          schema: msg.body.schema,
          data: msg.body.data,
        },
        key_fingerprint: "fp-test",
        sig: "sig-test",
      };
    },
  );

  let mockLeaseResult: cursorModule.LeaseResult | undefined;
  const withReaderLockSpy = spyOn(cursorModule, "withReaderLock").mockImplementation(
    (): cursorModule.LeaseResult =>
      mockLeaseResult ?? {
        leaseId: null,
        cursor: {
          v: 1,
          room: "test-room",
          reader: "agent-1",
          contiguous_seq: 0,
          held: [],
          acked_above: [],
          last_ack_at: new Date().toISOString(),
          checksum: "sha256:init",
        },
        messages: [],
      },
  );

  beforeEach(() => {
    vfs.reset();
    capturedAppendInput = undefined;
    mockLeaseResult = undefined;
  });

  afterAll(() => {
    assertMemberSpy.mockRestore();
    ensureDaemonSpy.mockRestore();
    appendMessageSpy.mockRestore();
    withReaderLockSpy.mockRestore();
  });

  it("sending via sayCommand with payload containing { text: 'hello' } results in an envelope with text === 'hello'", async () => {
    let capturedOutput = "";
    const originalWrite = process.stdout.write;
    process.stdout.write = (chunk: string | Uint8Array): boolean => {
      capturedOutput += typeof chunk === "string" ? chunk : chunk.toString();
      return true;
    };

    let result: Record<string, unknown>;
    try {
      result = await sayCommand(
        {
          room: "test-room",
          as: "agent-1",
          payload: JSON.stringify({ text: "hello" }),
        },
        {},
        [],
      );
    } finally {
      process.stdout.write = originalWrite;
    }

    expect(capturedAppendInput).toBeDefined();
    expect(capturedAppendInput?.text).toBe("hello");

    const envelope = result["envelope"] as LogEnvelope;
    expect(envelope).toBeDefined();
    expect(envelope.text).toBe("hello");
    expect(capturedOutput).toContain("Message 1 sent (id: msg-test-1)");
  });

  it("reading an envelope that only has body.data.text outputs the display text correctly", async () => {
    mockLeaseResult = {
      leaseId: "lease-100",
      cursor: {
        v: 1,
        room: "test-room",
        reader: "agent-1",
        contiguous_seq: 1,
        held: [],
        acked_above: [],
        last_ack_at: new Date().toISOString(),
        checksum: "sha256:abc",
      },
      messages: [
        {
          v: 1,
          id: "env-lease-1",
          room: "test-room",
          seq: 1,
          ts: new Date().toISOString(),
          sender: { id: "agent-3", role: "communicator", host: "local" },
          kind: "message",
          body: {
            schema: "chatroom.text.v1",
            data: { text: "leased body content" },
          },
          key_fingerprint: "fp-test",
          sig: "sig-test",
        },
      ],
    };

    let capturedLeaseOutput = "";
    const originalWrite = process.stdout.write;
    process.stdout.write = (chunk: string | Uint8Array): boolean => {
      capturedLeaseOutput += typeof chunk === "string" ? chunk : chunk.toString();
      return true;
    };

    try {
      await readCommand({ room: "test-room", as: "agent-1" }, {}, []);
    } finally {
      process.stdout.write = originalWrite;
    }

    expect(capturedLeaseOutput).toContain("Lease: lease-100 (1 messages)");
    expect(capturedLeaseOutput).toContain("[1] <agent-3> leased body content");
  });

  it("reading an envelope of kind 'message' with no text throws ChatError with code INVALID_STATE", async () => {
    mockLeaseResult = {
      leaseId: "lease-100",
      cursor: {
        v: 1,
        room: "test-room",
        reader: "agent-1",
        contiguous_seq: 1,
        held: [],
        acked_above: [],
        last_ack_at: new Date().toISOString(),
        checksum: "sha256:abc",
      },
      messages: [
        {
          v: 1,
          id: "env-empty-1",
          room: "test-room",
          seq: 1,
          ts: new Date().toISOString(),
          sender: { id: "agent-2", role: "communicator", host: "local" },
          kind: "message",
          mentions: [],
          reply_to: null,
          body: {
            schema: "chatroom.text.v1",
            data: {},
          },
          key_fingerprint: "fp-test",
          sig: "sig-test",
        },
      ],
    };

    let caughtError: unknown;
    const originalWrite = process.stdout.write;
    process.stdout.write = (): boolean => true;
    try {
      await readCommand({ room: "test-room", as: "agent-1" }, {}, []);
    } catch (err: unknown) {
      caughtError = err;
    } finally {
      process.stdout.write = originalWrite;
    }

    expect(caughtError instanceof ChatError).toBe(true);
    expect((caughtError as ChatError).code).toBe("INVALID_STATE");
    expect((caughtError as ChatError).message).toContain(
      "Envelope env-empty-1 (seq 1) has empty displayable content",
    );

    mockLeaseResult = {
      leaseId: "lease-200",
      cursor: {
        v: 1,
        room: "test-room",
        reader: "agent-1",
        contiguous_seq: 1,
        held: [],
        acked_above: [],
        last_ack_at: new Date().toISOString(),
        checksum: "sha256:abc",
      },
      messages: [
        {
          v: 1,
          id: "env-empty-2",
          room: "test-room",
          seq: 2,
          ts: new Date().toISOString(),
          sender: { id: "agent-3", role: "communicator", host: "local" },
          kind: "message",
          body: {
            schema: "chatroom.text.v1",
            data: { text: "   " },
          },
          key_fingerprint: "fp-test",
          sig: "sig-test",
        },
      ],
    };

    let caughtLeaseError: unknown;
    process.stdout.write = (): boolean => true;
    try {
      await readCommand({ room: "test-room", as: "agent-1" }, {}, []);
    } catch (err: unknown) {
      caughtLeaseError = err;
    } finally {
      process.stdout.write = originalWrite;
    }

    expect(caughtLeaseError instanceof ChatError).toBe(true);
    expect((caughtLeaseError as ChatError).code).toBe("INVALID_STATE");
    expect((caughtLeaseError as ChatError).message).toContain(
      "Envelope env-empty-2 (seq 2) has empty displayable content",
    );
  });
});
