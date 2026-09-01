import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertSafeLedgerPath,
  CaptureEventLedger,
  createEventLedger,
  GENESIS_HASH,
  readEventLedger,
  resolveDefaultLedgerPath,
  verifyEventChain,
} from "../../../olt/scripts/src/capture/ledger/index.ts";
import type { CaptureEventRecord } from "../../../olt/scripts/src/capture/ledger/types.ts";
import { cleanupVirtualCaptureFS, scratchRoot, setupVirtualCaptureFS } from "../fixture.ts";

describe("Capture Event Ledger & Cryptographic Hash Chaining", () => {
  beforeEach(() => {
    setupVirtualCaptureFS();
  });

  afterEach(() => {
    cleanupVirtualCaptureFS();
  });

  it("appends sequential events with monotonic sequence numbers and hash chaining", () => {
    const ledger = createEventLedger();

    const e1 = ledger.appendEvent(
      "CAPTURE_INITIALIZED",
      { runId: "test-run-1", target: "home" },
      "actor-1",
    );
    const e2 = ledger.appendEvent(
      "VIEWPORT_RENDERED",
      { viewport: "desktop", width: 1440, height: 900 },
      "actor-1",
    );
    const e3 = ledger.appendEvent(
      "SCREENSHOT_CAPTURED",
      { imageSha256: "a".repeat(64), bytes: 1048576 },
      "actor-1",
    );

    expect(e1.sequenceNumber).toBe(1);
    expect(e1.prevHash).toBe(GENESIS_HASH);
    expect(e1.hash).toMatch(/^[a-f0-9]{64}$/);

    expect(e2.sequenceNumber).toBe(2);
    expect(e2.prevHash).toBe(e1.hash);
    expect(e2.hash).toMatch(/^[a-f0-9]{64}$/);

    expect(e3.sequenceNumber).toBe(3);
    expect(e3.prevHash).toBe(e2.hash);
    expect(e3.hash).toMatch(/^[a-f0-9]{64}$/);

    const history = ledger.getEvents();
    expect(history.length).toBe(3);

    const verification = verifyEventChain(history);
    expect(verification.valid).toBe(true);
    expect(verification.totalEvents).toBe(3);
  });

  it("detects tampering or corruption in the middle of the chain", () => {
    const ledger = createEventLedger();
    ledger.appendEvent("CAPTURE_INITIALIZED", { runId: "r1" });
    ledger.appendEvent("DOM_MUTATED", { mutationCount: 5 });
    ledger.appendEvent("CAPTURE_FINALIZED", { status: "success" });

    const events = ledger.getEvents();
    const tampered: CaptureEventRecord[] = [
      events[0]!,
      {
        ...events[1]!,
        payload: { mutationCount: 999 }, // Modified payload
      },
      events[2]!,
    ];

    const verification = verifyEventChain(tampered);
    expect(verification.valid).toBe(false);
    expect(verification.error).toContain("Tampered payload hash at sequence 2");
  });

  it("detects broken sequential ordering", () => {
    const ledger = createEventLedger();
    ledger.appendEvent("CAPTURE_INITIALIZED", { runId: "r1" });
    ledger.appendEvent("DOM_MUTATED", { mutationCount: 5 });
    ledger.appendEvent("CAPTURE_FINALIZED", { status: "success" });

    const events = ledger.getEvents();

    const brokenSequence = [events[0]!, events[2]!];
    const resSeq = verifyEventChain(brokenSequence);
    expect(resSeq.valid).toBe(false);
    expect(resSeq.error).toContain("Sequence mismatch");
  });

  it("streams events to safe disk location and recovers them cleanly", () => {
    const testDir = scratchRoot("event-ledger", "stream");
    mkdirSync(testDir, { recursive: true });
    const ledgerFile = join(testDir, "capture-events.jsonl");

    const ledger = new CaptureEventLedger({ ledgerPath: ledgerFile, autoFlush: true });
    ledger.appendEvent("CAPTURE_INITIALIZED", { runId: "stream-run" });
    ledger.appendEvent("PHYSICS_EXTRACTED", { elementCount: 42 });
    ledger.appendEvent("CAPTURE_FINALIZED", { totalScreens: 1 });
    ledger.close();

    expect(existsSync(ledgerFile)).toBe(true);

    const recovered = readEventLedger(ledgerFile);
    expect(recovered.length).toBe(3);
    expect(recovered[0]?.eventType).toBe("CAPTURE_INITIALIZED");
    expect(recovered[1]?.eventType).toBe("PHYSICS_EXTRACTED");
    expect(recovered[2]?.eventType).toBe("CAPTURE_FINALIZED");

    const verifyRes = verifyEventChain(recovered);
    expect(verifyRes.valid).toBe(true);
  });

  it("enforces path safety: allows .tmp and .olt/capsules, rejects root leaks", () => {
    const safeTmp = join(process.cwd(), ".tmp", "test-ledger.jsonl");
    const safeCapsule = join(process.cwd(), ".olt/capsules/run-1/ledger.jsonl");
    const safeOsTmp = join(tmpdir(), "ledger.jsonl");

    expect(() => assertSafeLedgerPath(safeTmp)).not.toThrow();
    expect(() => assertSafeLedgerPath(safeCapsule)).not.toThrow();
    expect(() => assertSafeLedgerPath(safeOsTmp)).not.toThrow();

    const rootLeak = join(process.cwd(), "events.jsonl");
    const arbitraryLeak = join(process.cwd(), "captures", "events.jsonl");

    expect(() => assertSafeLedgerPath(rootLeak)).toThrow("outside allowed storage roots");
    expect(() => assertSafeLedgerPath(arbitraryLeak)).toThrow("outside allowed storage roots");
  });

  it("resolves default ledger path under .tmp or .olt/capsules", () => {
    const defaultTmpPath = resolveDefaultLedgerPath();
    expect(defaultTmpPath).toContain(".tmp/capture-ledger");

    const runPath = resolveDefaultLedgerPath({ runId: "test-run-abc" });
    expect(runPath).toContain("test-run-abc/ledger/capture-events.jsonl");
  });
});
