import { afterEach, describe, expect, test } from "bun:test";
import { lstat, mkdir, readlink, symlink, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { installSkill } from "../../orchestrating-long-tasks/scripts/src/installer/install.ts";
import { installationStatus } from "../../orchestrating-long-tasks/scripts/src/installer/installation-status.ts";
import { cleanInstallerFixtures, installerFixture } from "./helpers.ts";

afterEach(cleanInstallerFixtures);

describe("installer link diagnostics", () => {
  test("doctor reports missing wrong and broken requested links", async () => {
    const { source, home } = await installerFixture();
    const installed = await installSkill(source, home, ["claude", "antigravity"]);
    const claude = join(home, ".claude", "skills", "orchestrating-long-tasks");
    const antigravity = join(home, ".gemini", "config", "skills", "orchestrating-long-tasks");
    await unlink(claude);
    await unlink(antigravity);
    await symlink(join(home, "missing-release"), antigravity);

    const missing = await installationStatus(source, home);
    expect(missing.drifted).toBeTrue();
    expect(
      missing.issues.some((issue) => issue.includes("claude") && issue.includes("missing")),
    ).toBeTrue();
    expect(
      missing.issues.some((issue) => issue.includes("antigravity") && issue.includes("wrong")),
    ).toBeTrue();
    expect(
      missing.issues.some((issue) => issue.includes("antigravity") && issue.includes("broken")),
    ).toBeTrue();
    expect(missing.destination).toBe(installed.destination);
  });

  test("doctor reports a non-symlink requested client path", async () => {
    const { source, home } = await installerFixture();
    await installSkill(source, home, ["claude"]);
    const claude = join(home, ".claude", "skills", "orchestrating-long-tasks");
    await unlink(claude);
    await mkdir(claude);
    const status = await installationStatus(source, home);
    expect(
      status.issues.some((issue) => issue.includes("claude") && issue.includes("not a symlink")),
    ).toBeTrue();
  });

  test("Codex and ChatGPT use only the canonical copy", async () => {
    const { source, home } = await installerFixture();
    const installed = await installSkill(source, home, ["codex", "chatgpt"]);
    expect(installed.links).toEqual([]);
    expect(
      await lstat(join(home, ".codex", "skills", "orchestrating-long-tasks")).catch(() => null),
    ).toBeNull();
    expect(
      await lstat(join(home, ".chatgpt", "skills", "orchestrating-long-tasks")).catch(() => null),
    ).toBeNull();
  });

  test("repository Claude discovery link is absent and canonical skill exists", async () => {
    const skillRoot = resolve(import.meta.dir, "../../orchestrating-long-tasks");
    const link = join(skillRoot, "..", ".claude", "skills", "orchestrating-long-tasks");
    expect(await lstat(link).catch(() => null)).toBeNull();
    expect((await lstat(skillRoot)).isDirectory()).toBeTrue();
  });
});
