import { describe, expect, it } from "bun:test";
import {
  buildTimeTelemetryReport,
  enrichHarnessEvent,
  enrichWithDualTime,
  extractDualTime,
  formatDualTimeTable,
  renderDualTimeHeader,
  renderOmnipresentTelemetryMarkdown,
} from "../../../../olt/scripts/src/reporting/time-telemetry/index.ts";

describe("reporting/time-telemetry setup & formatting suite", () => {
  it("enriches objects and events with dual time", () => {
    const payload = { key: "value" };
    const enriched = enrichWithDualTime(payload);
    expect(enriched.key).toBe("value");
    expect(enriched._dual_time).toBeDefined();
    expect(enriched._telemetry_id).toBeDefined();

    const extracted = extractDualTime(enriched);
    expect(extracted).not.toBeNull();
    expect(extracted?.utc).toBeDefined();

    const event = {
      schema: "harness-event-v1",
      sequence: 1,
      timestamp: "2026-08-29T12:00:00.000Z",
      actor: "agent",
      kind: "ping",
    };
    const enrichedEvent = enrichHarnessEvent(event);
    expect(enrichedEvent.dual_time).toBeDefined();
  });

  it("renders dual-time markdown header and table formats", () => {
    const header = renderDualTimeHeader("Test Telemetry Header");
    expect(header).toContain("# Test Telemetry Header");
    expect(header).toContain("Generated At");

    const emptyTable = formatDualTimeTable([]);
    expect(emptyTable).toContain("No time telemetry records found");

    const report = buildTimeTelemetryReport([], 0, { runId: "test-run-id" });
    const md = renderOmnipresentTelemetryMarkdown(report);
    expect(md).toContain("Omnipresent Time Telemetry & Dual-Time Report");
    expect(md).toContain("Overview & Statistical Profile");
  });
});
