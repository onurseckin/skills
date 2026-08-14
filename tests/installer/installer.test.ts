import { afterEach, describe, expect, test } from "bun:test";
import {
  chmod,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { installSkill } from "../../orchestrating-long-tasks/scripts/src/installer/install.ts";
import { installationStatus } from "../../orchestrating-long-tasks/scripts/src/installer/installation-status.ts";

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "harness-install-"));
  roots.push(root);
  const source = join(root, "source");
  const home = join(root, "home");
  await mkdir(join(source, "scripts", "src", "config"), { recursive: true });
  await mkdir(home);
  await writeFile(
    join(source, "SKILL.md"),
    "---\nname: orchestrating-long-tasks\ndescription: test\n---\n",
  );
  await writeFile(join(source, "scripts", "harness.ts"), "console.log('ok')\n", { mode: 0o755 });
  await writeFile(
    join(source, "scripts", "package.json"),
    '{"name":"@local/orchestrating-long-tasks-runtime","private":true}\n',
  );
  await writeFile(
    join(source, "scripts", "src", "config", "constants.ts"),
    'export const RUNTIME_VERSION = "0.1.0";\n',
  );
  return { root, source, home };
}
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

describe("cross-client installation", () => {
  test("creates a real canonical copy, manifest, and client links", async () => {
    const { source, home } = await fixture();
    const result = await installSkill(source, home, ["codex", "chatgpt", "claude", "antigravity"]);
    expect((await lstat(result.destination)).isDirectory()).toBeTrue();
    expect((await lstat(result.destination)).isSymbolicLink()).toBeFalse();
    const manifest = JSON.parse(
      await readFile(join(result.destination, "installation.json"), "utf8"),
    );
    expect(manifest.source_sha256).toBe(result.digest);
    expect(await readlink(join(home, ".claude", "skills", "orchestrating-long-tasks"))).toBe(
      result.destination,
    );
    expect(
      await readlink(join(home, ".gemini", "config", "skills", "orchestrating-long-tasks")),
    ).toBe(result.destination);
  });

  test("reinstall is atomic and updates the digest", async () => {
    const { source, home } = await fixture();
    const first = await installSkill(source, home, ["claude"]);
    await writeFile(join(source, "scripts", "harness.ts"), "console.log('changed')\n");
    const second = await installSkill(source, home, ["claude"]);
    expect(second.digest).not.toBe(first.digest);
    expect(await readFile(join(second.destination, "scripts", "harness.ts"), "utf8")).toContain(
      "changed",
    );
    expect((await installationStatus(source, home)).drifted).toBeFalse();
  });

  test("refuses unrelated real directories and client paths", async () => {
    const { source, home } = await fixture();
    const destination = join(home, ".agents", "skills", "orchestrating-long-tasks");
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, "mine.txt"), "do not delete");
    await expect(installSkill(source, home, [])).rejects.toThrow("unrelated");
    expect(await readFile(join(destination, "mine.txt"), "utf8")).toBe("do not delete");
  });

  test("doctor reports drift and refuses to replace a drifted prior release", async () => {
    const { source, home } = await fixture();
    const installed = await installSkill(source, home, []);
    await writeFile(join(installed.destination, "scripts", "harness.ts"), "tampered\n");
    expect((await installationStatus(source, home)).drifted).toBeTrue();
    await expect(installSkill(source, home, [])).rejects.toThrow("unrelated");
    await writeFile(join(installed.destination, "scripts", "harness.ts"), "console.log('ok')\n");
    await chmod(join(installed.destination, "scripts", "harness.ts"), 0o600);
    expect((await installationStatus(source, home)).drifted).toBeTrue();
  });

  test("rejects source symlinks instead of following them", async () => {
    const { source, home } = await fixture();
    const target = join(source, "target.txt");
    await writeFile(target, "target");
    await symlink(target, join(source, "link.txt"));
    await expect(installSkill(source, home, [])).rejects.toThrow("symlink");
  });

  test("detects valid-looking client policy tampering in installation metadata", async () => {
    const { source, home } = await fixture();
    const installed = await installSkill(source, home, ["claude"]);
    const manifestPath = join(installed.destination, "installation.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    manifest.clients = [];
    await chmod(manifestPath, 0o644);
    await writeFile(manifestPath, JSON.stringify(manifest));

    const status = await installationStatus(source, home);
    expect(status.drifted).toBeTrue();
    await expect(installSkill(source, home, [])).rejects.toThrow(/unrelated|integrity|metadata/i);
  });
});
