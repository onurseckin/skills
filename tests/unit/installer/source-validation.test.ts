import { afterEach, describe, expect, test } from "bun:test";
import { realpath, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validateSkillSource } from "../../../orchestrating-long-tasks/scripts/src/installer/source-validation.ts";
import { cleanInstallerFixtures, installerFixture } from "./helpers.ts";

afterEach(cleanInstallerFixtures);

describe("installer source validation", () => {
  test("validates a valid skill source directory", async () => {
    const { source } = await installerFixture();
    const result = await validateSkillSource(source);
    const expectedRoot = await realpath(source);
    expect(result.root).toBe(expectedRoot);
    expect(result.runtimeVersion).toBe("0.1.0");
    expect(typeof result.digest).toBe("string");
    expect(result.digest.length).toBe(64);
  });

  test("rejects when source does not exist", async () => {
    const { root } = await installerFixture();
    await expect(validateSkillSource(join(root, "nonexistent"))).rejects.toThrow(
      /skill source must be a real directory/,
    );
  });

  test("rejects when source is a file", async () => {
    const { root } = await installerFixture();
    const filePath = join(root, "some-file");
    await writeFile(filePath, "test");
    await expect(validateSkillSource(filePath)).rejects.toThrow(
      /skill source must be a real directory/,
    );
  });

  test("rejects when source is a symlink", async () => {
    const { source, root } = await installerFixture();
    const linkPath = join(root, "symlink-source");
    await symlink(source, linkPath);
    await expect(validateSkillSource(linkPath)).rejects.toThrow(
      /skill source must be a real directory/,
    );
  });

  test("rejects when SKILL.md has wrong skill name", async () => {
    const { source } = await installerFixture();
    await writeFile(join(source, "SKILL.md"), "---\nname: wrong-skill-name\n---\n");
    await expect(validateSkillSource(source)).rejects.toThrow(
      /skill source identity is not orchestrating-long-tasks/,
    );
  });

  test("rejects when scripts/package.json contains invalid json", async () => {
    const { source } = await installerFixture();
    await writeFile(join(source, "scripts", "package.json"), "invalid json content");
    await expect(validateSkillSource(source)).rejects.toThrow(/skill runtime package is invalid/);
  });

  test("rejects when scripts/package.json has wrong package name or invalid structure", async () => {
    const { source } = await installerFixture();
    await writeFile(
      join(source, "scripts", "package.json"),
      JSON.stringify({ name: "wrong-runtime-name" }),
    );
    await expect(validateSkillSource(source)).rejects.toThrow(
      /skill runtime package identity is invalid/,
    );

    await writeFile(
      join(source, "scripts", "package.json"),
      JSON.stringify(["array", "instead", "of", "object"]),
    );
    await expect(validateSkillSource(source)).rejects.toThrow(
      /skill runtime package identity is invalid/,
    );
  });

  test("rejects when runtime constants file is missing RUNTIME_VERSION", async () => {
    const { source } = await installerFixture();
    await writeFile(
      join(source, "scripts", "src", "config", "constants.ts"),
      "export const OTHER_VAR = 123;\n",
    );
    await expect(validateSkillSource(source)).rejects.toThrow(
      /skill source runtime version is missing/,
    );
  });

  test("rejects when source changes during validation recheck hook", async () => {
    const { source } = await installerFixture();
    await expect(
      validateSkillSource(source, {
        async beforeSnapshotRecheck() {
          await writeFile(join(source, "scripts", "harness.ts"), "console.log('modified')\n");
        },
      }),
    ).rejects.toThrow(/skill source changed during identity validation/);
  });
});
