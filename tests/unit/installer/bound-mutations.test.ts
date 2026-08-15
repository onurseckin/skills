import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  moveBoundPath,
  removeBoundPath,
  replaceBoundPath,
} from "../../../orchestrating-long-tasks/scripts/src/installer/bound-mutations.ts";
import { pathIdentity } from "../../../orchestrating-long-tasks/scripts/src/installer/path-safety.ts";
import { cleanInstallerFixtures, installerFixture } from "./helpers.ts";

afterEach(cleanInstallerFixtures);

describe("identity-bound destructive mutations", () => {
  test("never overwrites an unbound destination racer", async () => {
    const { root } = await installerFixture();
    const source = join(root, "move-source");
    const destination = join(root, "move-destination");
    await writeFile(source, "installer-owned");
    await writeFile(destination, "racer-owned");
    const identity = await pathIdentity(source);

    await expect(moveBoundPath(source, destination, identity!, "owned source")).rejects.toThrow(
      /destination|exists|changed/i,
    );
    expect(await readFile(source, "utf8")).toBe("installer-owned");
    expect(await readFile(destination, "utf8")).toBe("racer-owned");
  });

  test("atomically rejects a replacement racer without displacing it", async () => {
    const { root } = await installerFixture();
    const path = join(root, "published");
    const displaced = join(root, "displaced");
    const replacement = join(root, "replacement");
    await writeFile(path, "expected-old");
    const expected = await pathIdentity(path);
    await writeFile(replacement, "installer-new");
    const replacementIdentity = await pathIdentity(replacement);

    await expect(
      replaceBoundPath(path, expected!, replacement, replacementIdentity!, "publication", {
        async beforeExchange() {
          await rename(path, displaced);
          await writeFile(path, "racer-owned");
        },
      }),
    ).rejects.toThrow(/identity|changed/i);
    expect(await readFile(path, "utf8")).toBe("racer-owned");
    expect(await readFile(replacement, "utf8")).toBe("installer-new");
    expect(await readFile(displaced, "utf8")).toBe("expected-old");
  });

  test("quarantines then restores a replacement instead of deleting an unbound path", async () => {
    const { root } = await installerFixture();
    const path = join(root, "owned");
    const displaced = join(root, "displaced");
    await mkdir(path);
    await writeFile(join(path, "original.txt"), "original");
    const identity = await pathIdentity(path);
    await expect(
      removeBoundPath(path, identity!, "owned path", {
        async beforeRename() {
          await rename(path, displaced);
          await mkdir(path);
          await writeFile(join(path, "racer.txt"), "preserve");
        },
      }),
    ).rejects.toThrow(/identity|changed/i);
    expect(await readFile(join(path, "racer.txt"), "utf8")).toBe("preserve");
    expect(await readFile(join(displaced, "original.txt"), "utf8")).toBe("original");
  });
});
