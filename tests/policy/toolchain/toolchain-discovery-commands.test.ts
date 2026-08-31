import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mindInitCommand } from "../../../olt/scripts/src/cli/commands/index.ts";
import { mindObserveCommand } from "../../../olt/scripts/src/cli/commands/index.ts";
import {
  discoverToolchain,
  loadRepoPolicy,
  validateRepoPolicy,
} from "../../../olt/scripts/src/policy/index.ts";

describe("Toolchain Discovery - Auto-Calibration & Commands", () => {
  const scratch = join(process.cwd(), "coverage", "scratch", "toolchain-discovery-commands");

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  test("calibrates .olt/policy.json automatically on mind:init and mind:observe", () => {
    const dir = join(scratch, "mind-init-calibration");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "bun.lock"), "");
    writeFileSync(join(dir, "tsconfig.json"), "{}");
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        scripts: { typecheck: "tsc --noEmit" },
        devDependencies: { oxlint: "^0.2.0" },
      }),
    );
    const charterPath = join(dir, "mind.yaml");
    writeFileSync(
      charterPath,
      `
name: "mind"
role: "mind"
tier: 0
charter:
  identity: "Autonomous Mind"
  goals:
    - id: "G1"
      statement: "Maintain repository health"
  cognitive_pillars:
    - "Pillar 1: Observability"
  non_goals:
    - "Manual drift"
  repo_roots:
    - "."
`,
    );

    const initRes = mindInitCommand({
      repo: dir,
      charter: charterPath,
      "mind-id": "mind-test-calib",
    });
    expect(initRes.mind_id).toBe("mind-test-calib");

    const policy = loadRepoPolicy(dir);
    expect(policy.ecosystem).toBe("bun");
    expect(policy.typecheck_command).toBe("bun run typecheck");
    expect(policy.lint_command).toBe("oxlint");
    expect(policy.allowed_commands).toContain("oxlint");
    expect(validateRepoPolicy(policy).schema_version).toBe(1);

    const runRoot = typeof initRes.run_root === "string" ? initRes.run_root : "";
    const cmdDir = join(runRoot, "commands");
    mkdirSync(cmdDir, { recursive: true });
    writeFileSync(
      join(cmdDir, "cmd-1.json"),
      JSON.stringify({ command_id: "cmd-1", command: "health", exit_code: 0 }),
    );

    rmSync(join(dir, ".olt", "policy.json"), { force: true });
    expect(existsSync(join(dir, ".olt", "policy.json"))).toBe(false);

    mindObserveCommand({
      run: runRoot,
      actor: "mind-test-calib",
      source: "intent-drift",
      "command-id": "cmd-1",
      count: "0",
    });

    expect(existsSync(join(dir, ".olt", "policy.json"))).toBe(true);
    const reloaded = loadRepoPolicy(dir);
    expect(reloaded.ecosystem).toBe("bun");
    expect(reloaded.lint_command).toBe("oxlint");
  });

  test("discovers pnpm and yarn with TypeScript without custom typecheck script", () => {
    const pnpmDir = join(scratch, "pnpm-ts-only");
    mkdirSync(pnpmDir, { recursive: true });
    writeFileSync(join(pnpmDir, "pnpm-lock.yaml"), "");
    writeFileSync(join(pnpmDir, "tsconfig.json"), "{}");
    writeFileSync(join(pnpmDir, "package.json"), JSON.stringify({ name: "pnpm-ts-app" }));

    const pnpmDisc = discoverToolchain(pnpmDir, "node");
    expect(pnpmDisc.typecheckCommand).toBe("pnpm exec tsc --noEmit");

    const yarnDir = join(scratch, "yarn-ts-only");
    mkdirSync(yarnDir, { recursive: true });
    writeFileSync(join(yarnDir, "yarn.lock"), "");
    writeFileSync(join(yarnDir, "tsconfig.json"), "{}");
    writeFileSync(join(yarnDir, "package.json"), JSON.stringify({ name: "yarn-ts-app" }));

    const yarnDisc = discoverToolchain(yarnDir, "node");
    expect(yarnDisc.typecheckCommand).toBe("yarn tsc --noEmit");
  });
});
