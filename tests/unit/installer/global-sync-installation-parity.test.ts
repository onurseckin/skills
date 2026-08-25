import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { installationStatus } from "../../../olt/scripts/src/installer/installation-status.ts";
import { deployCanonicalSkill } from "../../../scripts/sync/skill-deployer.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

const REPOSITORY_ROOT = join(import.meta.dir, "../../..");

describe("global skill sync", () => {
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
