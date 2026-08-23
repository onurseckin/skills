import { posix } from "node:path";
import { HarnessError } from "../../core/errors/harness-error.ts";

export interface DestructiveCheckOutcome {
  destructive: boolean;
  reason?: string;
}

export function isDestructiveGitCommand(argv: readonly string[]): DestructiveCheckOutcome {
  if (argv.length === 0) return { destructive: false };
  const subCommand = argv[0]?.toLowerCase() ?? "";

  // Check `git clean`
  if (subCommand === "clean") {
    return {
      destructive: true,
      reason: "git clean discards untracked working-tree files and manual user edits",
    };
  }

  // Check `git reset` with destructive flags (--hard, --merge, --keep)
  if (subCommand === "reset") {
    const hasHard = argv.some(
      (arg) => arg === "--hard" || arg === "-hard" || arg === "--merge" || arg === "--keep",
    );
    if (hasHard) {
      return {
        destructive: true,
        reason: "git reset --hard/--merge/--keep discards uncommitted working-tree modifications",
      };
    }
  }

  // Check `git checkout` discarding changes (-- or . or -f / --force with paths)
  if (subCommand === "checkout") {
    if (argv.includes("--")) {
      return {
        destructive: true,
        reason: "git checkout -- discards working-tree modifications and overwrites user edits",
      };
    }
    if (argv.some((arg) => arg === "-f" || arg === "--force")) {
      return {
        destructive: true,
        reason: "git checkout --force forcibly overwrites uncommitted working-tree modifications",
      };
    }
    // Checking checkout of dot or path without branch creation
    const nonFlags = argv.slice(1).filter((arg) => !arg.startsWith("-"));
    if (nonFlags.length === 1 && nonFlags[0] === ".") {
      return {
        destructive: true,
        reason: "git checkout . discards working-tree modifications across the active workspace",
      };
    }
  }

  // Check `git restore`
  if (subCommand === "restore") {
    return {
      destructive: true,
      reason: "git restore discards working-tree modifications and overwrites user edits",
    };
  }

  // Check `git stash` drop / clear
  if (subCommand === "stash") {
    const stashAction = argv[1]?.toLowerCase();
    if (stashAction === "drop" || stashAction === "clear") {
      return {
        destructive: true,
        reason: `git stash ${stashAction} permanently destroys stashed user modifications`,
      };
    }
    if (argv.includes("--hard")) {
      return {
        destructive: true,
        reason: "git stash with destructive flag discards user modifications",
      };
    }
  }

  return { destructive: false };
}

export function assertZeroDestructiveGit(argv: readonly string[]): void {
  const outcome = isDestructiveGitCommand(argv);
  if (outcome.destructive) {
    throw new HarnessError(
      "INTEGRITY",
      `Destructive git operation forbidden by Zero-Destructive Git Invariant (p55): ${outcome.reason ?? argv.join(" ")}`,
      [{ argv: [...argv], reason: outcome.reason ?? null }],
      3,
      "Preserve all user manual edits and unfamiliar working tree diffs. Only stage and modify files within your leased write_scope.",
    );
  }
}

function globToRegex(glob: string): RegExp {
  let pattern = "^";
  let i = 0;
  while (i < glob.length) {
    const char = glob[i];
    if (char === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") {
        pattern += "(?:.*\\/)?";
        i += 3;
      } else {
        pattern += ".*";
        i += 2;
      }
    } else if (char === "*") {
      pattern += "[^/]*";
      i += 1;
    } else if (char === "?") {
      pattern += "[^/]";
      i += 1;
    } else if (/[.+^$[\](){}|\\-]/u.test(char!)) {
      pattern += `\\${char}`;
      i += 1;
    } else {
      pattern += char;
      i += 1;
    }
  }
  pattern += "$";
  return new RegExp(pattern);
}

export function isPathInWriteScope(path: string, writeScope: readonly string[]): boolean {
  const normalized = posix.normalize(path);
  return writeScope.some((scope) => {
    const normScope = posix.normalize(scope);
    if (normScope.includes("*") || normScope.includes("?")) {
      return globToRegex(normScope).test(normalized);
    }
    return normalized === normScope || normalized.startsWith(`${normScope}/`);
  });
}

export function filterPathsToScope(
  paths: readonly string[],
  writeScope: readonly string[],
): string[] {
  return paths.filter((path) => isPathInWriteScope(path, writeScope));
}

export function assertNonDestructiveWriteScope(
  modifiedPaths: readonly string[],
  writeScope: readonly string[],
  agentId = "agent",
): void {
  const outOfScope = modifiedPaths.filter((path) => !isPathInWriteScope(path, writeScope));
  if (outOfScope.length > 0) {
    throw new HarnessError(
      "ROLE_CONFINEMENT_VIOLATION",
      `Agent '${agentId}' modified files outside its assigned write scope: ${outOfScope.join(", ")}. Adjacent user edits must be preserved untouched.`,
      [{ agent_id: agentId, out_of_scope_paths: outOfScope, write_scope: [...writeScope] }],
      3,
      "Confine modifications strictly to the assigned write_scope to preserve adjacent user edits.",
    );
  }
}

export function buildInclusiveStageArgs(writeScope: readonly string[]): string[] {
  if (writeScope.length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "buildInclusiveStageArgs requires at least one write scope path",
    );
  }
  const pathspecs = writeScope.map((scope) => {
    if (scope.endsWith("/**")) {
      const dir = scope.slice(0, -3);
      return dir === "" ? "." : dir;
    }
    if (scope.includes("*")) {
      return `:(glob)${scope}`;
    }
    return scope;
  });
  return ["add", "--", ...pathspecs];
}

export function partitionObservedChanges(
  observedPaths: readonly string[],
  writeScope: readonly string[],
): { scopedPaths: string[]; unfamiliarUserPaths: string[] } {
  const scopedPaths: string[] = [];
  const unfamiliarUserPaths: string[] = [];
  for (const path of observedPaths) {
    if (isPathInWriteScope(path, writeScope)) {
      scopedPaths.push(path);
    } else {
      unfamiliarUserPaths.push(path);
    }
  }
  return { scopedPaths, unfamiliarUserPaths };
}
