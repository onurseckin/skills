import { basename } from "node:path";
import { HarnessError } from "./errors/harness-error.ts";

export const RESTRICTED_GIT_ENVIRONMENT = Object.freeze({
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_PAGER: "cat",
  GIT_TERMINAL_PROMPT: "0",
  PAGER: "cat",
});

export const RESTRICTED_GIT_ARGUMENTS = Object.freeze([
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "diff.external=",
  "-c",
  "pager.diff=false",
  "--no-pager",
]);

export function restrictedRepositoryGitArgv(repo: string, argv: readonly string[]): string[] {
  return [...RESTRICTED_GIT_ARGUMENTS, "-C", repo, ...argv];
}

export function isGitArgv(argv: readonly string[]): boolean {
  return (
    basename(argv[0] ?? "")
      .toLowerCase()
      .replace(/\.exe$/u, "") === "git"
  );
}

export function isRestrictedGitDiffArgv(argv: readonly string[]): boolean {
  if (!isGitArgv(argv)) return false;
  const tail = argv.slice(1);
  return (
    (tail.length === 2 && tail[0] === "diff" && tail[1] === "--check") ||
    (tail.length === 3 && tail[0] === "diff" && tail[1] === "--cached" && tail[2] === "--check")
  );
}

export function restrictedGitDiffArgv(argv: readonly string[]): string[] {
  if (!isGitArgv(argv)) return [...argv];
  if (!isRestrictedGitDiffArgv(argv))
    throw new HarnessError("INTEGRITY", "Git gate execution argv is not an accepted diff check");
  const tail = argv.slice(1);
  return [
    argv[0]!,
    ...RESTRICTED_GIT_ARGUMENTS,
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    ...tail.slice(1),
  ];
}
