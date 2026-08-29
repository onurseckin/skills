import { describe, expect, it } from "bun:test";
import {
  buildPhaseNotificationPayload,
  escapeAppleScriptString,
  escapePowerShellString,
  formatElapsedDuration,
  type PhaseCompletionNotificationOptions,
} from "../../../../olt/scripts/src/reporting/notifications/index.ts";

describe("Notifications Duration & String Formatters", () => {
  it("formats millisecond durations into human-readable intervals", () => {
    expect(formatElapsedDuration(0)).toBe("0s");
    expect(formatElapsedDuration(-100)).toBe("0s");
    expect(formatElapsedDuration(Number.NaN)).toBe("0s");
    expect(formatElapsedDuration(Number.POSITIVE_INFINITY)).toBe("0s");
    expect(formatElapsedDuration(450)).toBe("<1s");
    expect(formatElapsedDuration(1000)).toBe("1s");
    expect(formatElapsedDuration(14000)).toBe("14s");
    expect(formatElapsedDuration(272000)).toBe("4m 32s");
    expect(formatElapsedDuration(3600000)).toBe("1h 0m 0s");
    expect(formatElapsedDuration(3724000)).toBe("1h 2m 4s");
  });

  it("escapes AppleScript special characters correctly", () => {
    const input = 'Phase "Core" with \\ backslash and "quotes"';
    const escaped = escapeAppleScriptString(input);
    expect(escaped).toBe('Phase \\"Core\\" with \\\\ backslash and \\"quotes\\"');
  });

  it("escapes PowerShell special characters correctly", () => {
    const input = "User's `test` variable";
    const escaped = escapePowerShellString(input);
    expect(escaped).toBe("User''s ``test`` variable");
  });

  it("builds comprehensive notification payload with all metadata", () => {
    const opts: PhaseCompletionNotificationOptions = {
      phaseName: "Tooling & Telemetry",
      commitSha: "89a5042e12345678",
      taskCount: 7,
      durationMs: 145000,
      details: "all tests passing",
    };

    const payload = buildPhaseNotificationPayload(opts);
    expect(payload.title).toBe("OLT Release Complete");
    expect(payload.subtitle).toBe("Tooling & Telemetry");
    expect(payload.soundEnabled).toBe(true);
    expect(payload.message).toContain('Phase "Tooling & Telemetry" landed');
    expect(payload.message).toContain("Duration: 2m 25s");
    expect(payload.message).toContain("7 tasks");
    expect(payload.message).toContain("commit 89a5042e");
    expect(payload.message).toContain("all tests passing");
  });

  it("builds minimal notification payload when optional fields are omitted", () => {
    const opts: PhaseCompletionNotificationOptions = {
      phaseName: "Core Architecture",
    };

    const payload = buildPhaseNotificationPayload(opts);
    expect(payload.title).toBe("OLT Release Complete");
    expect(payload.subtitle).toBe("Core Architecture");
    expect(payload.message).toBe('Phase "Core Architecture" landed successfully.');
    expect(payload.soundEnabled).toBe(true);
  });
});
