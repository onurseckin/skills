import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type * as childProcess from "node:child_process";

export function initSkillsRepoAt(repoRoot: string): void {
  mkdirSync(join(repoRoot, "olt"), { recursive: true });
  writeFileSync(join(repoRoot, "olt", "SKILL.md"), "canonical-skill\n", "utf-8");
  writeFileSync(join(repoRoot, "olt", "harness.ts"), "console.log('harness');\n", "utf-8");
  writeFileSync(join(repoRoot, "package.json"), '{"name":"skills"}\n', "utf-8");
  mkdirSync(join(repoRoot, ".git"), { recursive: true });
}

export function defaultMockSpawnSync(
  cmd: string,
  args?: readonly string[],
  opts?: { cwd?: string },
): childProcess.SpawnSyncReturns<Buffer | string> {
  const cwd = opts?.cwd ?? "";
  const isRepo = cwd.length > 0 && existsSync(cwd) && existsSync(join(cwd, ".git"));
  const base = {
    pid: 1,
    output: [] as Array<Buffer | string | null>,
    signal: null as NodeJS.Signals | null,
    status: 0 as number | null,
    stdout: "" as Buffer | string,
    stderr: "" as Buffer | string,
  };

  if (cmd === "git") {
    if (args?.[0] === "status") {
      if (!isRepo) return { ...base, status: 1, stderr: "fatal: not a git repository" };
      const dirty: string[] = [];
      const sp = join(cwd, "olt", "SKILL.md");
      if (existsSync(sp) && readFileSync(sp, "utf-8") !== "canonical-skill\n") {
        dirty.push(" M olt/SKILL.md");
      }
      if (existsSync(join(cwd, "olt", "untracked.ts"))) {
        dirty.push("?? olt/untracked.ts");
      }
      if (
        !existsSync(join(cwd, "olt", "harness.ts")) &&
        existsSync(join(cwd, "olt", "harness-renamed.ts"))
      ) {
        dirty.push(" M olt/harness.ts", "R  olt/harness.ts -> olt/harness-renamed.ts");
      }
      return { ...base, status: 0, stdout: dirty.length > 0 ? dirty.join("\n") + "\n" : "" };
    }
    if (args?.[0] === "archive") {
      if (!isRepo) {
        return {
          ...base,
          status: 1,
          stdout: Buffer.alloc(0),
          stderr: Buffer.from("fatal: not a git repo"),
        };
      }
      return {
        ...base,
        status: 0,
        stdout: Buffer.from("fake-tar-archive"),
        stderr: Buffer.alloc(0),
      };
    }
  }

  if (cmd === "tar") {
    const cIdx = args ? args.indexOf("-C") : -1;
    const extractDir = cIdx !== -1 && args ? args[cIdx + 1] : undefined;
    if (extractDir) {
      mkdirSync(join(extractDir, "olt"), { recursive: true });
      writeFileSync(join(extractDir, "olt", "SKILL.md"), "canonical-skill\n", "utf-8");
    }
    return { ...base, status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  }

  return base;
}
