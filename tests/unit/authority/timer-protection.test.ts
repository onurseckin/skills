import { describe, it, expect } from "bun:test";
import { TimerProtectionGuard } from "../../../olt/scripts/src/authority/timer-protection-guard.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";

describe("TimerProtectionGuard", () => {
  it("blocks subagents from killing protected supervisory timers", () => {
    const caller = { id: "mind-1", role: "mind" };
    const supervisoryTimer = { id: "task-6926", isSupervisory: true, label: "5m watchdog" };

    expect(() => {
      TimerProtectionGuard.assertCanKillTimer(caller, supervisoryTimer);
    }).toThrow(HarnessError);
  });

  it("allows killing ephemeral scratch jobs", () => {
    const caller = { id: "impl-1", role: "implementer" };
    const scratchJob = { id: "task-temp", isSupervisory: false, label: "test runner" };

    expect(() => {
      TimerProtectionGuard.assertCanKillTimer(caller, scratchJob);
    }).not.toThrow();
  });
});
