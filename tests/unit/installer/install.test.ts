import { afterEach, describe, expect, test } from "bun:test";
import { readFile, realpath } from "node:fs/promises";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/errors/harness-error.ts";
import { clientLinkPaths } from "../../../olt/scripts/src/installer/client-links.ts";
import { installSkill, type InstallOptions } from "../../../olt/scripts/src/installer/install.ts";
import { SKILL_NAME } from "../../../olt/scripts/src/installer/constants.ts";
import { pathIdentity } from "../../../olt/scripts/src/installer/path-safety.ts";
import { cleanInstallerFixtures, installerFixture } from "./helpers.ts";

afterEach(cleanInstallerFixtures);

describe("installSkill", () => {
  test("performs a fresh install with a filesystem client and returns destination/digest/links", async () => {
    const { source, home } = await installerFixture();
    const result = await installSkill(source, home, ["claude"]);
    const realHome = await realpath(home);
    expect(result.destination).toBe(join(realHome, ".agents", "skills", SKILL_NAME));
    expect(result.digest).toHaveLength(64);
    expect(result.links).toEqual([clientLinkPaths(realHome).claude]);
    expect(await readFile(join(result.destination, "installation.json"), "utf8")).toContain(
      SKILL_NAME,
    );
    expect(
      await readFile(join(clientLinkPaths(home).claude, "scripts", "harness.ts"), "utf8"),
    ).toBe("console.log('ok')\n");
  });

  test("installs with no filesystem clients requested at all", async () => {
    const { source, home } = await installerFixture();
    const result = await installSkill(source, home, []);
    expect(result.links).toEqual([]);
  });

  test("installs for codex/chatgpt, which need no filesystem symlinks", async () => {
    const { source, home } = await installerFixture();
    const result = await installSkill(source, home, ["codex", "chatgpt"]);
    expect(result.links).toEqual([]);
  });

  test("records the requested clients, sorted, in the installed manifest", async () => {
    const { source, home } = await installerFixture();
    const result = await installSkill(source, home, ["codex", "antigravity"]);
    const manifest = JSON.parse(
      await readFile(join(result.destination, "installation.json"), "utf8"),
    ) as { clients: string[] };
    expect(manifest.clients).toEqual(["antigravity", "codex"]);
  });

  test("rejects an unknown client name before touching the filesystem", async () => {
    const { source, home } = await installerFixture();
    await expect(installSkill(source, home, ["not-a-real-client"])).rejects.toBeInstanceOf(
      HarnessError,
    );
    try {
      await installSkill(source, home, ["not-a-real-client"]);
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(HarnessError);
      expect((error as HarnessError).code).toBe("INVALID_ARGUMENT");
    }
  });

  test("rejects an unsupported platform", async () => {
    const { source, home } = await installerFixture();
    await expect(
      installSkill(source, home, ["claude"], { platform: "win32" }),
    ).rejects.toBeInstanceOf(HarnessError);
  });

  test("upgrades an existing installation, replacing the client link's target", async () => {
    const { source, home } = await installerFixture();
    await installSkill(source, home, ["claude"]);
    const result = await installSkill(source, home, ["claude"]);
    expect(await readFile(join(result.destination, "installation.json"), "utf8")).toContain(
      SKILL_NAME,
    );
  });

  test("rolls back both the release and applied client links when finalize fails, and still cleans up", async () => {
    const { source, home } = await installerFixture();
    const failure = new Error("simulated finalize failure");
    const options: InstallOptions = {
      releaseHooks: {
        beforeFinalizeBackup() {
          throw failure;
        },
      },
    };
    // Seed a real prior install so finalize() actually has backup work to fail during.
    await installSkill(source, home, ["claude"]);
    await expect(installSkill(source, home, ["claude"], options)).rejects.toBe(failure);
    // The client link must still point at whatever destination survived the rollback: since the
    // release itself was rolled back to the original install, re-fetching status is consistent.
    expect(await pathIdentity(clientLinkPaths(home).claude)).not.toBeNull();
  });

  test("rolls back the release when applying client links fails, with nothing published", async () => {
    const { source, home } = await installerFixture();
    const failure = new Error("simulated client link failure");
    const options: InstallOptions = {
      linkHooks: {
        beforePublish() {
          throw failure;
        },
      },
    };
    await expect(installSkill(source, home, ["claude"], options)).rejects.toBe(failure);
    // Nothing was ever published: the destination must not exist.
    expect(await pathIdentity(join(home, ".agents", "skills", SKILL_NAME))).toBeNull();
    expect(await pathIdentity(clientLinkPaths(home).claude)).toBeNull();
  });

  test("rolls back when commit itself fails, before any client links are attempted", async () => {
    const { source, home } = await installerFixture();
    const failure = new Error("simulated commit failure");
    const options: InstallOptions = {
      releaseHooks: {
        beforePublish() {
          throw failure;
        },
      },
    };
    await expect(installSkill(source, home, ["claude"], options)).rejects.toBe(failure);
    expect(await pathIdentity(join(home, ".agents", "skills", SKILL_NAME))).toBeNull();
    expect(await pathIdentity(clientLinkPaths(home).claude)).toBeNull();
  });

  test("wraps a combined failure in an AggregateError when the automatic rollback itself also fails", async () => {
    // Upgrade so commit() does an old-move first; beforePublish then both sabotages the backup
    // it just created (so the automatic release.rollback() install.ts runs in its catch block
    // cannot restore it) and throws the original commit failure. install.ts's own
    // combinedFailure(error, recoveryErrors([...]), ...) call must then wrap both into one
    // AggregateError rather than surfacing just the original error.
    const { source, home } = await installerFixture();
    await installSkill(source, home, ["claude"]);
    const commitFailure = new Error("simulated commit failure");
    const skillsDir = join(home, ".agents", "skills");
    const options: InstallOptions = {
      releaseHooks: {
        beforePublish() {
          const backupName = readdirSync(skillsDir).find((name) => name.includes(".old-"));
          if (backupName) {
            const backupPath = join(skillsDir, backupName);
            rmSync(backupPath, { recursive: true });
            mkdirSync(backupPath);
          }
          throw commitFailure;
        },
      },
    };
    await expect(installSkill(source, home, ["claude"], options)).rejects.toBeInstanceOf(
      AggregateError,
    );
  });
});
