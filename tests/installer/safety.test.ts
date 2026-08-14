import { afterEach, describe, expect, test } from "bun:test";
import { lstat, mkdir, readFile, readlink, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { RUNTIME_VERSION } from "../../orchestrating-long-tasks/scripts/src/config/constants.ts";
import { installSkill } from "../../orchestrating-long-tasks/scripts/src/installer/install.ts";
import type { ClientLinkPlan } from "../../orchestrating-long-tasks/scripts/src/installer/client-links.ts";
import { INSTALL_SCHEMA, atomicReleaseCopy } from "../../orchestrating-long-tasks/scripts/src/installer/release-copy.ts";
import { treeDigest } from "../../orchestrating-long-tasks/scripts/src/installer/tree-digest.ts";
import { cleanInstallerFixtures, installerFixture } from "./helpers.ts";

afterEach(cleanInstallerFixtures);

interface ExpectedInstallOptions {
  linkHooks?: {
    beforePublish?(plan: ClientLinkPlan): Promise<void> | void;
    beforeRollback?(plan: ClientLinkPlan): Promise<void> | void;
  };
  releaseHooks?: Record<string, () => Promise<void> | void>;
}
const installWithOptions = installSkill as unknown as (
  source: string,
  home: string,
  clients: readonly string[],
  options?: ExpectedInstallOptions,
) => ReturnType<typeof installSkill>;

function failureMessages(error: unknown): string[] {
  if (error instanceof AggregateError) return error.errors.flatMap(failureMessages);
  return [String(error)];
}

describe("installer transaction safety", () => {
  test("preflights every client conflict before changing release or links", async () => {
    const { source, home } = await installerFixture();
    const destination = join(home, ".agents", "skills", "orchestrating-long-tasks");
    const claude = join(home, ".claude", "skills", "orchestrating-long-tasks");
    const antigravity = join(home, ".gemini", "config", "skills", "orchestrating-long-tasks");
    await mkdir(claude, { recursive: true });
    await mkdir(join(home, ".gemini", "config", "skills"), { recursive: true });
    await symlink("/previous/target", antigravity);

    await expect(installSkill(source, home, ["antigravity", "claude"])).rejects.toThrow("client");

    expect(await lstat(destination).catch(() => null)).toBeNull();
    expect(await readlink(antigravity)).toBe("/previous/target");
    expect((await lstat(claude)).isDirectory()).toBeTrue();
  });

  test("rolls back canonical release and earlier links after an injected link failure", async () => {
    const { source, home } = await installerFixture();
    const first = await installSkill(source, home, []);
    const original = await readFile(join(first.destination, "scripts", "harness.ts"), "utf8");
    await writeFile(join(source, "scripts", "harness.ts"), "console.log('replacement')\n");
    const claude = join(home, ".claude", "skills", "orchestrating-long-tasks");
    await expect(
      installWithOptions(source, home, ["claude", "antigravity"], {
        linkHooks: {
          beforePublish(plan) {
            if (plan.client === "antigravity") throw new Error("injected link publication fault");
          },
        },
      }),
    ).rejects.toThrow("injected link publication fault");
    expect(await readFile(join(first.destination, "scripts", "harness.ts"), "utf8")).toBe(original);
    expect(await lstat(claude).catch(() => null)).toBeNull();
  });

  test("attempts every recovery step and preserves primary plus recovery failures", async () => {
    const { source, home } = await installerFixture();
    await installSkill(source, home, []);
    await writeFile(join(source, "scripts", "harness.ts"), "console.log('replacement')\n");
    const calls: string[] = [];
    let failure: unknown;

    try {
      await installWithOptions(source, home, [], {
        releaseHooks: {
          afterPublished() {
            calls.push("primary");
            throw new Error("primary publication fault");
          },
          beforeRollbackRemove() {
            calls.push("remove");
            throw new Error("rollback remove fault");
          },
          beforeRollbackRestore() {
            calls.push("restore");
            throw new Error("rollback restore fault");
          },
          beforeCleanupTemporary() {
            calls.push("cleanup");
            throw new Error("cleanup fault");
          },
        },
      });
    } catch (error) {
      failure = error;
    }

    expect(calls).toEqual(["primary", "remove", "restore", "cleanup"]);
    expect(failure).toBeInstanceOf(AggregateError);
    const messages = failureMessages(failure).join("\n");
    for (const message of [
      "primary publication fault",
      "rollback remove fault",
      "rollback restore fault",
      "cleanup fault",
    ]) {
      expect(messages).toContain(message);
    }
  });

  test("rejects spoofed prior manifests instead of replacing their directory", async () => {
    const { source, home } = await installerFixture();
    const destination = join(home, ".agents", "skills", "orchestrating-long-tasks");
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, "mine.txt"), "preserve");
    await writeFile(
      join(destination, "installation.json"),
      JSON.stringify({
        schema: INSTALL_SCHEMA,
        version: 1,
        skill_name: "orchestrating-long-tasks",
        runtime_version: RUNTIME_VERSION,
        source_sha256: "0".repeat(64),
        clients: [],
      }),
    );

    await expect(installSkill(source, home, [])).rejects.toThrow("unrelated");
    expect(await readFile(join(destination, "mine.txt"), "utf8")).toBe("preserve");
  });

  test("rejects source and home overlap", async () => {
    const { root, source } = await installerFixture();
    await expect(installSkill(source, root, [])).rejects.toThrow("overlap");
    const nestedHome = join(source, "nested-home");
    await expect(installSkill(source, nestedHome, [])).rejects.toThrow("overlap");
    expect(await lstat(nestedHome).catch(() => null)).toBeNull();
  });

  test("verifies the staged copy digest before publishing", async () => {
    const { root, source } = await installerFixture();
    const destination = join(root, "destination");
    const validatedDigest = await treeDigest(source, new Set(["installation.json"]));
    await writeFile(join(source, "scripts", "harness.ts"), "console.log('raced')\n");
    await expect(
      atomicReleaseCopy(source, destination, {
        schema: INSTALL_SCHEMA,
        version: 1,
        skill_name: "orchestrating-long-tasks",
        runtime_version: RUNTIME_VERSION,
        source_sha256: validatedDigest,
        installed_at: new Date().toISOString(),
        clients: [],
      }),
    ).rejects.toThrow("digest");
    expect(await lstat(destination).catch(() => null)).toBeNull();
  });
});
