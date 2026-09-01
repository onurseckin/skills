import { describe, expect, test } from "bun:test";
import {
  parseDurationMs,
  StreamParser,
  stripAnsi,
} from "../../../scripts/testing/runner/stream-parser.ts";
import type { StreamEvent } from "../../../scripts/testing/runner/types.ts";

describe("StreamParser", () => {
  test("stripAnsi removes ANSI color and cursor codes cleanly", () => {
    expect(stripAnsi("\x1b[32m(pass)\x1b[0m test")).toBe("(pass) test");
    expect(stripAnsi("\x1b[1;31mFAIL\x1b[0m")).toBe("FAIL");
    expect(stripAnsi("\x1b[2K\rtest")).toBe("\rtest");
    expect(stripAnsi("plain text without ansi")).toBe("plain text without ansi");
  });

  test("parseDurationMs parses ms, s, and m correctly", () => {
    expect(parseDurationMs("12.50", "ms")).toBe(12.5);
    expect(parseDurationMs("1.5", "s")).toBe(1500);
    expect(parseDurationMs("2", "m")).toBe(120000);
    expect(parseDurationMs("invalid", "ms")).toBe(0);
  });

  test("parses line-by-line single output cleanly", () => {
    const parser = new StreamParser();
    const events: StreamEvent[] = [];
    const unsubscribe = parser.on((e) => events.push(e));

    parser.feed("tests/testing/runner/test-runner.test.ts:\n");
    parser.feed("(pass) suite > test 1 [1.20ms]\n");
    parser.feed("(pass) suite > test 2 [2.50s]\n");
    parser.feed("(skip) suite > test 3 [0.10ms]\n");
    parser.feed("(fail) suite > test 4 [3.00ms]\n");
    parser.feed(" 2 pass\n");
    parser.feed(" 1 fail\n");
    parser.feed(" 10 expect() calls\n");
    parser.feed("Ran 4 tests across 1 files. [150.00ms]\n");
    parser.flush();

    expect(
      events.some(
        (e) => e.type === "suite_start" && e.file === "tests/testing/runner/test-runner.test.ts",
      ),
    ).toBe(true);
    expect(
      events.some(
        (e) => e.type === "test_pass" && e.name === "suite > test 1" && e.durationMs === 1.2,
      ),
    ).toBe(true);
    expect(
      events.some(
        (e) => e.type === "test_pass" && e.name === "suite > test 2" && e.durationMs === 2500,
      ),
    ).toBe(true);
    expect(events.some((e) => e.type === "test_skip" && e.name === "suite > test 3")).toBe(true);
    expect(
      events.some(
        (e) => e.type === "test_fail" && e.name === "suite > test 4" && e.durationMs === 3,
      ),
    ).toBe(true);

    const stats = parser.getStats();
    expect(stats.suitesTotal).toBe(1);
    expect(stats.suitesFailed).toBe(1);
    expect(stats.suitesPassed).toBe(0);
    expect(stats.testsPassed).toBe(2);
    expect(stats.testsFailed).toBe(1);
    expect(stats.testsSkipped).toBe(1);
    expect(stats.expectCalls).toBe(10);
    expect(stats.durationMs).toBe(150);
    expect(stats.failedSuites).toContain("tests/testing/runner/test-runner.test.ts");
    expect(stats.failedTests.length).toBe(1);
    expect(stats.failedTests[0].test).toBe("suite > test 4");

    unsubscribe();
  });

  test("handles chunked inputs split across arbitrary boundaries", () => {
    const parser = new StreamParser();
    const events: StreamEvent[] = [];
    parser.on((e) => events.push(e));

    const fullOutput =
      "tests/example.test.ts:\n(pass) unit > works [0.50ms]\n 1 pass\nRan 1 tests across 1 files. [10.00ms]\n";

    for (let i = 0; i < fullOutput.length; i += 3) {
      parser.feed(fullOutput.slice(i, i + 3));
    }
    parser.flush();

    expect(parser.getStats().testsPassed).toBe(1);
    expect(parser.getStats().suitesTotal).toBe(1);
    expect(parser.getStats().durationMs).toBe(10);
  });

  test("handles checkmark and cross symbols in test output", () => {
    const parser = new StreamParser();
    parser.feed("tests/unit.test.ts:\n");
    parser.feed("✓ checkmark test [0.45ms]\n");
    parser.feed("✗ cross failed test [1.20ms]\n");
    parser.feed("~ tilde skipped test\n");
    parser.flush();

    const stats = parser.getStats();
    expect(stats.testsPassed).toBe(1);
    expect(stats.testsFailed).toBe(1);
    expect(stats.testsSkipped).toBe(1);
    expect(stats.failedTests[0].test).toBe("cross failed test");
  });

  test("handles Uint8Array input and stderr stream", () => {
    const parser = new StreamParser();
    const encoder = new TextEncoder();
    parser.feed(encoder.encode("tests/stderr.test.ts:\n"), "stderr");
    parser.feed(encoder.encode("(fail) stderr test\n"), "stderr");
    parser.flush();

    expect(parser.getStats().testsFailed).toBe(1);
    expect(parser.getStats().suitesFailed).toBe(1);
  });

  test("reset() clears all accumulated buffers and stats", () => {
    const parser = new StreamParser();
    parser.feed("tests/a.test.ts:\n(pass) t1\n");
    expect(parser.getStats().testsPassed).toBe(1);

    parser.reset();
    expect(parser.getStats().testsPassed).toBe(0);
    expect(parser.getStats().suitesTotal).toBe(0);
    expect(parser.getActiveSuite()).toBeNull();
  });
});
