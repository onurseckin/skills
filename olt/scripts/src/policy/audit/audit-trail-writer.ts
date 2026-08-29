import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { computeAuditRecordHash, verifyAuditTrailChain } from "./hasher.ts";
import type {
  AuditEvent,
  AuditQueryFilter,
  AuditTrailWriterOptions,
  IntegrityCheckResult,
} from "./types.ts";

export class AuditTrailWriter {
  private readonly events: AuditEvent[] = [];
  private readonly logFilePath: string | undefined;
  private readonly enableFilePersistence: boolean;
  private readonly maxInMemoryEvents: number;
  private readonly enableTamperEvidentHashing: boolean;
  private sequenceCounter = 0;
  private lastHash: string | undefined = undefined;

  public constructor(options?: AuditTrailWriterOptions) {
    this.logFilePath = options?.logFilePath;
    this.enableFilePersistence = options?.enableFilePersistence ?? false;
    this.maxInMemoryEvents = options?.maxInMemoryEvents ?? 5000;
    this.enableTamperEvidentHashing = options?.enableTamperEvidentHashing ?? true;

    if (this.enableFilePersistence && this.logFilePath && existsSync(this.logFilePath)) {
      this.loadExistingFileLogs();
    }
  }

  private loadExistingFileLogs(): void {
    if (!this.logFilePath) {
      return;
    }
    try {
      const content = readFileSync(this.logFilePath, "utf-8");
      const lines = content.split("\n").filter((line) => line.trim().length > 0);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as AuditEvent;
          if (parsed && typeof parsed.id === "string") {
            this.events.push(parsed);
            this.sequenceCounter = Math.max(this.sequenceCounter, parsed.sequenceNumber ?? 0);
            this.lastHash = parsed.hash;
          }
        } catch {
        }
      }
      if (this.events.length > this.maxInMemoryEvents) {
        this.events.splice(0, this.events.length - this.maxInMemoryEvents);
      }
    } catch {
    }
  }

  public record(
    eventInput: Omit<AuditEvent, "id" | "timestamp" | "sequenceNumber" | "hash" | "previousHash"> & {
      readonly id?: string | undefined;
      readonly timestamp?: string | undefined;
    },
  ): AuditEvent {
    this.sequenceCounter += 1;
    const id = eventInput.id ?? randomUUID();
    const timestamp = eventInput.timestamp ?? new Date().toISOString();
    const sequenceNumber = this.sequenceCounter;
    const previousHash = this.enableTamperEvidentHashing ? this.lastHash : undefined;

    const baseEvent = {
      id,
      timestamp,
      sequenceNumber,
      category: eventInput.category,
      action: eventInput.action,
      actor: eventInput.actor,
      severity: eventInput.severity,
      outcome: eventInput.outcome,
      target: eventInput.target,
      details: eventInput.details,
      previousHash,
    };

    const hash = this.enableTamperEvidentHashing
      ? computeAuditRecordHash(baseEvent)
      : "";

    const event: AuditEvent = {
      ...baseEvent,
      hash,
    };

    this.lastHash = hash;
    this.events.push(event);

    if (this.events.length > this.maxInMemoryEvents) {
      this.events.shift();
    }

    if (this.enableFilePersistence && this.logFilePath) {
      this.persistToFile(event);
    }

    return event;
  }

  private persistToFile(event: AuditEvent): void {
    if (!this.logFilePath) {
      return;
    }
    const dir = dirname(this.logFilePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    appendFileSync(this.logFilePath, `${JSON.stringify(event)}\n`, "utf-8");
  }

  public query(filter?: AuditQueryFilter): readonly AuditEvent[] {
    let result = [...this.events];

    if (!filter) {
      return result;
    }

    if (filter.startTime) {
      const start = new Date(filter.startTime).getTime();
      result = result.filter((e) => new Date(e.timestamp).getTime() >= start);
    }

    if (filter.endTime) {
      const end = new Date(filter.endTime).getTime();
      result = result.filter((e) => new Date(e.timestamp).getTime() <= end);
    }

    if (filter.category) {
      result = result.filter((e) => e.category === filter.category);
    }

    if (filter.severity) {
      result = result.filter((e) => e.severity === filter.severity);
    }

    if (filter.outcome) {
      result = result.filter((e) => e.outcome === filter.outcome);
    }

    if (filter.actorId) {
      result = result.filter((e) => e.actor.id === filter.actorId);
    }

    if (filter.actorRole) {
      result = result.filter((e) => e.actor.role === filter.actorRole);
    }

    if (typeof filter.offset === "number" && filter.offset > 0) {
      result = result.slice(filter.offset);
    }

    if (typeof filter.limit === "number" && filter.limit >= 0) {
      result = result.slice(0, filter.limit);
    }

    return result;
  }

  public verifyIntegrity(): IntegrityCheckResult {
    return verifyAuditTrailChain(this.events);
  }

  public getEvents(): readonly AuditEvent[] {
    return [...this.events];
  }

  public getEventCount(): number {
    return this.events.length;
  }

  public clear(): void {
    this.events.length = 0;
    this.sequenceCounter = 0;
    this.lastHash = undefined;
  }
}
