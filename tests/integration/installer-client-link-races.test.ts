import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, readlink, realpath, symlink, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  applyClientLinks,
  preflightClientLinks,
  type ClientLinkPlan,
} from "../../orchestrating-long-tasks/scripts/src/installer/client-links.ts";
import { cleanInstallerFixtures, installerFixture } from "../unit/installer/helpers.ts";

afterEach(cleanInstallerFixtures);

interface LinkHooks {
  beforePublish?(plan: ClientLinkPlan): Promise<void> | void;
}
const applyWithHooks = applyClientLinks as unknown as (
  plans: readonly ClientLinkPlan[],
  hooks?: LinkHooks,
) => ReturnType<typeof applyClientLinks>;

describe("client link race safety", () => {
  test("preserves a replacement link introduced after apply revalidation", async () => {
    const { home } = await installerFixture();
    const homeRoot = await realpath(home);
    const target = join(homeRoot, ".agents", "skills", "orchestrating-long-tasks");
    const path = join(homeRoot, ".claude", "skills", "orchestrating-long-tasks");
    await mkdir(dirname(path), { recursive: true });
    await symlink(join(homeRoot, "previous-release"), path, "dir");
    const plans = await preflightClientLinks(homeRoot, target, new Set(["claude"]));
    const racer = join(homeRoot, "racer-release");

    await expect(
      applyWithHooks(plans, {
        async beforePublish() {
          await unlink(path);
          await symlink(racer, path, "dir");
        },
      }),
    ).rejects.toThrow();
    expect(await readlink(path)).toBe(racer);
  });

  test("does not overwrite a file created at an absent link path", async () => {
    const { home } = await installerFixture();
    const homeRoot = await realpath(home);
    const target = join(homeRoot, ".agents", "skills", "orchestrating-long-tasks");
    const path = join(homeRoot, ".claude", "skills", "orchestrating-long-tasks");
    const plans = await preflightClientLinks(homeRoot, target, new Set(["claude"]));

    await expect(
      applyWithHooks(plans, {
        async beforePublish() {
          await writeFile(path, "preserve me");
        },
      }),
    ).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe("preserve me");
  });

  test("rollback never unlinks a link that replaced the applied identity", async () => {
    const { home } = await installerFixture();
    const homeRoot = await realpath(home);
    const target = join(homeRoot, ".agents", "skills", "orchestrating-long-tasks");
    const path = join(homeRoot, ".claude", "skills", "orchestrating-long-tasks");
    const plans = await preflightClientLinks(homeRoot, target, new Set(["claude"]));
    const applied = await applyClientLinks(plans);
    const racer = join(homeRoot, "racer-release");
    await unlink(path);
    await symlink(racer, path, "dir");

    let failure: unknown;
    try {
      await applied.rollback();
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors.map(String).join("\n")).toMatch(/changed|identity/i);
    expect(await readlink(path)).toBe(racer);
  });
});
