import { describe, expect, test } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
import {
  CADENCE_WAKE_KINDS,
  classifyCadenceWake,
  classifyCadenceWakeInstant,
  resolveSupervisoryCadence,
} from "../../../olt/scripts/src/core/config/cadence.ts";

describe("CadenceWakeKind", () => {
  test("timer_fired is expressible even though nothing currently produces it", () => {
    expect(CADENCE_WAKE_KINDS).toContain("timer_fired");
  });

  test("classifyCadenceWake maps every measured arm_mechanism value to recovery_fired", () => {
    expect(classifyCadenceWake("activity-recovery")).toBe("recovery_fired");
    expect(classifyCadenceWake("crash-recovery")).toBe("recovery_fired");
  });

  test("classifyCadenceWake never guesses timer_fired from an unrecognized or absent mechanism", () => {
    expect(classifyCadenceWake(null)).toBe("unknown");
    expect(classifyCadenceWake(undefined)).toBe("unknown");
    expect(classifyCadenceWake("some-future-mechanism")).toBe("unknown");
  });
});

describe("classifyCadenceWakeInstant", () => {
  test("requires the caller to state the reference frame rather than inferring it", () => {
    const instant = classifyCadenceWakeInstant({
      atMs: 1000,
      armMechanism: "activity-recovery",
      referenceFrame: "deadline_relative",
    });
    expect(instant).toEqual({
      atMs: 1000,
      kind: "recovery_fired",
      referenceFrame: "deadline_relative",
    });
  });
});

describe("resolveSupervisoryCadence", () => {
  const base = {
    armIntervalSeconds: 600,
    armIntervalSource: "config_override" as const,
    deadlineSeconds: 1200,
    deadlineSource: "config_override" as const,
    graceSeconds: 300,
  };

  test("resolves cadence and deadline together when the arm interval fits inside the safe margin", () => {
    const cadence = resolveSupervisoryCadence(base);
    expect(cadence.arm_interval_seconds).toBe(600);
    expect(cadence.deadline_seconds).toBe(1200);
    expect(cadence.max_safe_arm_interval_seconds).toBe(900);
    expect(cadence.wake_driver_attested).toBeFalse();
  });

  test("refuses arm_interval >= deadline at resolve time — the literal req B constraint", () => {
    expect(() => resolveSupervisoryCadence({ ...base, armIntervalSeconds: 1200 })).toThrow(
      HarnessError,
    );
    expect(() => resolveSupervisoryCadence({ ...base, armIntervalSeconds: 1500 })).toThrow(
      HarnessError,
    );
  });

  test("refuses an arm_interval that satisfies req B but not the resolver-computed safe maximum", () => {
    expect(() => resolveSupervisoryCadence({ ...base, armIntervalSeconds: 950 })).toThrow(
      /maximum safe interval/,
    );
  });

  test("refuses a deadline that leaves no safety margin once grace is reserved", () => {
    expect(() =>
      resolveSupervisoryCadence({ ...base, deadlineSeconds: 300, graceSeconds: 300 }),
    ).toThrow(HarnessError);
  });

  test("refuses non-positive or non-integer inputs rather than coercing them", () => {
    expect(() => resolveSupervisoryCadence({ ...base, armIntervalSeconds: 0 })).toThrow(
      HarnessError,
    );
    expect(() => resolveSupervisoryCadence({ ...base, armIntervalSeconds: 599.5 })).toThrow(
      HarnessError,
    );
    expect(() => resolveSupervisoryCadence({ ...base, graceSeconds: -1 })).toThrow(HarnessError);
  });

  test("wake_driver_attested is true only when the driver is explicitly attested true by config_override", () => {
    const attested = resolveSupervisoryCadence({
      ...base,
      wakeDriver: { value: true, source: "config_override" },
    });
    expect(attested.wake_driver_attested).toBeTrue();

    const unattested = resolveSupervisoryCadence({
      ...base,
      wakeDriver: { value: false, source: "unreadable" },
    });
    expect(unattested.wake_driver_attested).toBeFalse();

    const explicitlyOffButAttested = resolveSupervisoryCadence({
      ...base,
      wakeDriver: { value: false, source: "config_override" },
    });
    expect(explicitlyOffButAttested.wake_driver_attested).toBeFalse();
  });

  test("evidence case: a caller staying inside the raw deadline can still be refused by the computed safe margin", () => {
    const evidence = {
      armIntervalSeconds: 1000,
      armIntervalSource: "config_override" as const,
      deadlineSeconds: 1200,
      deadlineSource: "config_override" as const,
      graceSeconds: 300,
    };
    expect(evidence.armIntervalSeconds).toBeLessThan(evidence.deadlineSeconds);
    expect(() => resolveSupervisoryCadence(evidence)).toThrow(/maximum safe interval/);
  });
});
