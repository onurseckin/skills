import { describe, expect, test } from "bun:test";
import {
  formatElapsedSeconds,
  isInteractiveTerminal,
  TerminalTicker,
} from "../../../scripts/testing/runner/terminal-ticker.ts";
import { createDefaultRunnerStats } from "../../../scripts/testing/runner/types.ts";

describe("terminal-ticker", () => {
  test("isInteractiveTerminal resolves options and environment flags correctly", () => {
    expect(isInteractiveTerminal({ interactive: true })).toBe(true);
    expect(isInteractiveTerminal({ interactive: false })).toBe(false);

    const oldCI = process.env.CI;
    const oldTerm = process.env.TERM;
    try {
      process.env.CI = "true";
      expect(isInteractiveTerminal()).toBe(false);

      delete process.env.CI;
      process.env.TERM = "dumb";
      expect(isInteractiveTerminal()).toBe(false);
    } finally {
      if (oldCI !== undefined) process.env.CI = oldCI;
      else delete process.env.CI;
      if (oldTerm !== undefined) process.env.TERM = oldTerm;
      else delete process.env.TERM;
    }
  });

  test("formatElapsedSeconds formats milliseconds and seconds correctly", () => {
    expect(formatElapsedSeconds(0)).toBe("0ms");
    expect(formatElapsedSeconds(450)).toBe("450ms");
    expect(formatElapsedSeconds(1000)).toBe("1.00s");
    expect(formatElapsedSeconds(2456)).toBe("2.46s");
  });

  test("TerminalTicker interactive mode renders and updates smoothly", async () => {
    const written: string[] = [];
    const mockOut = {
      write: (str: string) => {
        written.push(str);
        return true;
      },
    } as unknown as NodeJS.WritableStream;

    const ticker = new TerminalTicker({
      interactive: true,
      updateCadenceMs: 20,
      stdout: mockOut,
    });

    expect(ticker.getIsInteractive()).toBe(true);
    ticker.start();
    expect(written.length).toBeGreaterThan(0);
    expect(written[0]).toContain("\r\x1b[2K");

    const stats = createDefaultRunnerStats();
    stats.testsPassed = 5;
    stats.testsFailed = 1;
    ticker.tick(stats, "tests/unit.test.ts");

    ticker.onStreamEvent({ type: "suite_start", file: "tests/foo.test.ts" }, stats);

    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(written.some((w) => w.includes("5 passed"))).toBe(true);
    expect(written.some((w) => w.includes("1 failed"))).toBe(true);

    ticker.stop();
  });

  test("TerminalTicker non-interactive mode gracefully logs milestones without ANSI escapes", () => {
    const written: string[] = [];
    const mockOut = {
      write: (str: string) => {
        written.push(str);
        return true;
      },
    } as unknown as NodeJS.WritableStream;

    const ticker = new TerminalTicker({
      interactive: false,
      stdout: mockOut,
    });

    expect(ticker.getIsInteractive()).toBe(false);
    ticker.start();
    expect(written.length).toBe(0);

    const stats = createDefaultRunnerStats();
    ticker.onStreamEvent({ type: "suite_start", file: "tests/batch.test.ts" }, stats);
    expect(written).toEqual(["[suite] tests/batch.test.ts\n"]);

    ticker.onStreamEvent(
      {
        type: "test_fail",
        suite: "tests/batch.test.ts",
        name: "test assertion failed",
      },
      stats,
    );
    expect(written).toEqual([
      "[suite] tests/batch.test.ts\n",
      "[fail] tests/batch.test.ts > test assertion failed\n",
    ]);

    ticker.tick(stats, "tests/batch.test.ts");
    ticker.stop();
    // In non-interactive mode, stop does not write ANSI clearLine
    expect(written.length).toBe(2);
  });
});
