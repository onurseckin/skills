import { join } from "node:path";
import type * as childProcess from "node:child_process";
import { getVirtualSyncFS } from "../sync-fixture.ts";

export function initSkillsRepoAt(repoRoot: string): void {
  const vfs = getVirtualSyncFS();
  vfs.mkdirSync(join(repoRoot, "olt"), { recursive: true });
  vfs.writeFileSync(join(repoRoot, "olt", "SKILL.md"), "canonical-skill\n", "utf-8");
  vfs.writeFileSync(join(repoRoot, "olt", "harness.ts"), "console.log('harness');\n", "utf-8");
  vfs.mkdirSync(join(repoRoot, "chatroom"), { recursive: true });
  vfs.writeFileSync(join(repoRoot, "chatroom", "SKILL.md"), "canonical-chatroom\n", "utf-8");
  vfs.writeFileSync(
    join(repoRoot, "chatroom", "harness.ts"),
    "console.log('chatroom');\n",
    "utf-8",
  );
  vfs.writeFileSync(join(repoRoot, "package.json"), '{"name":"skills"}\n', "utf-8");
  vfs.mkdirSync(join(repoRoot, ".git"), { recursive: true });
}

export function defaultMockSpawnSync(
  cmd: string,
  args?: readonly string[],
  opts?: { cwd?: string },
): childProcess.SpawnSyncReturns<Buffer | string> {
  const vfs = getVirtualSyncFS();
  const cwd = opts && opts.cwd !== undefined ? opts.cwd : "";
  const isRepo = cwd.length > 0 && vfs.existsSync(cwd) && vfs.existsSync(join(cwd, ".git"));
  const base = {
    pid: 1,
    output: [] as Array<Buffer | string | null>,
    signal: null as NodeJS.Signals | null,
    status: 0 as number | null,
    stdout: "" as Buffer | string,
    stderr: "" as Buffer | string,
  };

  if (cmd === "git") {
    if (args && args[0] === "status") {
      if (!isRepo) return { ...base, status: 1, stderr: "fatal: not a git repository" };
      const dirty: string[] = [];
      const skillFilter = args[3] ?? "olt/";
      const skillName = skillFilter.replace(/\/$/, "");
      const sp = join(cwd, skillName, "SKILL.md");
      const canonicalContent = skillName === "olt" ? "canonical-skill\n" : "canonical-chatroom\n";
      if (vfs.existsSync(sp) && vfs.readFileSync(sp, "utf-8") !== canonicalContent) {
        dirty.push(` M ${skillName}/SKILL.md`);
      }
      if (vfs.existsSync(join(cwd, skillName, "untracked.ts"))) {
        dirty.push(`?? ${skillName}/untracked.ts`);
      }
      if (
        !vfs.existsSync(join(cwd, skillName, "harness.ts")) &&
        vfs.existsSync(join(cwd, skillName, "harness-renamed.ts"))
      ) {
        dirty.push(
          ` M ${skillName}/harness.ts`,
          `R  ${skillName}/harness.ts -> ${skillName}/harness-renamed.ts`,
        );
      }
      return { ...base, status: 0, stdout: dirty.length > 0 ? dirty.join("\n") + "\n" : "" };
    }
    if (args && args[0] === "archive") {
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
      vfs.mkdirSync(join(extractDir, "olt"), { recursive: true });
      vfs.writeFileSync(join(extractDir, "olt", "SKILL.md"), "canonical-skill\n", "utf-8");
      vfs.mkdirSync(join(extractDir, "chatroom"), { recursive: true });
      vfs.writeFileSync(join(extractDir, "chatroom", "SKILL.md"), "canonical-chatroom\n", "utf-8");
    }
    return { ...base, status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  }

  return base;
}
