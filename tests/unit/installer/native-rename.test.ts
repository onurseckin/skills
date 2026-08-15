import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  exchangePaths,
  renameNoReplace,
} from "../../../orchestrating-long-tasks/scripts/src/installer/native-rename.ts";
import { cleanInstallerFixtures, installerFixture } from "./helpers.ts";

afterEach(cleanInstallerFixtures);

describe("installer native rename", () => {
  test("renameNoReplace moves a directory to a new path", async () => {
    const { root } = await installerFixture();
    const sourceDir = join(root, "dir-a");
    const destDir = join(root, "dir-b");
    await mkdir(sourceDir);
    await writeFile(join(sourceDir, "file.txt"), "hello");

    renameNoReplace(sourceDir, destDir, "test move");
    expect(await readFile(join(destDir, "file.txt"), "utf8")).toBe("hello");
  });

  test("renameNoReplace rejects when destination already exists", async () => {
    const { root } = await installerFixture();
    const sourceDir = join(root, "source-exists");
    const destDir = join(root, "dest-exists");
    await mkdir(sourceDir);
    await mkdir(destDir);

    expect(() => renameNoReplace(sourceDir, destDir, "test replace")).toThrow(
      /destination already exists/,
    );
  });

  test("renameNoReplace rejects when source does not exist", async () => {
    const { root } = await installerFixture();
    const sourceDir = join(root, "missing-src");
    const destDir = join(root, "dest-new");

    expect(() => renameNoReplace(sourceDir, destDir, "test missing")).toThrow(
      /rename failed with errno/,
    );
  });

  test("exchangePaths atomically swaps two directories", async () => {
    const { root } = await installerFixture();
    const dirA = join(root, "dir-alpha");
    const dirB = join(root, "dir-beta");
    await mkdir(dirA);
    await mkdir(dirB);
    await writeFile(join(dirA, "marker.txt"), "alpha");
    await writeFile(join(dirB, "marker.txt"), "beta");

    exchangePaths(dirA, dirB, "test swap");

    expect(await readFile(join(dirA, "marker.txt"), "utf8")).toBe("beta");
    expect(await readFile(join(dirB, "marker.txt"), "utf8")).toBe("alpha");
  });

  test("exchangePaths rejects when one of the paths does not exist", async () => {
    const { root } = await installerFixture();
    const dirA = join(root, "dir-exists");
    const dirB = join(root, "dir-missing");
    await mkdir(dirA);

    expect(() => exchangePaths(dirA, dirB, "test swap missing")).toThrow(
      /rename failed with errno/,
    );
  });
});
