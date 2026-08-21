import { afterEach, describe, expect, test } from "bun:test";
import { lstat, mkdir, readlink, realpath, symlink, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  applyClientLinks,
  clientLinkPaths,
  preflightClientLinks,
} from "../../orchestrating-long-tasks/scripts/src/installer/client-links.ts";
import { cleanInstallerFixtures, installerFixture } from "../unit/installer/helpers.ts";

afterEach(cleanInstallerFixtures);

describe("installer client links", () => {
  test("clientLinkPaths returns expected paths for claude and antigravity", async () => {
    const { home: rawHome } = await installerFixture();
    const home = await realpath(rawHome);
    const paths = clientLinkPaths(home);
    expect(paths["claude"]).toBe(join(home, ".claude", "skills", "orchestrating-long-tasks"));
    expect(paths["antigravity"]).toBe(
      join(home, ".gemini", "config", "skills", "orchestrating-long-tasks"),
    );
  });

  test("preflightClientLinks generates plans for selected clients", async () => {
    const { home: rawHome, source: rawSource } = await installerFixture();
    const home = await realpath(rawHome);
    const source = await realpath(rawSource);
    const plans = await preflightClientLinks(home, source, new Set(["claude", "antigravity"]));
    expect(plans.length).toBe(2);
    expect(plans.map((p) => p.client)).toEqual(["claude", "antigravity"]);
    expect(plans[0]?.previous).toBeNull();
    expect(plans[1]?.previous).toBeNull();

    const singlePlan = await preflightClientLinks(home, source, new Set(["claude"]));
    expect(singlePlan.length).toBe(1);
    expect(singlePlan[0]?.client).toBe("claude");
  });

  test("preflightClientLinks rejects if existing path is not a symlink", async () => {
    const { home: rawHome, source: rawSource } = await installerFixture();
    const home = await realpath(rawHome);
    const source = await realpath(rawSource);
    const paths = clientLinkPaths(home);
    await mkdir(paths["claude"], { recursive: true });
    await expect(preflightClientLinks(home, source, new Set(["claude"]))).rejects.toThrow(
      /client skill path is not a symlink/,
    );
  });

  test("applyClientLinks creates links on fresh install and rollback removes them", async () => {
    const { home: rawHome, source: rawSource } = await installerFixture();
    const home = await realpath(rawHome);
    const source = await realpath(rawSource);
    const plans = await preflightClientLinks(home, source, new Set(["claude", "antigravity"]));
    const applied = await applyClientLinks(plans);

    for (const plan of plans) {
      const stat = await lstat(plan.path);
      expect(stat.isSymbolicLink()).toBe(true);
      expect(await readlink(plan.path)).toBe(source);
    }

    await applied.rollback();

    for (const plan of plans) {
      const stat = await lstat(plan.path).catch(() => null);
      expect(stat).toBeNull();
    }
  });

  test("applyClientLinks updates existing links and rollback restores previous target", async () => {
    const { home: rawHome, source: rawSource, root } = await installerFixture();
    const home = await realpath(rawHome);
    const source = await realpath(rawSource);
    const oldTarget = join(root, "old-skill-target");
    await mkdir(oldTarget);

    const paths = clientLinkPaths(home);
    await mkdir(dirname(paths["claude"]), { recursive: true });
    await symlink(oldTarget, paths["claude"], "dir");

    const plans = await preflightClientLinks(home, source, new Set(["claude"]));
    expect(plans[0]?.previous?.target).toBe(oldTarget);

    const applied = await applyClientLinks(plans);
    expect(await readlink(paths["claude"])).toBe(source);

    await applied.rollback();
    expect(await readlink(paths["claude"])).toBe(oldTarget);
  });

  test("applyClientLinks is a no-op if link already points to target", async () => {
    const { home: rawHome, source: rawSource } = await installerFixture();
    const home = await realpath(rawHome);
    const source = await realpath(rawSource);
    const paths = clientLinkPaths(home);
    await mkdir(dirname(paths["claude"]), { recursive: true });
    await symlink(source, paths["claude"], "dir");

    const plans = await preflightClientLinks(home, source, new Set(["claude"]));
    const applied = await applyClientLinks(plans);
    expect(applied.paths).toEqual([paths["claude"]]);
    expect(await readlink(paths["claude"])).toBe(source);
  });

  test("applyClientLinks rolls back partially applied links when a failure occurs", async () => {
    const { home: rawHome, source: rawSource } = await installerFixture();
    const home = await realpath(rawHome);
    const source = await realpath(rawSource);
    const plans = await preflightClientLinks(home, source, new Set(["claude", "antigravity"]));

    await expect(
      applyClientLinks(plans, {
        beforePublish(plan) {
          if (plan.client === "antigravity") {
            throw new Error("simulated antigravity link publish error");
          }
        },
      }),
    ).rejects.toThrow(/simulated antigravity link publish error/);

    const paths = clientLinkPaths(home);
    expect(await lstat(paths["claude"]).catch(() => null)).toBeNull();
    expect(await lstat(paths["antigravity"]).catch(() => null)).toBeNull();
  });

  test("applyClientLinks detects if link changed identity during publish", async () => {
    const { home: rawHome, source: rawSource } = await installerFixture();
    const home = await realpath(rawHome);
    const source = await realpath(rawSource);
    const paths = clientLinkPaths(home);
    await mkdir(dirname(paths["claude"]), { recursive: true });
    await writeFile(join(home, "other"), "data");
    await symlink(join(home, "other"), paths["claude"]);

    const plans = await preflightClientLinks(home, source, new Set(["claude"]));

    await expect(
      applyClientLinks(plans, {
        async beforePublish() {
          await unlink(paths["claude"]);
          await symlink(source, paths["claude"]);
        },
      }),
    ).rejects.toThrow(/client skill path changed identity/);
  });

  test("rollback throws AggregateError when restore fails on tampered link", async () => {
    const { home: rawHome, source: rawSource, root } = await installerFixture();
    const home = await realpath(rawHome);
    const source = await realpath(rawSource);
    const oldTarget = join(root, "old-target-for-fail");
    await mkdir(oldTarget);

    const paths = clientLinkPaths(home);
    await mkdir(dirname(paths["claude"]), { recursive: true });
    await symlink(oldTarget, paths["claude"], "dir");

    const plans = await preflightClientLinks(home, source, new Set(["claude"]));
    const applied = await applyClientLinks(plans, {
      async beforeRollback() {
        await unlink(paths["claude"]);
        await symlink(oldTarget, paths["claude"]);
      },
    });

    await expect(applied.rollback()).rejects.toThrow(/client link rollback failed/);
  });
});
