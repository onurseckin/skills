import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { mindInitCommand } from "../../../olt/scripts/src/cli/commands/index.ts";
import { mindObserveCommand } from "../../../olt/scripts/src/cli/commands/index.ts";
import {
  discoverToolchain,
  loadRepoPolicy,
  validateRepoPolicy,
} from "../../../olt/scripts/src/policy/index.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("Toolchain Discovery - Auto-Calibration & Commands", () => {
  const scratch = "/virtual/toolchain-discovery-commands";
  let vfs: VirtualMemoryFS;
  let vfsSession: VirtualFSSession;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    vfsSession = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    vfsSession.cleanup();
  });

  test("calibrates .olt/policy.json automatically on mind:init and mind:observe", async () => {
    const dir = join(scratch, "mind-init-calibration");
    vfs.mkdirSync(dir, { recursive: true });
    vfs.chdir(dir);
    vfs.writeFileSync(join(dir, "bun.lock"), "");
    vfs.writeFileSync(join(dir, "tsconfig.json"), "{}");
    vfs.writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        scripts: { typecheck: "tsc --noEmit", lint: "oxlint" },
        devDependencies: { oxlint: "^0.2.0" },
      }),
    );
    const charterPath = join(dir, "mind.yaml");
    vfs.writeFileSync(
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

    const initRes = await mindInitCommand({
      repo: dir,
      charter: charterPath,
      "mind-id": "mind-test-calib",
    });
    expect(initRes.mind_id).toBe("mind-test-calib");

    const policy = loadRepoPolicy(dir);
    expect(policy.ecosystem).toBe("bun");
    expect(policy.typecheck_command).toBe("bun typecheck");
    expect(policy.lint_command).toBe("bun lint");
    expect(policy.allowed_commands).toContain("bun lint");
    expect(validateRepoPolicy(policy).schema_version).toBe(1);

    const runRoot = typeof initRes.run_root === "string" ? initRes.run_root : "";
    const cmdDir = join(runRoot, "commands");
    vfs.mkdirSync(cmdDir, { recursive: true });
    vfs.writeFileSync(
      join(cmdDir, "cmd-1.json"),
      JSON.stringify({ command_id: "cmd-1", command: "health", exit_code: 0 }),
    );

    vfs.unlinkSync(join(dir, ".olt", "policy.json"));
    expect(vfs.existsSync(join(dir, ".olt", "policy.json"))).toBe(false);

    mindObserveCommand({
      run: runRoot,
      actor: "mind-test-calib",
      source: "intent-drift",
      "command-id": "cmd-1",
      count: "0",
    });

    expect(vfs.existsSync(join(dir, ".olt", "policy.json"))).toBe(true);
    const reloaded = loadRepoPolicy(dir);
    expect(reloaded.ecosystem).toBe("bun");
    expect(reloaded.lint_command).toBe("bun run lint");
  });

  test("discovers pnpm and yarn with TypeScript without custom typecheck script", () => {
    const pnpmDir = join(scratch, "pnpm-ts-only");
    vfs.mkdirSync(pnpmDir, { recursive: true });
    vfs.writeFileSync(join(pnpmDir, "pnpm-lock.yaml"), "");
    vfs.writeFileSync(join(pnpmDir, "tsconfig.json"), "{}");
    vfs.writeFileSync(join(pnpmDir, "package.json"), JSON.stringify({ name: "pnpm-ts-app" }));

    const pnpmDisc = discoverToolchain(pnpmDir, "node");
    expect(pnpmDisc.typecheckCommand).toBe("pnpm exec tsc --noEmit");

    const yarnDir = join(scratch, "yarn-ts-only");
    vfs.mkdirSync(yarnDir, { recursive: true });
    vfs.writeFileSync(join(yarnDir, "yarn.lock"), "");
    vfs.writeFileSync(join(yarnDir, "tsconfig.json"), "{}");
    vfs.writeFileSync(join(yarnDir, "package.json"), JSON.stringify({ name: "yarn-ts-app" }));

    const yarnDisc = discoverToolchain(yarnDir, "node");
    expect(yarnDisc.typecheckCommand).toBe("yarn tsc --noEmit");
  });
});
