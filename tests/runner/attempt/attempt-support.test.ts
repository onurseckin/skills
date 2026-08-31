import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  activityMetadata,
  raceWithTimeout,
  settleBounded,
  settleTrackerBeforeOutcome,
} from "../../../olt/scripts/src/engine/runner/models/attempt/attempt-support.ts";

const roots: string[] = [];

function scratchDir(): string {
  const root = mkdtempSync(join(tmpdir(), "attempt-support-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

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
    writeFileSync(path, contents);
    const result = activityMetadata(path, "attempt-1/activity.json");
    expect(result).toEqual({
      path: "attempt-1/activity.json",
      bytes: contents.byteLength,
      sha256: createHash("sha256").update(contents).digest("hex"),
    });
  });
});
