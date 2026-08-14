import { afterEach, describe, expect, test } from "bun:test";
import { lstat, mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { installSkill } from "../../src/installer/install.ts";
import { installationStatus } from "../../src/installer/installation-status.ts";
import { cleanInstallerFixtures, installerFixture } from "./helpers.ts";

afterEach(cleanInstallerFixtures);

type InstallOptions = { platform?: NodeJS.Platform };
const installWithOptions = installSkill as unknown as (
  source: string,
  home: string,
  clients: readonly string[],
  options?: InstallOptions,
) => ReturnType<typeof installSkill>;

describe("installer path identity", () => {
  test("rejects a symlinked canonical ancestor beneath the validated home", async () => {
    const { root, source, home } = await installerFixture();
    const outside = join(root, "outside-agents");
    await mkdir(outside);
    await symlink(outside, join(home, ".agents"));

    await expect(installSkill(source, home, [])).rejects.toThrow(/ancestor|symlink|unsafe/i);
    expect(await lstat(join(outside, "skills")).catch(() => null)).toBeNull();
  });

  test("rejects a symlinked client ancestor before publishing the release", async () => {
    const { root, source, home } = await installerFixture();
    const outside = join(root, "outside-claude");
    await mkdir(outside);
    await symlink(outside, join(home, ".claude"));

    await expect(installSkill(source, home, ["claude"])).rejects.toThrow(
      /ancestor|symlink|unsafe/i,
    );
    expect(
      await lstat(join(home, ".agents", "skills", "orchestrating-long-tasks")).catch(() => null),
    ).toBeNull();
  });

  test("rejects a symlink passed as the home instead of canonicalizing through it", async () => {
    const { root, source, home } = await installerFixture();
    const alias = join(root, "home-alias");
    await symlink(home, alias);

    await expect(installSkill(source, alias, [])).rejects.toThrow(/home|symlink|directory/i);
  });

  test("fails before filesystem mutation on an unsupported platform", async () => {
    const { source, home } = await installerFixture();

    await expect(installWithOptions(source, home, [], { platform: "win32" })).rejects.toThrow(
      /unsupported/i,
    );
    expect(await lstat(join(home, ".agents")).catch(() => null)).toBeNull();
  });

  test("doctor fails consistently on an unsupported platform", async () => {
    const { source, home } = await installerFixture();
    const statusWithOptions = installationStatus as unknown as (
      source: string,
      home: string,
      clients: readonly string[] | undefined,
      options: InstallOptions,
    ) => ReturnType<typeof installationStatus>;

    await expect(statusWithOptions(source, home, undefined, { platform: "win32" })).rejects.toThrow(
      /unsupported/i,
    );
  });
});
