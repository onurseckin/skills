import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  INSTALL_SCHEMA,
  INSTALL_VERSION,
  SKILL_NAME,
} from "../../orchestrating-long-tasks/scripts/src/installer/constants.ts";
import { installSkill } from "../../orchestrating-long-tasks/scripts/src/installer/install.ts";
import { prepareReleaseCopy } from "../../orchestrating-long-tasks/scripts/src/installer/release-copy.ts";
import { validateSkillSource } from "../../orchestrating-long-tasks/scripts/src/installer/source-validation.ts";
import { cleanInstallerFixtures, installerFixture } from "../unit/installer/helpers.ts";

afterEach(cleanInstallerFixtures);

describe("release destination identity", () => {
  test("refuses to publish when the destination changes after prepare", async () => {
    const { source, home } = await installerFixture();
    const first = await installSkill(source, home, []);
    await writeFile(join(source, "scripts", "harness.ts"), "console.log('next')\n");
    const validated = await validateSkillSource(source);
    const release = await prepareReleaseCopy(source, first.destination, {
      schema: INSTALL_SCHEMA,
      version: INSTALL_VERSION,
      skill_name: SKILL_NAME,
      runtime_version: validated.runtimeVersion,
      source_sha256: validated.digest,
      installed_at: new Date().toISOString(),
      clients: [],
    });
    const original = `${first.destination}.preserved`;
    await rename(first.destination, original);
    await mkdir(first.destination);
    await writeFile(join(first.destination, "mine.txt"), "do not replace");

    try {
      await expect(release.commit()).rejects.toThrow(/changed|identity/i);
    } finally {
      await release.rollback().catch(() => undefined);
      await release.cleanup().catch(() => undefined);
    }
    expect(await readFile(join(first.destination, "mine.txt"), "utf8")).toBe("do not replace");
  });
});
