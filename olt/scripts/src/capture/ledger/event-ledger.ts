import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { computeEventHash, GENESIS_HASH, verifyEventChain } from "./hash-chain.ts";
import { assertSafeLedgerPath } from "./path-guard.ts";
import type {
  CaptureEventRecord,
  CaptureEventType,
  EventLedgerOptions,
  EventLedgerStats,
  LedgerVerificationResult,
} from "./types.ts";

export class CaptureEventLedger {
  private readonly events: CaptureEventRecord[] = [];
  private latestHash: string = GENESIS_HASH;
  private isClosedState = false;
  private readonly ledgerPath?: string | undefined;
  private readonly autoFlush: boolean;

  public constructor(options: EventLedgerOptions = {}) {
    this.ledgerPath = options.ledgerPath;
    this.autoFlush = options.autoFlush ?? true;

    if (this.ledgerPath) {
      assertSafeLedgerPath(this.ledgerPath);
      const targetDir = dirname(this.ledgerPath);
      mkdirSync(targetDir, { recursive: true });
    }
  }

  public get isClosed(): boolean {
    return this.isClosedState;
  }

  private assertNotClosed(): void {
    if (this.isClosedState) {
      throw new Error("Cannot append to a closed CaptureEventLedger");
    }
  }

  public appendEvent(
    eventType: CaptureEventType,
    payload: Record<string, unknown>,
    actor?: string,
  ): CaptureEventRecord {
    this.assertNotClosed();

    const sequenceNumber = this.events.length + 1;
    const eventId = randomUUID();
    const timestamp = new Date().toISOString();
    const prevHash = this.latestHash;

    const partialRecord = {
      sequenceNumber,
      eventId,
      timestamp,
      eventType,
      payload,
      prevHash,
      actor,
    };

    const hash = computeEventHash(prevHash, partialRecord);

    const record: CaptureEventRecord = {
      ...partialRecord,
      hash,
    };

    this.events.push(record);
    this.latestHash = hash;

    if (this.ledgerPath && this.autoFlush) {
      this.writeRecordToFile(record);
    }

    return record;
  }

  private writeRecordToFile(record: CaptureEventRecord): void {
    if (!this.ledgerPath) return;
    const line = `${JSON.stringify(record)}\n`;
    appendFileSync(this.ledgerPath, line, "utf-8");
  }

  public flush(): void {
    this.assertNotClosed();
    if (!this.ledgerPath || this.autoFlush) return;
    const targetDir = dirname(this.ledgerPath);
    mkdirSync(targetDir, { recursive: true });
    const content = this.events.map((r) => JSON.stringify(r)).join("\n") + "\n";
    appendFileSync(this.ledgerPath, content, "utf-8");
  }

  public getEvents(): readonly CaptureEventRecord[] {
    return [...this.events];
  }

  public verify(): LedgerVerificationResult {
    return verifyEventChain(this.events);
  }

  public getStats(): EventLedgerStats {
    return {
      totalEvents: this.events.length,
      genesisHash: GENESIS_HASH,
      latestHash: this.latestHash,
      ledgerPath: this.ledgerPath,
      isClosed: this.isClosedState,
    };
  }

  public close(): void {
    if (this.isClosedState) return;
    if (this.ledgerPath && !this.autoFlush) {
      this.flush();
    }
    this.isClosedState = true;
  }
}

export function createEventLedger(options?: EventLedgerOptions): CaptureEventLedger {
  return new CaptureEventLedger(options);
}

export function readEventLedger(ledgerPath: string): readonly CaptureEventRecord[] {
  assertSafeLedgerPath(ledgerPath);
  if (!existsSync(ledgerPath)) {
    return [];
  }

  const raw = readFileSync(ledgerPath, "utf-8");
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const results: CaptureEventRecord[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as CaptureEventRecord;
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        typeof parsed.sequenceNumber === "number" &&
        typeof parsed.hash === "string"
      ) {
        results.push(parsed);
      }
    } catch {
      // ignore corrupted line in recovery read
    }
  }

  return results;
}
