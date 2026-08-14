import { afterEach, describe, expect, test } from "bun:test";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { installSkill } from "../../src/installer/install.ts";
import { cleanInstallerFixtures, installerFixture } from "./helpers.ts";

afterEach(cleanInstallerFixtures);

interface QualityHooks {
  beforeSourceRecheck?(): Promise<void> | void;
  beforeMarkerFinish?(): Promise<void> | void;
  observe?(step: string): void;
}

const installWithHooks = installSkill as unknown as (
  source: string,
  home: string,
  clients: readonly string[],
  options: { releaseHooks: QualityHooks },
) => ReturnType<typeof installSkill>;

describe("installer journal durability", () => {
  test("preserves the committed new release when final marker cleanup fails", async () => {
    const { source, home } = await installerFixture();
    const installed = await installSkill(source, home, []);
    await writeFile(join(source, "scripts", "harness.ts"), "console.log('committed')\n");

    await expect(
      installWithHooks(source, home, [], {
        releaseHooks: {
          beforeMarkerFinish() {
            throw new Error("marker cleanup fault");
          },
        },
      }),
    ).rejects.toThrow("marker cleanup fault");
    expect(await readFile(join(installed.destination, "scripts", "harness.ts"), "utf8")).toBe(
      "console.log('committed')\n",
    );
  });

  test("rejects source mutation between staging and the bound source recheck", async () => {
    const { source, home } = await installerFixture();
    const destination = join(home, ".agents", "skills", "orchestrating-long-tasks");
    await expect(
      installWithHooks(source, home, [], {
        releaseHooks: {
          async beforeSourceRecheck() {
            await writeFile(join(source, "scripts", "package.json"), '{"name":"raced"}\n');
          },
        },
      }),
    ).rejects.toThrow(/source|identity|digest|package/i);
    expect(await lstat(destination).catch(() => null)).toBeNull();
  });

  test("syncs tree and rename effects before advancing durable journal stages", async () => {
    const { source, home } = await installerFixture();
    await installSkill(source, home, []);
    await writeFile(join(source, "scripts", "harness.ts"), "console.log('durable')\n");
    const steps: string[] = [];
    await installWithHooks(source, home, [], {
      releaseHooks: { observe: (step) => steps.push(step) },
    });
    expect(steps).toEqual([
      "staged-tree-synced",
      "journal-old-move-intent",
      "old-rename-synced",
      "journal-old-moved",
      "journal-publish-intent",
      "publish-rename-synced",
      "journal-published",
      "journal-backup-delete-intent",
      "backup-quarantine-synced",
      "journal-backup-quarantined",
      "backup-delete-synced",
      "journal-committed",
      "marker-delete-synced",
    ]);
  });
});
