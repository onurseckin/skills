import { afterEach, beforeEach, describe, expect, it } from "bun:test";
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
import {
  cleanupVirtualCaptureFS,
  getVirtualCaptureFS,
  scratchRoot,
  setupVirtualCaptureFS,
} from "../fixture.ts";

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
    const vfs = getVirtualCaptureFS();
    const testDir = scratchRoot("event-ledger", "stream");
    vfs.mkdirSync(testDir, { recursive: true });
    const ledgerFile = join(testDir, "capture-events.jsonl");

    const ledger = new CaptureEventLedger({ ledgerPath: ledgerFile, autoFlush: true });
    ledger.appendEvent("CAPTURE_INITIALIZED", { runId: "stream-run" });
    ledger.appendEvent("PHYSICS_EXTRACTED", { elementCount: 42 });
    ledger.appendEvent("CAPTURE_FINALIZED", { totalScreens: 1 });
    ledger.close();

    expect(vfs.existsSync(ledgerFile)).toBe(true);

    const recovered = readEventLedger(ledgerFile);
    expect(recovered.length).toBe(3);
    expect(recovered[0]?.eventType).toBe("CAPTURE_INITIALIZED");
    expect(recovered[1]?.eventType).toBe("PHYSICS_EXTRACTED");
    expect(recovered[2]?.eventType).toBe("CAPTURE_FINALIZED");

    const verifyRes = verifyEventChain(recovered);
    expect(verifyRes.valid).toBe(true);
  });

  it("enforces path safety: allows .tmp, .olt/capsules, .olt/scratch, rejects root leaks and traversal", () => {
    const safeTmp = join(process.cwd(), ".tmp", "test-ledger.jsonl");
    const safeCapsule = join(process.cwd(), ".olt/capsules/run-1/ledger.jsonl");
    const safeScratch = join(process.cwd(), ".olt/scratch", "test-ledger.jsonl");
    const safeOsTmp = join(tmpdir(), "ledger.jsonl");

    expect(() => assertSafeLedgerPath(safeTmp)).not.toThrow();
    expect(() => assertSafeLedgerPath(safeCapsule)).not.toThrow();
    expect(() => assertSafeLedgerPath(safeScratch)).not.toThrow();
    expect(() => assertSafeLedgerPath(safeOsTmp)).not.toThrow();

    const rootLeak = join(process.cwd(), "events.jsonl");
    const arbitraryLeak = join(process.cwd(), "captures", "events.jsonl");
    const tmpTraversal = join(process.cwd(), ".tmp", "..", "escaped.jsonl");
    const scratchTraversal = join(process.cwd(), ".olt", "scratch", "..", "..", "sneaky.jsonl");

    expect(() => assertSafeLedgerPath(rootLeak)).toThrow("outside allowed storage roots");
    expect(() => assertSafeLedgerPath(arbitraryLeak)).toThrow("outside allowed storage roots");
    expect(() => assertSafeLedgerPath(tmpTraversal)).toThrow("outside allowed storage roots");
    expect(() => assertSafeLedgerPath(scratchTraversal)).toThrow("outside allowed storage roots");
  });

  it("resolves default ledger path under .tmp or .olt/capsules", () => {
    const defaultTmpPath = resolveDefaultLedgerPath();
    expect(defaultTmpPath).toContain(".tmp/capture-ledger");

    const runPath = resolveDefaultLedgerPath({ runId: "test-run-abc" });
    expect(runPath).toContain("test-run-abc/ledger/capture-events.jsonl");
  });

  it("strictly rejects appendEvent and flush on closed ledger", () => {
    const ledger = createEventLedger();
    ledger.appendEvent("CAPTURE_INITIALIZED", { runId: "close-test" });
    expect(ledger.isClosed).toBe(false);
    ledger.close();
    expect(ledger.isClosed).toBe(true);

    expect(() => ledger.appendEvent("DOM_MUTATED", {})).toThrow(
      "Cannot append to a closed CaptureEventLedger",
    );
    expect(() => ledger.flush()).toThrow("Cannot append to a closed CaptureEventLedger");
  });

  it("detects genesis prevHash tampering and correctly verifies empty chains", () => {
    const emptyRes = verifyEventChain([]);
    expect(emptyRes.valid).toBe(true);
    expect(emptyRes.totalEvents).toBe(0);
    expect(emptyRes.latestHash).toBe(GENESIS_HASH);

    const ledger = createEventLedger();
    ledger.appendEvent("CAPTURE_INITIALIZED", { runId: "genesis-test" });
    const events = ledger.getEvents();

    const tamperedGenesis: CaptureEventRecord[] = [
      {
        ...events[0]!,
        prevHash: "f".repeat(64),
      },
    ];
    const res = verifyEventChain(tamperedGenesis);
    expect(res.valid).toBe(false);
    expect(res.error).toContain("Broken hash chain at sequence 1");
  });

  it("streams events to deeply nested directories in virtual memory", () => {
    const vfs = getVirtualCaptureFS();
    const deepDir = join(scratchRoot("event-ledger", "deep"), "sub1", "sub2", "sub3");
    vfs.mkdirSync(deepDir, { recursive: true });
    const ledgerFile = join(deepDir, "deep-events.jsonl");

    const ledger = new CaptureEventLedger({ ledgerPath: ledgerFile, autoFlush: true });
    ledger.appendEvent("CAPTURE_INITIALIZED", { runId: "deep-run" });
    ledger.close();

    expect(vfs.existsSync(ledgerFile)).toBe(true);
    const recovered = readEventLedger(ledgerFile);
    expect(recovered).toHaveLength(1);
    expect(verifyEventChain(recovered).valid).toBe(true);
  });
});
