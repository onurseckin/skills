import { describe, expect, test } from "bun:test";
import { monitorProcess } from "../../../orchestrating-long-tasks/scripts/src/runner/watchdog.ts";
import type { BunSubprocess } from "../../../orchestrating-long-tasks/scripts/src/runner/types.ts";

function fakeChild(exited: Promise<number>): BunSubprocess {
  return { pid: 1234, exited } as never;
}

describe("monitorProcess", () => {
  test("resolves with the exit code once the child exits", async () => {
    const outcome = await monitorProcess(
      fakeChild(Promise.resolve(0)),
      Date.now(),
      () => Date.now(),
      10_000,
      10_000,
      () => undefined,
    );
    expect(outcome).toEqual({ code: 0, timeout: null, interrupted: false });
  });

  test("resolves as interrupted immediately when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const outcome = await monitorProcess(
      fakeChild(new Promise(() => undefined)),
      Date.now(),
      () => Date.now(),
      10_000,
      10_000,
      () => undefined,
      controller.signal,
    );
    expect(outcome).toEqual({ code: null, timeout: null, interrupted: true });
  });

  test("resolves as interrupted once the signal aborts mid-flight", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5);
    const outcome = await monitorProcess(
      fakeChild(new Promise(() => undefined)),
      Date.now(),
      () => Date.now(),
      10_000,
      10_000,
      () => undefined,
      controller.signal,
    );
    expect(outcome).toEqual({ code: null, timeout: null, interrupted: true });
  });

  test("reports a wall-clock timeout and invokes the heartbeat while polling", async () => {
    let heartbeats = 0;
    const started = Date.now() - 1_000;
    const outcome = await monitorProcess(
      fakeChild(new Promise(() => undefined)),
      started,
      () => Date.now(),
      10,
      10_000,
      () => {
        heartbeats += 1;
      },
    );
    expect(outcome).toEqual({ code: null, timeout: "wall", interrupted: false });
    expect(heartbeats).toBeGreaterThan(0);
  });

  test("reports an idle timeout when activity has gone stale", async () => {
    const activitySince = Date.now() - 1_000;
    const outcome = await monitorProcess(
      fakeChild(new Promise(() => undefined)),
      Date.now(),
      () => activitySince,
      10_000,
      10,
      () => undefined,
    );
    expect(outcome).toEqual({ code: null, timeout: "idle", interrupted: false });
  });
});

describe("Invariants & Cleanliness Audit - Runner Watchdog", () => {
  test("zero TypeScript any and zero suppressions across runner watchdog files", () => {
    const { readFileSync } = require("node:fs");
    const { join } = require("node:path");
    const sourceFiles = [
      join(__dirname, "../../../orchestrating-long-tasks/scripts/src/runner/watchdog.ts"),
      __filename,
    ];

    const anyAnnotation = new RegExp(":\\s*any\\b");
    const anyCast = new RegExp("as\\s+any\\b");
    const anyGeneric = new RegExp("<\\s*any\\s*>");
    const tsIgnore = "@" + "ts-ignore";
    const tsExpectError = "@" + "ts-expect-error";
    const tsNoCheck = "@" + "ts-nocheck";
    const suppressionDirectiveA = "eslint" + "-disable";
    const suppressionDirectiveB = "oxlint" + "-disable";

    for (const filePath of sourceFiles) {
      const content = readFileSync(filePath, "utf8");

      expect(content).not.toMatch(anyAnnotation);
      expect(content).not.toMatch(anyCast);
      expect(content).not.toMatch(anyGeneric);
      expect(content.includes(tsIgnore)).toBe(false);
      expect(content.includes(tsExpectError)).toBe(false);
      expect(content.includes(tsNoCheck)).toBe(false);
      expect(content.includes(suppressionDirectiveA)).toBe(false);
      expect(content.includes(suppressionDirectiveB)).toBe(false);
    }
  });
});
