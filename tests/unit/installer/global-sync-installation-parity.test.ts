import { describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { identifiedInstallation } from "../../../olt/scripts/src/installer/identity.ts";
import { installationStatus } from "../../../olt/scripts/src/installer/installation-status.ts";
import {
  deployCanonicalSkill,
  migrateOwnedLegacyDeployment,
} from "../../../scripts/sync/skill-deployer.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

const REPOSITORY_ROOT = join(import.meta.dir, "../../..");

describe("global skill sync", () => {
  test("upgrades an owned legacy deployment in place before replacing its release", async () => {
    const root = scratchRoot(import.meta.path, "legacy-global-sync");
    const source = join(REPOSITORY_ROOT, "olt");
    const destination = join(root, "home", ".agents", "skills", "olt");
    mkdirSync(join(root, "home", ".agents", "skills"), { recursive: true });
    cpSync(source, destination, { recursive: true });
    writeFileSync(
      join(destination, "skill-config.json"),
      JSON.stringify({ home_repo_root: REPOSITORY_ROOT }),
    );

    await migrateOwnedLegacyDeployment(destination, REPOSITORY_ROOT);

    expect(existsSync(join(destination, "installation.json"))).toBe(true);
    expect(await identifiedInstallation(destination)).toBe(true);
  });

  test("publishes a trusted OLT installation that doctor recognizes as source-parity", async () => {
    const root = scratchRoot(import.meta.path, "trusted-global-sync");
    const home = join(root, "home");

    await deployCanonicalSkill({ sourceRepoRoot: REPOSITORY_ROOT, homeDir: home });

    const destination = join(home, ".agents", "skills", "olt");
    expect(existsSync(join(destination, "installation.json"))).toBe(true);
    expect(existsSync(join(destination, "node_modules", "js-yaml"))).toBe(true);

    const status = await installationStatus(join(REPOSITORY_ROOT, "olt"), home, [
      "codex",
      "claude",
      "antigravity",
    ]);
    expect(status.issues).toEqual([]);
  });
});
