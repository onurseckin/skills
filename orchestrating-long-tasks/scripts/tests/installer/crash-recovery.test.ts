import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { canonicalJsonBytes } from "../../src/core/json.ts";
import { INSTALL_SCHEMA, INSTALL_VERSION, SKILL_NAME } from "../../src/installer/constants.ts";
import { installSkill } from "../../src/installer/install.ts";
import { recoverReleaseTransaction } from "../../src/installer/release-transaction.ts";
import { validateSkillSource } from "../../src/installer/source-validation.ts";
import { cleanInstallerFixtures, installerFixture } from "./helpers.ts";

const worker = join(import.meta.dir, "fixtures", "crash-worker.ts");
afterEach(cleanInstallerFixtures);

const exitCodes = {
  "before-old-rename": 71,
  "after-old-rename": 72,
  "before-publish-rename": 73,
  "after-publish-rename": 74,
  "backup-deleted": 75,
  "before-marker-delete": 76,
  "backup-quarantined": 77,
  "old-moved": 81,
  published: 82,
} as const;

async function crashAt(boundary: keyof typeof exitCodes): Promise<void> {
  const { source, home } = await installerFixture();
  const installed = await installSkill(source, home, []);
  await writeFile(join(source, "scripts", "harness.ts"), `console.log('${boundary}')\n`);
  const validated = await validateSkillSource(source);
  const manifest = {
    schema: INSTALL_SCHEMA,
    version: INSTALL_VERSION,
    skill_name: SKILL_NAME,
    runtime_version: validated.runtimeVersion,
    source_sha256: validated.digest,
    installed_at: new Date().toISOString(),
    clients: [],
  };
  const child = Bun.spawn({
    cmd: [
      process.execPath,
      worker,
      source,
      installed.destination,
      JSON.stringify(manifest),
      boundary,
    ],
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exit, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect(exit).toBe(exitCodes[boundary]);
  expect(stderr).toBe("");

  const recovered = await installSkill(source, home, []);
  expect(recovered.digest).toBe(validated.digest);
  expect((await readdir(dirname(installed.destination))).sort()).toEqual([SKILL_NAME]);
}

describe("installer crash recovery", () => {
  test("recovers a subprocess crash after moving the old release", async () => {
    await crashAt("old-moved");
  });

  test("recovers a subprocess crash after publishing the new release", async () => {
    await crashAt("published");
  });

  for (const boundary of [
    "before-old-rename",
    "after-old-rename",
    "before-publish-rename",
    "after-publish-rename",
  ] as const) {
    test(`recovers the write-ahead ${boundary} boundary`, async () => {
      await crashAt(boundary);
    });
  }

  for (const boundary of ["backup-deleted", "before-marker-delete"] as const) {
    test(`preserves the new release across the irreversible ${boundary} crash boundary`, async () => {
      await crashAt(boundary);
    });
  }

  test("recovers a crash during recursive backup quarantine deletion", async () => {
    await crashAt("backup-quarantined");
  });

  test("recovery ownership never relies on a marker PID", async () => {
    const { source, home } = await installerFixture();
    const installed = await installSkill(source, home, []);
    await writeFile(join(source, "scripts", "harness.ts"), "console.log('pid reuse')\n");
    const validated = await validateSkillSource(source);
    const manifest = {
      schema: INSTALL_SCHEMA,
      version: INSTALL_VERSION,
      skill_name: SKILL_NAME,
      runtime_version: validated.runtimeVersion,
      source_sha256: validated.digest,
      installed_at: new Date().toISOString(),
      clients: [],
    };
    const child = Bun.spawn({
      cmd: [
        process.execPath,
        worker,
        source,
        installed.destination,
        JSON.stringify(manifest),
        "old-moved",
      ],
      stdout: "ignore",
      stderr: "ignore",
    });
    expect(await child.exited).toBe(81);
    const markerPath = join(
      dirname(installed.destination),
      `.${SKILL_NAME}.install-transaction.json`,
    );
    const marker = JSON.parse(await readFile(markerPath, "utf8")) as Record<string, unknown>;
    marker.pid = process.pid;
    await writeFile(markerPath, canonicalJsonBytes(marker as never));

    await expect(installSkill(source, home, [])).resolves.toBeDefined();
  });

  test("rejects a marker that names a same-shaped path outside the release parent", async () => {
    const { root, source, home } = await installerFixture();
    const installed = await installSkill(source, home, []);
    const parent = dirname(installed.destination);
    const suffix = "00000000-0000-4000-8000-000000000000";
    const outside = join(root, `${SKILL_NAME}.tmp-${suffix}`);
    await mkdir(outside);
    await writeFile(
      join(parent, `.${SKILL_NAME}.install-transaction.json`),
      canonicalJsonBytes({
        backup: `${installed.destination}.old-${suffix}`,
        destination: installed.destination,
        pid: 2_147_483_647,
        schema: "harness-install-transaction/v2",
        source_sha256: installed.digest,
        stage: "published",
        temporary: outside,
      }),
    );

    await expect(installSkill(source, home, [])).rejects.toThrow(/invalid.*transaction/i);
    expect((await readdir(outside)).length).toBe(0);
  });

  test("restores the identified backup if a published release disappears before recovery", async () => {
    const { source, home } = await installerFixture();
    const installed = await installSkill(source, home, []);
    const script = join(installed.destination, "scripts", "harness.ts");
    const original = await readFile(script, "utf8");
    await writeFile(join(source, "scripts", "harness.ts"), "console.log('new')\n");
    const validated = await validateSkillSource(source);
    const child = Bun.spawn({
      cmd: [
        process.execPath,
        worker,
        source,
        installed.destination,
        JSON.stringify({
          schema: INSTALL_SCHEMA,
          version: INSTALL_VERSION,
          skill_name: SKILL_NAME,
          runtime_version: validated.runtimeVersion,
          source_sha256: validated.digest,
          installed_at: new Date().toISOString(),
          clients: [],
        }),
        "published",
      ],
      stdout: "ignore",
      stderr: "pipe",
    });
    expect(await child.exited).toBe(82);
    await rm(installed.destination, { recursive: true });

    await recoverReleaseTransaction(dirname(installed.destination), installed.destination);
    expect(await readFile(script, "utf8")).toBe(original);
  });
});
