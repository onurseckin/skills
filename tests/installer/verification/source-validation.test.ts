import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { symlinkSync, writeFileSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { validateSkillSource } from "../../../olt/scripts/src/installer/source-validation.ts";
import { scratchRoot } from "../../shared/fixtures/scratch-root.ts";
import { cleanInstallerFixtures, installerFixture, setupVirtualInstallerFS } from "../helpers.ts";

beforeEach(setupVirtualInstallerFS);
afterEach(cleanInstallerFixtures);

async function expectHarnessFailure(promise: Promise<unknown>, fragment: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(HarnessError);
  try {
    await promise;
    throw new Error("expected throw");
  } catch (error) {
    expect(error).toBeInstanceOf(HarnessError);
    expect((error as HarnessError).message).toContain(fragment);
  }
}

describe("validateSkillSource", () => {
  test("resolves root, digest, and runtimeVersion for a well-formed source", async () => {
    const { source } = await installerFixture();
    const validated = await validateSkillSource(source);
    expect(validated.runtimeVersion).toBe("0.1.0");
    expect(typeof validated.digest).toBe("string");
    expect(validated.digest).toHaveLength(64);
  });

  test("rejects a source path that does not exist", async () => {
    const root = scratchRoot(import.meta.path, "missing-source");
    await expectHarnessFailure(
      validateSkillSource(join(root, "nope")),
      "skill source must be a real directory",
    );
  });

  test("rejects a source path that is a plain file", async () => {
    const root = scratchRoot(import.meta.path, "file-source");
    const file = join(root, "not-a-dir");
    writeFileSync(file, "content");
    await expectHarnessFailure(validateSkillSource(file), "skill source must be a real directory");
  });

  test("rejects a source path that is a symlink to a directory", async () => {
    const root = scratchRoot(import.meta.path, "symlink-source");
    const { source } = await installerFixture();
    const link = join(root, "link");
    symlinkSync(source, link);
    await expectHarnessFailure(validateSkillSource(link), "skill source must be a real directory");
  });

  test("rejects when SKILL.md is missing the expected frontmatter name", async () => {
    const { source } = await installerFixture();
    await writeFile(join(source, "SKILL.md"), "---\nname: something-else\n---\n");
    await expectHarnessFailure(validateSkillSource(source), "skill source identity is not");
  });

  test("rejects when scripts/package.json is not parseable JSON", async () => {
    const { source } = await installerFixture();
    await writeFile(join(source, "scripts", "package.json"), "{ not json at all");
    await expectHarnessFailure(validateSkillSource(source), "skill runtime package is invalid");
  });

  test("rejects when scripts/package.json parses to a non-object", async () => {
    const { source } = await installerFixture();
    await writeFile(join(source, "scripts", "package.json"), "[]");
    await expectHarnessFailure(
      validateSkillSource(source),
      "skill runtime package identity is invalid",
    );
  });

  test("rejects when scripts/package.json has the wrong package name", async () => {
    const { source } = await installerFixture();
    await writeFile(join(source, "scripts", "package.json"), JSON.stringify({ name: "wrong" }));
    await expectHarnessFailure(
      validateSkillSource(source),
      "skill runtime package identity is invalid",
    );
  });

  test("rejects when scripts/src/config/constants.ts has no RUNTIME_VERSION", async () => {
    const { source } = await installerFixture();
    await writeFile(
      join(source, "scripts", "src", "config", "constants.ts"),
      "export const X = 1;\n",
    );
    await expectHarnessFailure(
      validateSkillSource(source),
      "skill source runtime version is missing",
    );
  });

  test("calls the beforeSnapshotRecheck hook before the final digest comparison", async () => {
    const { source } = await installerFixture();
    let called = false;
    await validateSkillSource(source, {
      beforeSnapshotRecheck() {
        called = true;
      },
    });
    expect(called).toBe(true);
  });

  test("rejects when the tree changed between the pre-check and post-check digest", async () => {
    const { source } = await installerFixture();
    await expectHarnessFailure(
      validateSkillSource(source, {
        async beforeSnapshotRecheck() {
          await writeFile(join(source, "extra-file.txt"), "surprise mutation");
        },
      }),
      "skill source changed during identity validation",
    );
  });

  test("propagates a rejecting beforeSnapshotRecheck hook", async () => {
    const { source } = await installerFixture();
    const failure = new Error("hook failed");
    await expect(
      validateSkillSource(source, {
        beforeSnapshotRecheck() {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
  });

  test("rejects when SKILL.md itself is missing", async () => {
    const { source } = await installerFixture();
    await rm(join(source, "SKILL.md"));
    await expect(validateSkillSource(source)).rejects.toThrow(HarnessError);
  });
});
