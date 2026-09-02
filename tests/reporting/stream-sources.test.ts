import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CapsuleEventSource,
  HeartbeatStreamSource,
  MailboxStreamSource,
  TelemetryStreamSource,
} from "../../olt/scripts/src/reporting/tui/stream-sources.ts";

describe("TUI Stream Sources Suite (stream-sources.ts)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "stream-sources-cov-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("CapsuleEventSource", () => {
    it("returns empty array when events.jsonl does not exist", () => {
      const source = new CapsuleEventSource(tempDir);
      expect(source.channelName).toBe("capsule_events");
      expect(source.pollNewEvents()).toEqual([]);
    });

    it("polls and offsets events from events.jsonl, handling fallbacks and corrupt lines", () => {
      const source = new CapsuleEventSource(tempDir);
      const eventsFile = join(tempDir, "events.jsonl");

      const line1 = JSON.stringify({ kind: "pulse-opened", timestamp: "2026-09-01T00:00:00Z" });
      const line2 = "invalid json line";
      const line3 = JSON.stringify({
        kind: "task-leased",
        sequence: 42,
        actor: "worker-1",
        timestamp: "2026-09-01T00:01:00Z",
      });
      const line4 = JSON.stringify({ missing_kind: true, timestamp: "2026-09-01T00:02:00Z" });

      writeFileSync(eventsFile, `${line1}\n${line2}\n${line3}\n${line4}`);

      const polled1 = source.pollNewEvents();
      expect(polled1.length).toBe(2);

      expect(polled1[0]?.id).toBe("capsule-1");
      expect(polled1[0]?.actor).toBe("system");
      expect(polled1[0]?.kind).toBe("pulse-opened");
      expect(polled1[0]?.sequence).toBe(1);

      expect(polled1[1]?.id).toBe("capsule-42");
      expect(polled1[1]?.actor).toBe("worker-1");
      expect(polled1[1]?.sequence).toBe(42);

      // Incremental poll without new lines returns empty
      expect(source.pollNewEvents()).toEqual([]);

      // Append new event
      const line5 = JSON.stringify({ kind: "pulse-closed", timestamp: "2026-09-01T00:03:00Z" });
      appendFileSync(eventsFile, `\n${line5}`);

      const polled2 = source.pollNewEvents();
      expect(polled2.length).toBe(1);
      expect(polled2[0]?.kind).toBe("pulse-closed");
    });
  });

  describe("TelemetryStreamSource", () => {
    it("returns empty array when telemetry file does not exist", () => {
      const filePath = join(tempDir, "nonexistent.jsonl");
      const source = new TelemetryStreamSource(filePath);
      expect(source.channelName).toBe("telemetry");
      expect(source.pollNewEvents()).toEqual([]);
    });

    it("polls telemetry stream with action fallback and incremental offset tracking", () => {
      const filePath = join(tempDir, "telemetry.jsonl");
      const source = new TelemetryStreamSource(filePath);

      const t1 = JSON.stringify({
        actor: "agent-1",
        timestamp: "2026-09-01T10:00:00Z",
        action: "execute_step",
      });
      const t2 = "corrupted line";
      const t3 = JSON.stringify({ actor: "agent-2", timestamp: "2026-09-01T10:01:00Z" });
      const t4 = JSON.stringify({ missing_actor: true, timestamp: "2026-09-01T10:02:00Z" });

      writeFileSync(filePath, `${t1}\n${t2}\n${t3}\n${t4}`);

      const polled1 = source.pollNewEvents();
      expect(polled1.length).toBe(2);
      expect(polled1[0]?.actor).toBe("agent-1");
      expect(polled1[0]?.kind).toBe("execute_step");
      expect(polled1[0]?.id).toBe("telem-1");

      expect(polled1[1]?.actor).toBe("agent-2");
      expect(polled1[1]?.kind).toBe("telemetry_pulse");
      expect(polled1[1]?.id).toBe("telem-2");

      expect(source.pollNewEvents()).toEqual([]);

      // Append new telemetry entry
      const t5 = JSON.stringify({
        actor: "agent-3",
        timestamp: "2026-09-01T10:03:00Z",
        action: "task_done",
      });
      appendFileSync(filePath, `\n${t5}`);

      const polled2 = source.pollNewEvents();
      expect(polled2.length).toBe(1);
      expect(polled2[0]?.actor).toBe("agent-3");
    });
  });

  describe("MailboxStreamSource", () => {
    it("injects and drains mailbox envelopes with timestamp and id fallbacks", () => {
      const source = new MailboxStreamSource();
      expect(source.channelName).toBe("mailbox");

      source.injectMessage({
        messageId: "msg-custom-1",
        sender: "coordinator",
        recipient: "worker",
        subject: "Task dispatch",
        body: "Execute unit test",
        timestamp: "2026-09-01T12:00:00Z",
      });
      source.injectMessage({
        messageId: "",
        sender: "worker",
        recipient: "coordinator",
        subject: "Ack",
        body: "Received",
        timestamp: "",
      });

      const envelopes = source.pollNewEvents();
      expect(envelopes.length).toBe(2);

      expect(envelopes[0]?.id).toBe("msg-custom-1");
      expect(envelopes[0]?.actor).toBe("coordinator");
      expect(envelopes[0]?.kind).toBe("mailbox_envelope");
      expect(envelopes[0]?.sequence).toBe(1);

      expect(envelopes[1]?.id).toBe("msg-2");
      expect(envelopes[1]?.actor).toBe("worker");
      expect(envelopes[1]?.sequence).toBe(2);
      expect(typeof envelopes[1]?.timestamp).toBe("string");

      expect(source.pollNewEvents()).toEqual([]);
    });
  });

  describe("HeartbeatStreamSource", () => {
    it("records and drains heartbeat pulses", () => {
      const source = new HeartbeatStreamSource();
      expect(source.channelName).toBe("heartbeat");

      source.recordPulse({
        agentId: "agent-alpha",
        role: "auditor",
        pulseTimestamp: "2026-09-01T13:00:00Z",
        latencyMs: 45,
        status: "healthy",
      });
      source.recordPulse({
        agentId: "agent-beta",
        role: "coder",
        pulseTimestamp: "2026-09-01T13:00:01Z",
        latencyMs: 120,
        status: "degraded",
      });

      const events = source.pollNewEvents();
      expect(events.length).toBe(2);

      expect(events[0]?.id).toBe("hb-agent-alpha-1");
      expect(events[0]?.actor).toBe("agent-alpha");
      expect(events[0]?.kind).toBe("heartbeat_pulse");
      expect(events[0]?.sequence).toBe(1);
      expect(events[0]?.payload.status).toBe("healthy");

      expect(events[1]?.id).toBe("hb-agent-beta-2");
      expect(events[1]?.actor).toBe("agent-beta");
      expect(events[1]?.sequence).toBe(2);
      expect(events[1]?.payload.status).toBe("degraded");

      expect(source.pollNewEvents()).toEqual([]);
    });
  });
});
