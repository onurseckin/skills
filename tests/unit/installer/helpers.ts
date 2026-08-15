import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const roots: string[] = [];

export async function installerFixture() {
  const root = await mkdtemp(join(tmpdir(), "harness-installer-repair-"));
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
    JSON.stringify({ name: "@local/orchestrating-long-tasks-runtime", private: true }),
  );
  await writeFile(
    join(source, "scripts", "src", "config", "constants.ts"),
    'export const RUNTIME_VERSION = "0.1.0";\n',
  );
  return { root, source, home };
}

export async function cleanInstallerFixtures(): Promise<void> {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}
