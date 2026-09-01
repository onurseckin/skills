import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const roots: string[] = [];

export async function installerFixture(): Promise<{ root: string; source: string; home: string }> {
  const root = mkdtempSync(join(tmpdir(), "harness-installer-repair-"));
  roots.push(root);
  const source = join(root, "source");
  const home = join(root, "home");
  mkdirSync(join(source, "scripts", "src", "config"), { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(source, "SKILL.md"), "---\nname: olt\ndescription: test\n---\n");
  writeFileSync(join(source, "scripts", "harness.ts"), "console.log('ok')\n", { mode: 0o755 });
  writeFileSync(
    join(source, "scripts", "package.json"),
    JSON.stringify({ name: "@local/olt-runtime", private: true }),
  );
  writeFileSync(
    join(source, "scripts", "src", "config", "constants.ts"),
    'export const RUNTIME_VERSION = "0.1.0";\n',
  );
  return { root, source, home };
}

export async function cleanInstallerFixtures(): Promise<void> {
  const pending = roots.splice(0);
  for (const root of pending) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {}
  }
}
