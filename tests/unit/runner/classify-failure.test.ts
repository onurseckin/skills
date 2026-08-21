import { describe, expect, test } from "bun:test";
import {
  classifySignals,
  inspectFailureText,
} from "../../../orchestrating-long-tasks/scripts/src/runner/classify-failure.ts";

describe("inspectFailureText", () => {
  test("detects authorization failures", () => {
    expect(inspectFailureText("401 Unauthorized").authorization).toBe(true);
    expect(inspectFailureText("permission denied").authorization).toBe(true);
  });

  test("detects test failures", () => {
    expect(inspectFailureText("AssertionError: expected true").testFailure).toBe(true);
    expect(inspectFailureText("2 tests failed").testFailure).toBe(true);
  });

  test("detects transient network failures", () => {
    expect(inspectFailureText("connection reset by peer").networkTransient).toBe(true);
    expect(inspectFailureText("EAI_AGAIN").networkTransient).toBe(true);
  });

  test("reports no signals for unrelated text", () => {
    expect(inspectFailureText("all good here")).toEqual({
      authorization: false,
      networkTransient: false,
      testFailure: false,
    });
  });
});

describe("classifySignals", () => {
  const noSignals = { authorization: false, networkTransient: false, testFailure: false };

  test("returns undefined for a clean successful run", () => {
    expect(classifySignals(0, noSignals, null)).toBeUndefined();
  });

  test("classifies a timeout regardless of other signals", () => {
    expect(classifySignals(0, { ...noSignals, authorization: true }, "wall")).toBe("timeout");
    expect(classifySignals(null, noSignals, "idle")).toBe("timeout");
  });

  test("classifies authorization failures", () => {
    expect(classifySignals(1, { ...noSignals, authorization: true }, null)).toBe("authorization");
  });

  test("classifies test failures", () => {
    expect(classifySignals(1, { ...noSignals, testFailure: true }, null)).toBe("test_failure");
  });

  test("classifies host interruption when flagged and no higher-priority signal applies", () => {
    expect(classifySignals(1, noSignals, null, true)).toBe("host_interruption");
  });

  test("classifies network-transient failures", () => {
    expect(classifySignals(1, { ...noSignals, networkTransient: true }, null)).toBe(
      "network_transient",
    );
  });

  test("falls back to unknown for an unexplained nonzero exit", () => {
    expect(classifySignals(1, noSignals, null)).toBe("unknown");
  });

  test("still classifies a nonzero exit even when host interruption is false", () => {
    expect(classifySignals(2, noSignals, null, false)).toBe("unknown");
  });

  test("prioritizes authorization over host interruption", () => {
    expect(classifySignals(1, { ...noSignals, authorization: true }, null, true)).toBe(
      "authorization",
    );
  });

  test("treats a null exit code with host interruption as a failure needing classification", () => {
    expect(classifySignals(null, noSignals, null, true)).toBe("host_interruption");
  });
});
