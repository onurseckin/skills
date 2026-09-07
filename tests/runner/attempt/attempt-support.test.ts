import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  activityMetadata,
  raceWithTimeout,
  settleBounded,
  settleTrackerBeforeOutcome,
} from "../../../olt/scripts/src/engine/runner/models/attempt/attempt-support.ts";
import { writeAttemptStarted } from "../../../olt/scripts/src/engine/runner/execution/attempt-intent.ts";
import { createCommandSigningCapability } from "../../../olt/scripts/src/engine/runner/execution/attempt-disposition-capability.ts";
import {
  tempRoot,
  setupVirtualRunnerFS,
  cleanupVirtualRunnerFS,
} from "../command/fixture.ts";
import type { VirtualMemoryFS } from "../../../olt/scripts/src/testing/virtual-fs/memory-fs.ts";

let vfs: VirtualMemoryFS;

function scratchDir(): string {
  return tempRoot("attempt-support");
}

beforeEach(() => {
  vfs = setupVirtualRunnerFS();
});

afterEach(cleanupVirtualRunnerFS);

describe("raceWithTimeout", () => {
  test("resolves with the work result when it settles before the timeout", async () => {
    await expect(raceWithTimeout(Promise.resolve("done"), 50, "too slow")).resolves.toBe("done");
  });

  test("rejects with the timeout message once the deadline elapses", async () => {
    await expect(raceWithTimeout(new Promise(() => undefined), 5, "took too long")).rejects.toThrow(
      "took too long",
    );
  });

  test("propagates a rejection from the work itself", async () => {
    await expect(raceWithTimeout(Promise.reject(new Error("boom")), 50, "unused")).rejects.toThrow(
      "boom",
    );
  });

  test("rejects immediately when deadline is 0ms on unsettled promise", async () => {
    await expect(
      raceWithTimeout(new Promise(() => undefined), 0, "immediate timeout"),
    ).rejects.toThrow("immediate timeout");
  });
});

describe("settleBounded", () => {
  test("returns true once every promise settles within the deadline", async () => {
    await expect(
      settleBounded([Promise.resolve(1), Promise.reject(new Error("ignored"))], 50),
    ).resolves.toBe(true);
  });

  test("returns false when promises have not settled before the deadline", async () => {
    await expect(settleBounded([new Promise(() => undefined)], 5)).resolves.toBe(false);
  });
});

describe("settleTrackerBeforeOutcome", () => {
  test("returns the outcome after the tracker settles successfully", async () => {
    let trackerSettled = false;
    const tracker = Promise.resolve().then(() => {
      trackerSettled = true;
    });
    const result = await settleTrackerBeforeOutcome(Promise.resolve("outcome"), tracker);
    expect(result).toBe("outcome");
    expect(trackerSettled).toBe(true);
  });

  test("still returns the outcome when the tracker promise rejects", async () => {
    const result = await settleTrackerBeforeOutcome(
      Promise.resolve("outcome"),
      Promise.reject(new Error("tracker failed")),
    );
    expect(result).toBe("outcome");
  });

  test("propagates a rejected outcome after waiting on the tracker", async () => {
    await expect(
      settleTrackerBeforeOutcome(Promise.reject(new Error("outcome failed")), Promise.resolve()),
    ).rejects.toThrow("outcome failed");
  });
});

describe("activityMetadata", () => {
  test("reports byte length and digest for the file contents", () => {
    const root = scratchDir();
    const path = join(root, "activity.json");
    const contents = Buffer.from('{"status":"running"}');
    vfs.writeFileSync(path, contents);
    const result = activityMetadata(path, "attempt-1/activity.json");
    expect(result).toEqual({
      path: "attempt-1/activity.json",
      bytes: contents.byteLength,
      sha256: createHash("sha256").update(contents).digest("hex"),
    });
  });

  test("reports zero byte length and empty sha256 for empty file", () => {
    const root = scratchDir();
    const path = join(root, "empty-activity.json");
    vfs.writeFileSync(path, Buffer.alloc(0));
    const result = activityMetadata(path, "attempt-1/empty-activity.json");
    expect(result).toEqual({
      path: "attempt-1/empty-activity.json",
      bytes: 0,
      sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    });
  });
});

describe("writeAttemptStarted directory durability", () => {
  test("fsyncs the command directory entry before a started marker can precede spawn", () => {
    const root = scratchDir();
    const commandRoot = join(root, "commands", "C-durable");
    const attemptRoot = join(commandRoot, "attempt-1");
    vfs.mkdirSync(attemptRoot, { recursive: true });
    let synced: string | undefined;

    const record = writeAttemptStarted(
      attemptRoot,
      "C-durable",
      1,
      "2026-08-14T00:00:00.000Z",
      "ownership-token",
      createCommandSigningCapability(),
      (path) => {
        synced = path;
      },
    );

    expect(synced).toBe(commandRoot);
    expect(record.command_id).toBe("C-durable");
  });

  test("writeAttemptStarted works with default fsyncDirectory parameter", () => {
    const root = scratchDir();
    const commandRoot = join(root, "commands", "C-default");
    const attemptRoot = join(commandRoot, "attempt-1");
    vfs.mkdirSync(attemptRoot, { recursive: true });

    const record = writeAttemptStarted(
      attemptRoot,
      "C-default",
      1,
      "2026-08-14T00:00:00.000Z",
      "ownership-token",
      createCommandSigningCapability(),
    );

    expect(record.command_id).toBe("C-default");
    expect(record.status).toBe("running");
  });
});
