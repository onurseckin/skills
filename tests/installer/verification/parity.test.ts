import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { identifiedInstallation } from "../../../olt/scripts/src/installer/identity.ts";
import { installationStatus } from "../../../olt/scripts/src/installer/installation-status.ts";
import {
  deployCanonicalSkill,
  migrateOwnedLegacyDeployment,
} from "../../../scripts/sync/skill-deployer.ts";
import { scratchRoot } from "../../shared/fixtures/scratch-root.ts";
import { cleanupVirtualInstallerFS, setupVirtualInstallerFS } from "../helpers.ts";

const REPOSITORY_ROOT = join(import.meta.dir, "../../..");

beforeEach(setupVirtualInstallerFS);
afterEach(cleanupVirtualInstallerFS);

function createLegacySkillTree(destination: string): void {
  mkdirSync(join(destination, "scripts", "src", "config"), { recursive: true });
  writeFileSync(join(destination, "SKILL.md"), "---\nname: olt\ndescription: test\n---\n");
  writeFileSync(join(destination, "scripts", "harness.ts"), "console.log('ok')\n", { mode: 0o755 });
  writeFileSync(
    join(destination, "scripts", "package.json"),
    JSON.stringify({ name: "@local/olt-runtime", private: true }),
  );
  writeFileSync(
    join(destination, "scripts", "src", "config", "constants.ts"),
    'export const RUNTIME_VERSION = "0.1.0";\n',
  );
}

describe("global skill sync", () => {
  test("upgrades an owned legacy deployment in place before replacing its release", async () => {
    const root = scratchRoot(import.meta.path, "legacy-global-sync");
    const destination = join(root, "home", ".agents", "skills", "olt");
    mkdirSync(join(root, "home", ".agents", "skills"), { recursive: true });
    createLegacySkillTree(destination);
    writeFileSync(
      join(destination, "skill-config.json"),
      JSON.stringify({ home_repo_root: REPOSITORY_ROOT }),
    );

    await migrateOwnedLegacyDeployment(destination, REPOSITORY_ROOT);

    expect(existsSync(join(destination, "installation.json"))).toBe(true);
    expect(await identifiedInstallation(destination)).toBe(true);
  });

  test("upgrades an owned legacy deployment identified by policy.json skill_home_repo_root", async () => {
    const root = scratchRoot(import.meta.path, "legacy-policy-sync");
    const destination = join(root, "home", ".agents", "skills", "olt");
    mkdirSync(join(root, "home", ".agents", "skills"), { recursive: true });
    createLegacySkillTree(destination);
    writeFileSync(
      join(destination, "policy.json"),
      JSON.stringify({ skill_home_repo_root: REPOSITORY_ROOT }),
    );

    await migrateOwnedLegacyDeployment(destination, REPOSITORY_ROOT);

    expect(existsSync(join(destination, "installation.json"))).toBe(true);
    expect(await identifiedInstallation(destination)).toBe(true);
  });

  test("publishes a trusted OLT installation that doctor recognizes as source-parity", async () => {
    const root = scratchRoot(import.meta.path, "trusted-global-sync");
    const repo = join(root, "repo");
    const home = realpathSync(root) + "/home";
    mkdirSync(join(repo, "node_modules", "js-yaml"), { recursive: true });
    writeFileSync(join(repo, "node_modules", "js-yaml", "package.json"), "{}");
    createLegacySkillTree(join(repo, "olt"));
    spawnSync("git", ["init", "-q"], { cwd: repo });

    await deployCanonicalSkill({
      sourceRepoRoot: repo,
      homeDir: home,
      allowDirty: true,
    });

    const destination = join(home, ".agents", "skills", "olt");
    expect(existsSync(join(destination, "installation.json"))).toBe(true);
    expect(existsSync(join(destination, "node_modules", "js-yaml"))).toBe(true);

    const status = await installationStatus(join(repo, "olt"), home, [
      "codex",
      "claude",
      "antigravity",
    ]);
    expect(status.issues).toEqual([]);
  });
});
