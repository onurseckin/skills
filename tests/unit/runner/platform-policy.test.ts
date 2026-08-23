import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertRunnerPlatform,
  reserveCommandRoot,
} from "../../../olt/scripts/src/runner/platform-policy.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("assertRunnerPlatform", () => {
  test("accepts darwin and linux", () => {
    expect(() => assertRunnerPlatform("darwin")).not.toThrow();
    expect(() => assertRunnerPlatform("linux")).not.toThrow();
  });

  test("rejects any other platform", () => {
    expect(() => assertRunnerPlatform("win32")).toThrow(
      "monitored commands are unsupported on win32; POSIX process groups are required",
    );
  });

  test("defaults to the real process.platform when unspecified", () => {
    expect(() => assertRunnerPlatform()).not.toThrow();
  });
});

describe("reserveCommandRoot", () => {
  test("reserves a fresh directory using the provided id generator", async () => {
    const parent = await mkdtemp(join(tmpdir(), "reserve-command-root-"));
    roots.push(parent);
    const reserved = await reserveCommandRoot(parent, () => "fixed-id");
    expect(reserved).toEqual({ id: "fixed-id", path: join(parent, "fixed-id") });
  });

  test("retries past an id collision until a free id is found", async () => {
    const parent = await mkdtemp(join(tmpdir(), "reserve-command-root-collision-"));
    roots.push(parent);
    // Pre-create the first id's directory so the first attempt collides (EEXIST) and the
    // function must retry with the generator's next value.
    await reserveCommandRoot(parent, () => "taken");
    const ids = ["taken", "taken", "free"];
    const reserved = await reserveCommandRoot(parent, () => ids.shift()!);
    expect(reserved).toEqual({ id: "free", path: join(parent, "free") });
  });

  test("throws after exhausting the maximum number of collision retries", async () => {
    const parent = await mkdtemp(join(tmpdir(), "reserve-command-root-exhausted-"));
    roots.push(parent);
    await reserveCommandRoot(parent, () => "always-taken");
    await expect(reserveCommandRoot(parent, () => "always-taken", 3)).rejects.toThrow(
      "could not reserve a collision-free command ID",
    );
  });

  test("propagates a non-collision filesystem error immediately", async () => {
    const missingParent = join(tmpdir(), `reserve-command-root-missing-${Date.now()}`);
    await expect(reserveCommandRoot(missingParent, () => "id")).rejects.toThrow();
  });
});
