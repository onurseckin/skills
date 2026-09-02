import { describe, expect, test } from "bun:test";
import {
  notifyPhaseCommand,
  notifyTestCommand,
} from "../../../../olt/scripts/src/cli/commands/notify-ops.ts";
import type { NotificationResult } from "../../../../olt/scripts/src/reporting/notifications/index.ts";

describe("notify-ops CLI Command Coverage Suite", () => {
  describe("notifyPhaseCommand", () => {
    test("handles empty/default flags without optional fields", () => {
      const result = notifyPhaseCommand({});

      expect(result.phase).toBe("");
      expect(typeof result.markdown).toBe("string");
      expect(result.markdown).toContain("### Native OS Notification Dispatched: ``");
      expect(result.markdown).toContain("- **Platform**:");
      expect(result.markdown).toContain("- **Visual Delivered**:");
      expect(result.markdown).toContain("- **Audio Delivered**:");
      expect(result.json).toBeUndefined();

      const notifResult = result.result as NotificationResult;
      expect(notifResult).toBeDefined();
      expect(typeof notifResult.success).toBe("boolean");
    });

    test("handles all flags including duration, task count, commit sha, and json output", () => {
      const result = notifyPhaseCommand({
        phase: "Phase-5-Security",
        "duration-ms": "125000",
        tasks: "8",
        commit: "abc123456789",
        title: "Security Hardening",
        subtitle: "Sub-Phase A",
        details: "Detailed security analysis complete",
        sound: true,
        json: true,
      });

      expect(result.phase).toBe("Phase-5-Security");
      expect(result.json).toBe(true);
      expect(result.markdown).toContain(
        "### Native OS Notification Dispatched: `Phase-5-Security`",
      );
      expect(result.markdown).toContain("- **Duration**: `2m 5s`");
      expect(result.markdown).toContain("- **Task Count**: `8`");
      expect(result.markdown).toContain("- **Commit**: `abc123456789`");
    });

    test("respects no-sound and silent flags", () => {
      const silentRes = notifyPhaseCommand({
        phase: "Silent Phase",
        "no-sound": true,
        silent: true,
      });

      expect(silentRes.phase).toBe("Silent Phase");
      const notifResult = silentRes.result as NotificationResult;
      expect(notifResult.audioDelivered).toBe(false);
    });

    test("includes visualCommand and audioCommand in markdown if present in result", () => {
      const result = notifyPhaseCommand({
        phase: "Command Verification",
        title: "Verification Title",
        sound: true,
      });

      const notifResult = result.result as NotificationResult;
      if (notifResult.visualCommand) {
        expect(result.markdown).toContain(`- **Visual Command**: \`${notifResult.visualCommand}\``);
      }
      if (notifResult.audioCommand) {
        expect(result.markdown).toContain(`- **Audio Command**: \`${notifResult.audioCommand}\``);
      }
    });
  });

  describe("notifyTestCommand", () => {
    test("executes default test notification with sound enabled", () => {
      const result = notifyTestCommand({});

      expect(typeof result.markdown).toBe("string");
      expect(result.markdown).toContain("### Native Notification Engine Test: Complete");
      expect(result.markdown).toContain("- **Platform**:");
      expect(result.markdown).toContain("- **Visual Notification**:");
      expect(result.markdown).toContain("- **Glass Audio Chime**:");
      expect(result.status === "success" || result.status === "failed").toBe(true);
      expect(result.json).toBeUndefined();
    });

    test("executes test notification with json and no-sound flags", () => {
      const result = notifyTestCommand({
        json: true,
        "no-sound": true,
      });

      expect(result.json).toBe(true);
      const notifResult = result.result as NotificationResult;
      expect(notifResult.audioDelivered).toBe(false);
      expect(result.markdown).toContain("- **Glass Audio Chime**: `Skipped/Disabled`");
    });
  });
});
