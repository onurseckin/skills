import type { JsonObject } from "../contracts/json.ts";
import { sha256Bytes } from "../core/json.ts";
import { HarnessError } from "../errors/harness-error.ts";
import { inspectRepositoryGitControls } from "./repository-git-controls.ts";
import {
  commandOutputRetryingEmpty,
  createRepositoryGitCommand,
  repositoryWorktree,
  type RepositoryGitCommand,
} from "./repository-git-command.ts";
import { hasRepositoryGitMetadata } from "./repository-git-metadata.ts";
import { decodeNulRecords, rejectRepositoryGitlinks } from "./repository-git-paths.ts";

export interface RepositoryGitIdentity extends JsonObject {
  available: boolean;
  head_oid?: string | null;
  head_ref?: string | null;
  index?: { bytes: number; sha256: string };
  local_controls?: { bytes: number; sha256: string };
  status?: { bytes: number; sha256: string };
}

export interface RepositoryGitIdentityDependencies {
  command?: RepositoryGitCommand;
  environment?: Readonly<NodeJS.ProcessEnv>;
}

// Status 1 legitimately means "no ref" here (unborn HEAD, detached HEAD) — that branch's empty
// output is a real answer, never retried. Status 0 always carries a SHA or ref name, so empty
// output paired with an accepted status can only be the fork+exec scheduling hazard
// commandOutputRetryingEmpty already retries for elsewhere in this file's callers (see
// repository-git-command.ts); if it is still empty once those retries are exhausted, that is not a
// legitimate "no ref" and must not be reported as one.
function optionalText(repo: string, argv: string[], command: RepositoryGitCommand): string | null {
  const result = commandOutputRetryingEmpty(repo, argv, 1024, command, [0, 1]);
  if (result.status !== 0) return null;
  const value = result.bytes.toString("utf8").trim();
  if (value === "")
    throw new HarnessError(
      "INTEGRITY",
      `repository Git ref probe returned an accepted status with no output: ${argv.join(" ")}`,
    );
  return value;
}

function digest(bytes: Buffer): { bytes: number; sha256: string } {
  return { bytes: bytes.byteLength, sha256: sha256Bytes(bytes) };
}

export function inspectRepositoryGitIdentity(
  repo: string,
  maximum = 8 * 1024 * 1024,
  controlMaximum = 64 * 1024 * 1024,
  controlTotalMaximum = 256 * 1024 * 1024,
  dependencies: RepositoryGitIdentityDependencies = {},
): RepositoryGitIdentity {
  if (!hasRepositoryGitMetadata(repo)) return { available: false };
  const command = dependencies.command ?? createRepositoryGitCommand(dependencies.environment);
  if (!repositoryWorktree(repo, command)) return { available: false };
  const localControls = inspectRepositoryGitControls(
    repo,
    command,
    controlMaximum,
    controlTotalMaximum,
  );
  const index = command(
    repo,
    ["ls-files", "--stage", "-z", "--", ".", ":(exclude).capsules", ":(exclude).capsules/**"],
    maximum,
  ).bytes;
  rejectRepositoryGitlinks(decodeNulRecords(index, "identity index"));
  const status = command(
    repo,
    [
      "status",
      "--porcelain=v2",
      "--branch",
      "-z",
      "--untracked-files=all",
      "--",
      ".",
      ":(exclude).capsules",
      ":(exclude).capsules/**",
    ],
    maximum,
  ).bytes;
  return {
    available: true,
    head_oid: optionalText(repo, ["rev-parse", "--verify", "-q", "HEAD"], command),
    head_ref: optionalText(repo, ["symbolic-ref", "-q", "HEAD"], command),
    index: digest(index),
    local_controls: localControls,
    status: digest(status),
  };
}
