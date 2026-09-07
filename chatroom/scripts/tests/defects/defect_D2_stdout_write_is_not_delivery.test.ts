import { EventEmitter } from "node:events";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  ackLease,
  ChatError,
  computeCursorChecksum,
  type Confirmation,
  type ReaderCursor,
} from "../../src/cursor/index.ts";

const mockFs = await import("node:fs");

interface StubWritableStream extends EventEmitter {
  write(chunk: string, callback?: (err?: Error | null) => void): boolean;
}

interface WriteFlushedResult {
  readonly success: boolean;
  readonly bytes: number;
}

function runWriteFlushedGate(
  stream: StubWritableStream,
  chunk: string,
): Promise<WriteFlushedResult> {
  const expectedBytes = Buffer.byteLength(chunk, "utf-8");
  return new Promise((resolveResult) => {
    let callbackFiredNoError = false;
    let drainObserved = false;
    let poisoned = false;

    const onError = (): void => {
      poisoned = true;
      resolveResult({ success: false, bytes: 0 });
    };

    stream.once("error", onError);

    const onDrain = (): void => {
      drainObserved = true;
      checkComplete();
    };

    const checkComplete = (): void => {
      if (poisoned) return;
      const drainSatisfied = returnVal ? true : drainObserved;
      if (callbackFiredNoError && drainSatisfied) {
        stream.removeListener("error", onError);
        stream.removeListener("drain", onDrain);
        resolveResult({ success: true, bytes: expectedBytes });
      }
    };

    const returnVal = stream.write(chunk, (err) => {
      if (err) {
        poisoned = true;
        stream.removeListener("error", onError);
        stream.removeListener("drain", onDrain);
        resolveResult({ success: false, bytes: 0 });
        return;
      }
      callbackFiredNoError = true;
      checkComplete();
    });

    if (!returnVal) {
      stream.once("drain", onDrain);
    }
  });
}

function createCursor(now: string): ReaderCursor {
  const unsigned: Omit<ReaderCursor, "checksum"> = {
    v: 1,
    room: "room-d2",
    reader: "reader-d2",
    contiguous_seq: 0,
    held: [
      {
        lease: "lease-d2",
        from: 1,
        to: 2,
        issued_at: now,
        expires_at: new Date(Date.now() + 60000).toISOString(),
        attempt: 1,
      },
    ],
    acked_above: [],
    last_ack_at: null,
    updated_at: now,
  };
  return {
    ...unsigned,
    checksum: computeCursorChecksum(unsigned),
  };
}

describe("Defect D2: stdout write returning true is never delivery", () => {
  it("verifies cursor/ack.ts cannot physically observe stdout or process streams", () => {
    const ackPath = resolve(import.meta.dir, "../../src/cursor/ack.ts");
    const ackSource = mockFs.readFileSync(ackPath, "utf-8");
    expect(ackSource.length).toBeGreaterThan(0);
    expect(ackSource.includes('from "node:process"')).toBe(false);
    expect(ackSource.includes('from "process"')).toBe(false);
    expect(ackSource.includes('from "node:tty"')).toBe(false);
  });

  it("requires fsynced: true on spooled confirmations", () => {
    const now = new Date().toISOString();
    const cursor = createCursor(now);

    const fsyncedFalse: Confirmation = {
      kind: "spooled",
      at: now,
      spool_path: "/spool/test.log",
      spool_offset: 0,
      fsynced: false,
    };
    try {
      ackLease(cursor, "lease-d2", 2, fsyncedFalse);
      expect.unreachable();
    } catch (err) {
      expect(err instanceof ChatError).toBe(true);
      expect((err as ChatError).code).toBe("INVALID_ARGUMENT");
    }

    const cursorForSpooled = createCursor(now);
    const fsyncedTrue: Confirmation = {
      kind: "spooled",
      at: now,
      spool_path: "/spool/test.log",
      spool_offset: 0,
      fsynced: true,
    };
    const spooledAdvanced = ackLease(cursorForSpooled, "lease-d2", 2, fsyncedTrue);
    expect(spooledAdvanced.contiguous_seq).toBe(2);

    const negativeOffsetSpooled: Confirmation = {
      kind: "spooled",
      at: now,
      spool_path: "/spool/test.log",
      spool_offset: -1,
      fsynced: true,
    };
    expect(() => ackLease(cursor, "lease-d2", 2, negativeOffsetSpooled)).toThrow(ChatError);

    const emptyTimestampSpooled: Confirmation = {
      kind: "spooled",
      at: "",
      spool_path: "/spool/test.log",
      spool_offset: 0,
      fsynced: true,
    };
    expect(() => ackLease(cursor, "lease-d2", 2, emptyTimestampSpooled)).toThrow(ChatError);
  });

  it("advances nothing when stdout write returns true without callback firing", async () => {
    class StubStdout extends EventEmitter implements StubWritableStream {
      writeCalled = false;
      pendingCallback: ((err?: Error | null) => void) | null = null;

      write(_chunk: string, callback?: (err?: Error | null) => void): boolean {
        this.writeCalled = true;
        this.pendingCallback = callback ?? null;
        return true;
      }
    }

    const stdout = new StubStdout();
    const payload = "batch payload";
    const now = new Date().toISOString();
    const cursor = createCursor(now);

    const gatePromise = runWriteFlushedGate(stdout, payload);
    expect(stdout.writeCalled).toBe(true);

    let confirmationConstructed = false;
    let gateSettled = false;
    gatePromise.then(() => {
      gateSettled = true;
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(gateSettled).toBe(false);
    expect(cursor.contiguous_seq).toBe(0);
    expect(confirmationConstructed).toBe(false);

    if (stdout.pendingCallback) {
      stdout.pendingCallback(null);
    }

    const gateResult = await gatePromise;
    expect(gateResult.success).toBe(true);
    expect(gateResult.bytes).toBe(Buffer.byteLength(payload, "utf-8"));

    const confirmation: Confirmation = {
      kind: "spooled",
      at: now,
      spool_path: "/spool/test.log",
      spool_offset: gateResult.bytes,
      fsynced: true,
    };
    confirmationConstructed = true;

    const advancedCursor = ackLease(cursor, "lease-d2", 2, confirmation);
    expect(confirmationConstructed).toBe(true);
    expect(advancedCursor.contiguous_seq).toBe(2);
  });

  it("advances nothing when an EPIPE error occurs mid-batch", async () => {
    class BrokenPipeStdout extends EventEmitter implements StubWritableStream {
      write(_chunk: string, callback?: (err?: Error | null) => void): boolean {
        const error = new Error("write EPIPE");
        Object.assign(error, { code: "EPIPE" });
        this.emit("error", error);
        if (callback) {
          callback(error);
        }
        return false;
      }
    }

    const stdout = new BrokenPipeStdout();
    const payload = "message to dead consumer";
    const now = new Date().toISOString();
    const cursor = createCursor(now);

    let confirmationConstructed = false;
    let observedError: Error | null = null;

    stdout.on("error", (err: Error) => {
      observedError = err;
    });

    const gateResult = await runWriteFlushedGate(stdout, payload);
    expect(observedError).toBeDefined();
    expect(gateResult.success).toBe(false);
    expect(gateResult.bytes).toBe(0);

    if (gateResult.success) {
      confirmationConstructed = true;
    }

    expect(confirmationConstructed).toBe(false);
    expect(cursor.contiguous_seq).toBe(0);
  });
});
