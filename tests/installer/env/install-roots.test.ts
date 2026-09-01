import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { validatedHome } from "../../../olt/scripts/src/installer/install-roots.ts";
import { scratchRoot } from "../../shared/fixtures/scratch-root.ts";
import { cleanupVirtualInstallerFS, setupVirtualInstallerFS } from "../helpers.ts";

beforeEach(setupVirtualInstallerFS);
afterEach(cleanupVirtualInstallerFS);

describe("validatedHome", () => {
  test("creates a brand new home directory and returns its real path", async () => {
    const root = scratchRoot(import.meta.path, "create-new");
    const source = join(root, "source");
    mkdirSync(source);
    const requestedHome = join(root, "new-home", "nested");
    const home = await validatedHome(source, requestedHome);
    expect(home).toBe(realpathSync(requestedHome));
  });

  test("accepts an already-existing home directory", async () => {
    const root = scratchRoot(import.meta.path, "existing-home");
    const source = join(root, "source");
    const home = join(root, "home");
    mkdirSync(source);
    mkdirSync(home);
    expect(await validatedHome(source, home)).toBe(realpathSync(home));
  });

  test("rejects a home path that already exists as a symlink", async () => {
    const root = scratchRoot(import.meta.path, "home-is-symlink");
    const source = join(root, "source");
    const real = join(root, "real-home");
    mkdirSync(source);
    mkdirSync(real);
    const link = join(root, "home-link");
    symlinkSync(real, link);
    await expect(validatedHome(source, link)).rejects.toThrow(HarnessError);
  });

  test("rejects a home path that already exists as a plain file", async () => {
    const root = scratchRoot(import.meta.path, "home-is-file");
    const source = join(root, "source");
    mkdirSync(source);
    const file = join(root, "home-file");
    writeFileSync(file, "not a directory");
    await expect(validatedHome(source, file)).rejects.toThrow(HarnessError);
  });

  test("rejects when the requested home is nested inside the source", async () => {
    const root = scratchRoot(import.meta.path, "home-inside-source");
    const source = join(root, "source");
    mkdirSync(source);
    await expect(validatedHome(source, join(source, "home"))).rejects.toThrow(HarnessError);
    try {
      await validatedHome(source, join(source, "home"));
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(HarnessError);
      expect((error as HarnessError).code).toBe("INVALID_ARGUMENT");
    }
  });

  test("accepts a source checkout nested inside the requested home", async () => {
    const root = scratchRoot(import.meta.path, "source-inside-home");
    const home = join(root, "home");
    const source = join(home, "source");
    mkdirSync(home);
    mkdirSync(source, { recursive: true });
    expect(await validatedHome(source, home)).toBe(realpathSync(home));
  });

  test("rejects when source and home are the exact same directory", async () => {
    const root = scratchRoot(import.meta.path, "same-directory");
    const shared = join(root, "shared");
    mkdirSync(shared);
    await expect(validatedHome(shared, shared)).rejects.toThrow(HarnessError);
  });

  test("propagates a non-ENOENT failure from the initial home lstat instead of treating it as absent", async () => {
    const root = scratchRoot(import.meta.path, "home-lstat-eacces");
    const source = join(root, "source");
    mkdirSync(source);
    const blocked = join(root, "blocked-parent");
    mkdirSync(blocked, { mode: 0o000 });
    try {
      await expect(validatedHome(source, join(blocked, "home"))).rejects.toMatchObject({
        code: "EACCES",
      });
    } finally {
      chmodSync(blocked, 0o755);
    }
  });

  test("rejects when candidate home resolves through symlinked ancestor into source", async () => {
    const root = scratchRoot(import.meta.path, "symlink-ancestor-overlap");
    const source = join(root, "source");
    const inner = join(source, "inner");
    mkdirSync(source);
    mkdirSync(inner);
    const outside = join(root, "outside-symlink");
    symlinkSync(inner, outside);
    const requested = join(outside, "nested", "home");
    await expect(validatedHome(source, requested)).rejects.toThrow(
      "skill source and home must not overlap",
    );
  });
});
