import { describe, expect, test } from "bun:test";
import {
  MAX_POLL_DELAY_MS,
  MIN_POLL_DELAY_MS,
  nextPollDelayMs,
} from "../../../olt/scripts/src/engine/runner/reconciliation/descendant-poll-policy.ts";

describe("descendant poll policy", () => {
  test("resets to the minimum delay when a new descendant was discovered", () => {
    expect(nextPollDelayMs(200, true)).toBe(MIN_POLL_DELAY_MS);
  });

  test("doubles the delay when no new descendant was discovered", () => {
    expect(nextPollDelayMs(MIN_POLL_DELAY_MS, false)).toBe(MIN_POLL_DELAY_MS * 2);
  });

  test("caps the backoff at the maximum poll delay", () => {
    expect(nextPollDelayMs(MAX_POLL_DELAY_MS, false)).toBe(MAX_POLL_DELAY_MS);
    expect(nextPollDelayMs(MAX_POLL_DELAY_MS - 1, false)).toBe(MAX_POLL_DELAY_MS);
  });
});
