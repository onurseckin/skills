import { describe, it, expect } from "bun:test";
import { TimerProtectionGuard } from "../../olt/scripts/src/authority/guards/index.ts";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";

describe("TimerProtectionGuard", () => {
  it("blocks subagents from killing protected supervisory timers", () => {
    const caller = { id: "mind-1", role: "mind" };
    const supervisoryTimer = { id: "task-6926", isSupervisory: true, label: "5m watchdog" };

    expect(() => {
      TimerProtectionGuard.assertCanKillTimer(caller, supervisoryTimer);
    }).toThrow(HarnessError);

    try {
      TimerProtectionGuard.assertCanKillTimer(caller, supervisoryTimer);
    } catch (err: unknown) {
      expect(err instanceof HarnessError).toBe(true);
      expect((err as HarnessError).code).toBe("INVALID_STATE");
      expect((err as HarnessError).message).toContain("Permission Denied");
      expect((err as HarnessError).message).toContain("Supervisory heartbeats are immutable");
    }
  });

  it("allows human_root role to kill supervisory timers", () => {
    const caller = { id: "human-1", role: "human_root" };
    const supervisoryTimer = { id: "task-6926", isSupervisory: true, label: "5m watchdog" };

    expect(() => {
      TimerProtectionGuard.assertCanKillTimer(caller, supervisoryTimer);
    }).not.toThrow();
  });

  it("allows killing ephemeral scratch jobs for any role", () => {
    const callers = [
      { id: "impl-1", role: "implementer" },
      { id: "val-1", role: "validator" },
      { id: "coord-1", role: "coordinator" },
    ];
    const scratchJob = { id: "task-temp", isSupervisory: false, label: "test runner" };

    for (const caller of callers) {
      expect(() => {
        TimerProtectionGuard.assertCanKillTimer(caller, scratchJob);
      }).not.toThrow();
    }
  });

  it("can be instantiated and constructor executed", () => {
    const guard = new TimerProtectionGuard();
    expect(guard).toBeDefined();
    expect(guard instanceof TimerProtectionGuard).toBe(true);
    expect(TimerProtectionGuard.prototype.constructor).toBeDefined();
  });
});
