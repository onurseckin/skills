import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { HarnessEvent } from "../../core/contracts/index.ts";
import type { TelemetryEvent } from "../telemetry-stream.ts";

export interface MuxEnvelope<T = unknown> {
  readonly id: string;
  readonly channel: string;
  readonly timestamp: string;
  readonly sequence: number;
  readonly actor: string;
  readonly kind: string;
  readonly payload: T;
}

export interface StreamSource<T = unknown> {
  readonly channelName: string;
  pollNewEvents(lastSeq?: number): readonly MuxEnvelope<T>[];
}

export class CapsuleEventSource implements StreamSource<HarnessEvent> {
  public readonly channelName = "capsule_events";
  private readonly runDir: string;
  private lastReadOffset = 0;
  private seqCounter = 0;

  constructor(runDir: string) {
    this.runDir = runDir;
  }

  public pollNewEvents(): readonly MuxEnvelope<HarnessEvent>[] {
    const eventsFile = join(this.runDir, "events.jsonl");
    if (!existsSync(eventsFile)) {
      return [];
    }

    try {
      const content = readFileSync(eventsFile, "utf-8");
      const lines = content.split("\n");
      const newEnvelopes: MuxEnvelope<HarnessEvent>[] = [];

      for (let i = this.lastReadOffset; i < lines.length; i++) {
        const line = lines[i]?.trim();
        if (!line) continue;

        try {
          const parsed = JSON.parse(line) as HarnessEvent;
          if (parsed && typeof parsed === "object" && parsed.kind && parsed.timestamp) {
            this.seqCounter += 1;
            newEnvelopes.push({
              id: `capsule-${parsed.sequence ?? this.seqCounter}`,
              channel: this.channelName,
              timestamp: parsed.timestamp,
              sequence: parsed.sequence ?? this.seqCounter,
              actor: parsed.actor ?? "system",
              kind: parsed.kind,
              payload: parsed,
            });
          }
        } catch {}
      }

      this.lastReadOffset = lines.length;
      return newEnvelopes;
    } catch {
      return [];
    }
  }
}

export class TelemetryStreamSource implements StreamSource<TelemetryEvent> {
  public readonly channelName = "telemetry";
  private readonly telemetryFilePath: string;
  private lastReadOffset = 0;
  private seqCounter = 0;

  constructor(telemetryFilePath: string) {
    this.telemetryFilePath = telemetryFilePath;
  }

  public pollNewEvents(): readonly MuxEnvelope<TelemetryEvent>[] {
    if (!existsSync(this.telemetryFilePath)) {
      return [];
    }

    try {
      const content = readFileSync(this.telemetryFilePath, "utf-8");
      const lines = content.split("\n");
      const newEnvelopes: MuxEnvelope<TelemetryEvent>[] = [];

      for (let i = this.lastReadOffset; i < lines.length; i++) {
        const line = lines[i]?.trim();
        if (!line) continue;

        try {
          const parsed = JSON.parse(line) as TelemetryEvent;
          if (parsed && typeof parsed === "object" && parsed.actor && parsed.timestamp) {
            this.seqCounter += 1;
            newEnvelopes.push({
              id: `telem-${this.seqCounter}`,
              channel: this.channelName,
              timestamp: parsed.timestamp,
              sequence: this.seqCounter,
              actor: parsed.actor,
              kind: parsed.action || "telemetry_pulse",
              payload: parsed,
            });
          }
        } catch {}
      }

      this.lastReadOffset = lines.length;
      return newEnvelopes;
    } catch {
      return [];
    }
  }
}

export interface MailboxMessage {
  readonly messageId: string;
  readonly sender: string;
  readonly recipient: string;
  readonly subject: string;
  readonly body: string;
  readonly timestamp: string;
}

export class MailboxStreamSource implements StreamSource<MailboxMessage> {
  public readonly channelName = "mailbox";
  private readonly queue: MailboxMessage[] = [];
  private seqCounter = 0;

  public injectMessage(message: MailboxMessage): void {
    this.queue.push(message);
  }

  public pollNewEvents(): readonly MuxEnvelope<MailboxMessage>[] {
    const drained = this.queue.splice(0, this.queue.length);
    return drained.map((msg) => {
      this.seqCounter += 1;
      return {
        id: msg.messageId || `msg-${this.seqCounter}`,
        channel: this.channelName,
        timestamp: msg.timestamp || new Date().toISOString(),
        sequence: this.seqCounter,
        actor: msg.sender,
        kind: "mailbox_envelope",
        payload: msg,
      };
    });
  }
}

export interface HeartbeatPulse {
  readonly agentId: string;
  readonly role: string;
  readonly pulseTimestamp: string;
  readonly latencyMs: number;
  readonly status: "healthy" | "degraded" | "unresponsive";
}

export class HeartbeatStreamSource implements StreamSource<HeartbeatPulse> {
  public readonly channelName = "heartbeat";
  private readonly pulses: HeartbeatPulse[] = [];
  private seqCounter = 0;

  public recordPulse(pulse: HeartbeatPulse): void {
    this.pulses.push(pulse);
  }

  public pollNewEvents(): readonly MuxEnvelope<HeartbeatPulse>[] {
    const drained = this.pulses.splice(0, this.pulses.length);
    return drained.map((pulse) => {
      this.seqCounter += 1;
      return {
        id: `hb-${pulse.agentId}-${this.seqCounter}`,
        channel: this.channelName,
        timestamp: pulse.pulseTimestamp,
        sequence: this.seqCounter,
        actor: pulse.agentId,
        kind: "heartbeat_pulse",
        payload: pulse,
      };
    });
  }
}
