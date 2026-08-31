import { describe, expect, test } from "bun:test";
import {
  checkPushbackQuotas,
  MIN_ADVERSARIAL_PROBES,
  MANDATORY_COGNITIVE_PUSHBACKS,
} from "../../../olt/scripts/src/reporting/doctor/pushback-quotas-engine.ts";

export const pushbackQuotasEngineSuiteName = "Wave 2 - Task 2.3: Mandatory Pushback & Adversarial Probe Quota Engine";

describe(pushbackQuotasEngineSuiteName, () => {
  test("enforces MIN_ADVERSARIAL_PROBES = 5 and MANDATORY_COGNITIVE_PUSHBACKS = 5 constants", () => {
    expect(MIN_ADVERSARIAL_PROBES).toBe(5);
    expect(MANDATORY_COGNITIVE_PUSHBACKS).toBe(5);
  });

  test("passes completed task satisfying 5 probes and 5 pushbacks", () => {
    const result = checkPushbackQuotas({
      tasks: {
        "task-1": {
          id: "task-1",
          status: "completed",
          adversarial_probes: [1, 2, 3, 4, 5],
          cognitive_pushbacks: [1, 2, 3, 4, 5],
        },
      },
    });
    expect(result.passed).toBe(true);
    expect(result.findings.filter((f) => f.severity === "ERROR")).toHaveLength(0);
  });

  test("flags completed task failing to meet quota with ERROR", () => {
    const result = checkPushbackQuotas({
      tasks: {
        "task-deficit": {
          id: "task-deficit",
          status: "completed",
          adversarial_probes: [1, 2],
          cognitive_pushbacks: [1, 2, 3],
        },
      },
    });
    expect(result.passed).toBe(false);
    expect(
      result.findings.some((f) => f.code === "PUSHBACK_QUOTA_ADVERSARIAL_PROBES_DEFICIT"),
    ).toBe(true);
    expect(
      result.findings.some((f) => f.code === "PUSHBACK_QUOTA_COGNITIVE_PUSHBACKS_DEFICIT"),
    ).toBe(true);
  });

  test("reports INFO status for in-flight tasks without failing check", () => {
    const result = checkPushbackQuotas({
      tasks: {
        "task-open": {
          id: "task-open",
          status: "in_progress",
          adversarial_probes: [1, 2],
          cognitive_pushbacks: [1],
        },
      },
    });
    expect(result.passed).toBe(true);
    expect(result.findings.some((f) => f.code === "PUSHBACK_QUOTA_IN_FLIGHT_STATUS")).toBe(true);
  });
});
