import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function git(args: string[], cwd: string): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${result.stderr}`);
  }
}

export function initFakeSkillsRepo(repoRoot: string): void {
  mkdirSync(join(repoRoot, "olt", "scripts", "src"), { recursive: true });
  writeFileSync(
    join(repoRoot, "olt", "SKILL.md"),
    "---\nname: olt\ndescription: test\n---\n",
    "utf-8",
  );
  writeFileSync(
    join(repoRoot, "olt", "scripts", "package.json"),
    JSON.stringify({ name: "@local/olt-runtime", version: "1.0.0" }, null, 2),
    "utf-8",
  );
  writeFileSync(
    join(repoRoot, "olt", "scripts", "src", "constants.ts"),
    'export const RUNTIME_VERSION = "1.0.0";\n',
    "utf-8",
  );
  writeFileSync(
    join(repoRoot, "olt", "scripts", "harness.ts"),
    "console.log('harness');\n",
    "utf-8",
  );

  git(["init", "--quiet", "--initial-branch", "main"], repoRoot);
  git(["config", "user.email", "test@example.com"], repoRoot);
  git(["config", "user.name", "Test"], repoRoot);
  git(["add", "-A"], repoRoot);
  git(["commit", "--quiet", "-m", "init"], repoRoot);
}

export interface FakeTargetOltOptions {
  homeRepoRoot?: string | undefined;
  policyRepoRoot?: string | undefined;
}

export function initFakeTargetOlt(targetOlt: string, options?: FakeTargetOltOptions): void {
  mkdirSync(join(targetOlt, "scripts", "src"), { recursive: true });
  writeFileSync(join(targetOlt, "SKILL.md"), "---\nname: olt\ndescription: test\n---\n", "utf-8");
  writeFileSync(
    join(targetOlt, "scripts", "package.json"),
    JSON.stringify({ name: "@local/olt-runtime", version: "1.0.0" }, null, 2),
    "utf-8",
  );
  writeFileSync(
    join(targetOlt, "scripts", "src", "constants.ts"),
    'export const RUNTIME_VERSION = "1.0.0";\n',
    "utf-8",
  );
  if (options?.homeRepoRoot !== undefined) {
    writeFileSync(
      join(targetOlt, "skill-config.json"),
      JSON.stringify({ home_repo_root: options.homeRepoRoot }),
      "utf-8",
    );
  }
  if (options?.policyRepoRoot !== undefined) {
    writeFileSync(
      join(targetOlt, "policy.json"),
      JSON.stringify({ skill_home_repo_root: options.policyRepoRoot }),
      "utf-8",
    );
  }
}
