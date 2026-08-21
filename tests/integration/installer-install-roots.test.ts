import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validatedHome } from "../../orchestrating-long-tasks/scripts/src/installer/install-roots.ts";
import { cleanInstallerFixtures, installerFixture } from "../unit/installer/helpers.ts";

afterEach(cleanInstallerFixtures);

describe("installer install-roots", () => {
  test("accepts a valid existing home directory", async () => {
    const { source, home } = await installerFixture();
    const result = await validatedHome(source, home);
    const expected = await realpath(home);
    expect(result).toBe(expected);
  });

  test("creates and canonicalizes nested missing home directories", async () => {
    const { source, root } = await installerFixture();
    const missingHome = join(root, "nested", "custom", "home");
    const result = await validatedHome(source, missingHome);
    const realRoot = await realpath(root);
    expect(result).toBe(join(realRoot, "nested", "custom", "home"));
  });

  test("rejects when existing home is a file", async () => {
    const { source, root } = await installerFixture();
    const filePath = join(root, "file-home");
    await writeFile(filePath, "content");
    await expect(validatedHome(source, filePath)).rejects.toThrow(
      /home must be a real directory, not a symlink/,
    );
  });

  test("rejects when existing home is a symlink", async () => {
    const { source, root, home } = await installerFixture();
    const linkPath = join(root, "symlink-home");
    await symlink(home, linkPath);
    await expect(validatedHome(source, linkPath)).rejects.toThrow(
      /home must be a real directory, not a symlink/,
    );
  });

  test("rejects when source and home overlap (same directory)", async () => {
    const { source } = await installerFixture();
    await expect(validatedHome(source, source)).rejects.toThrow(
      /skill source and home must not overlap/,
    );
  });

  test("rejects when source is inside home", async () => {
    const { root } = await installerFixture();
    const homeDir = join(root, "overlap-parent");
    const sourceDir = join(homeDir, "source");
    await mkdir(sourceDir, { recursive: true });
    await expect(validatedHome(sourceDir, homeDir)).rejects.toThrow(
      /skill source and home must not overlap/,
    );
  });

  test("rejects when home is inside source", async () => {
    const { source } = await installerFixture();
    const childHome = join(source, "sub-home");
    await expect(validatedHome(source, childHome)).rejects.toThrow(
      /skill source and home must not overlap/,
    );
  });

  test("rethrows unexpected error from lstat", async () => {
    const { source } = await installerFixture();
    // Path containing null character causes EINVAL error in lstat (not ENOENT)
    await expect(validatedHome(source, "invalid\0path")).rejects.toThrow();
  });
});
