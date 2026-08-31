import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../olt/scripts/src/cli/execute.ts";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

async function fixture(): Promise<{ source: string; home: string }> {
  const root = await mkdtemp(join(tmpdir(), "harness-install-cmd-"));
  roots.push(root);
  const source = join(root, "source");
  const home = join(root, "home");
  await mkdir(join(source, "scripts", "src", "config"), { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(join(source, "SKILL.md"), "---\nname: olt\ndescription: test\n---\n");
  await writeFile(join(source, "scripts", "harness.ts"), "console.log('ok')\n", { mode: 0o755 });
  await writeFile(
    join(source, "scripts", "package.json"),
    '{"name":"@local/olt-runtime","private":true}\n',
  );
  await writeFile(
    join(source, "scripts", "src", "config", "constants.ts"),
    'export const RUNTIME_VERSION = "0.1.0";\n',
  );
  return { source, home };
}

describe("install", () => {
  test("installs the skill and links the requested clients", async () => {
    const { source, home } = await fixture();
    const result = await execute([
      "install",
      "--source",
      source,
      "--home",
      home,
      "--clients",
      "claude,antigravity",
    ]);
    expect(String(result.markdown)).toContain("### Skill Installed");
    expect(String(result.markdown)).toContain("**Clients**: claude, antigravity");
    expect(result.destination).toBeString();
    expect(result.digest).toBeString();
    expect(result.clients).toEqual(["claude", "antigravity"]);
    expect((result.links as string[]).length).toBe(2);
  });

  test("a client with no on-disk link target still installs cleanly", async () => {
    const { source, home } = await fixture();
    const result = await execute([
      "install",
      "--source",
      source,
      "--home",
      home,
      "--clients",
      "codex",
    ]);
    expect(result.clients).toEqual(["codex"]);
    expect(result.links).toEqual([]);
  });

  test("trims and drops blank entries from a comma-separated client list", async () => {
    const { source, home } = await fixture();
    const result = await execute([
      "install",
      "--source",
      source,
      "--home",
      home,
      "--clients",
      " claude , ,codex ",
    ]);
    expect(result.clients).toEqual(["claude", "codex"]);
  });
});

describe("installation-status", () => {
  test("reports an installed, undrifted release with healthy client links", async () => {
    const { source, home } = await fixture();
    await execute(["install", "--source", source, "--home", home, "--clients", "claude"]);

    const status = await execute(["installation-status", "--source", source, "--home", home]);
    expect(String(status.markdown)).toContain("### Installation Status");
    expect(String(status.markdown)).toContain("- **Installed**: yes");
    expect(String(status.markdown)).toContain("- **Drifted**: no");
    expect(status.installed).toBe(true);
    expect(status.drifted).toBe(false);
    expect(status.issues).toEqual([]);
  });

  test("reports not installed with an explicit issue rather than a healthy-looking default", async () => {
    const { source, home } = await fixture();
    const status = await execute(["installation-status", "--source", source, "--home", home]);
    expect(status.installed).toBe(false);
    expect(String(status.markdown)).toContain("- **Installed**: no");
    expect((status.issues as string[]).length).toBeGreaterThan(0);
  });

  test("honours an explicit --clients override distinct from the installed manifest", async () => {
    const { source, home } = await fixture();
    await execute(["install", "--source", source, "--home", home, "--clients", "claude"]);

    const status = await execute([
      "installation-status",
      "--source",
      source,
      "--home",
      home,
      "--clients",
      "codex",
    ]);
    expect(status.installed).toBe(true);
    const links = status.links as Record<string, string | null>;
    expect(Object.keys(links)).toContain("codex");
    expect(links.claude).toBeUndefined();
  });
});
