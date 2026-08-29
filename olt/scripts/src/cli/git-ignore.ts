import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { HarnessError } from "../core/errors/index.ts";
import {
  repositoryGit,
  repositoryWorktree,
  type RepositoryGitCommand,
} from "../packets/repository-git-command.ts";
import { hasRepositoryGitMetadata } from "../packets/repository-git-metadata.ts";
import { OLT_DIR_NAME } from "../core/shared/paths.ts";

// `.olt/capsules` has always been asserted gitignored below, but the rest of the `.olt` runtime
// state directory (policy, memory, backlog, defect ledgers, auditor cursors, telemetry, ...) was
// never covered: a routine `git clean -fd` in a project repo destroys all of that while leaving
// the capsules intact. Rather than assert-and-throw for the gap (which would break `plan:init`
// fleet-wide for every repo that already has capsules ignored but not the rest of `.olt`), this
// self-heals it by idempotently recording a directory-level rule for the WHOLE `.olt` root — not
// an enumerated file list — in the repository's local, untracked `.git/info/exclude`. That file
// is never committed, so it can never fight a project's own tracked decision about what inside
// `.olt` to track (verified empirically: a `!.olt/` negation in a tracked `.gitignore` always
// wins over an `.olt/` line added here). Because the rule targets the directory rather than
// specific filenames, any runtime state file added later is covered automatically.
const RUNTIME_STATE_EXCLUDE_LINE = `${OLT_DIR_NAME}/`;

function locateDotGit(root: string): string | undefined {
  let directory = root;
  while (true) {
    const candidate = join(directory, ".git");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

/**
 * Resolves the Git common directory (shared across linked worktrees) via plain filesystem reads,
 * mirroring the `.git`-file/`commondir` pointer resolution the repository metadata preflight
 * already performs. Deliberately never touches `RepositoryGitCommand`: this is a best-effort,
 * read-only-until-the-final-append helper, and it must never grow the set of Git subprocess calls
 * `ensureHarnessIgnored` makes for its existing capsule assertion.
 */
function resolveGitCommonDir(root: string): string | undefined {
  try {
    const dotGit = locateDotGit(root);
    if (dotGit === undefined) return undefined;
    const dotGitStat = lstatSync(dotGit);
    let gitDir: string;
    if (dotGitStat.isDirectory()) {
      gitDir = dotGit;
    } else if (dotGitStat.isFile()) {
      const pointer = readFileSync(dotGit, "utf8").trim();
      if (!pointer.startsWith("gitdir: ")) return undefined;
      gitDir = resolve(dirname(dotGit), pointer.slice("gitdir: ".length));
      if (!lstatSync(gitDir).isDirectory()) return undefined;
    } else {
      return undefined;
    }
    const commondirFile = join(gitDir, "commondir");
    if (existsSync(commondirFile)) {
      const commondirValue = readFileSync(commondirFile, "utf8").trim();
      const commonDir = resolve(gitDir, commondirValue);
      if (!lstatSync(commonDir).isDirectory()) return undefined;
      return commonDir;
    }
    return gitDir;
  } catch {
    return undefined;
  }
}

function ensureRuntimeStateExcluded(root: string): void {
  const commonDir = resolveGitCommonDir(root);
  if (commonDir === undefined) return;
  try {
    const excludeFile = join(commonDir, "info", "exclude");
    const existing = existsSync(excludeFile) ? readFileSync(excludeFile, "utf8") : "";
    const alreadyPresent = existing
      .split("\n")
      .some((line) => line.trim() === RUNTIME_STATE_EXCLUDE_LINE);
    if (alreadyPresent) return;
    mkdirSync(dirname(excludeFile), { recursive: true });
    const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    appendFileSync(
      excludeFile,
      `${separator}# added by the OLT skill: protect .olt runtime state from git clean\n${RUNTIME_STATE_EXCLUDE_LINE}\n`,
    );
  } catch {
    // Best-effort only: initializing a run must never fail because this local, untracked
    // self-heal could not be written (e.g. read-only filesystem, permissions).
  }
}

export function ensureHarnessIgnored(
  repo: string,
  command: RepositoryGitCommand = repositoryGit,
): "gitignored" | "not-a-git-worktree" {
  const root = resolve(repo);
  if (!hasRepositoryGitMetadata(root) || !repositoryWorktree(root, command)) {
    return "not-a-git-worktree";
  }
  const checkPaths = [".olt/capsules/probe", "capsules/probe", ".capsules/probe"];
  const isIgnored = checkPaths.some(
    (p) => command(root, ["check-ignore", "--quiet", p], 1024, [0, 1]).status === 0,
  );
  if (!isIgnored) {
    throw new HarnessError(
      "INVALID_STATE",
      ".olt/capsules (or capsules) must be gitignored before initializing a run",
    );
  }
  ensureRuntimeStateExcluded(root);
  return "gitignored";
}
