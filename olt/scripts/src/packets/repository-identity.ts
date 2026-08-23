import { lstatSync, realpathSync } from "node:fs";
import type { RepositoryBinding } from "../contracts/repository.ts";
import { canonicalJsonBytes, sha256Bytes } from "../core/json.ts";
import { HarnessError } from "../errors/harness-error.ts";
import { inspectRepositoryContent, type RepositoryContentLimits } from "./repository-content.ts";
import { resolveRepositoryContentPolicy } from "./repository-content-policy.ts";
import {
  inspectRepositoryGitIdentity,
  type RepositoryGitIdentity,
  type RepositoryGitIdentityDependencies,
} from "./repository-git-identity.ts";
import { synchronousDelay } from "./repository-git-command.ts";

const GIT_IDENTITY_SETTLE_RETRIES = 3;
const GIT_IDENTITY_SETTLE_DELAY_MS = 20;

function sameIdentity(left: RepositoryGitIdentity, right: RepositoryGitIdentity): boolean {
  return Buffer.from(canonicalJsonBytes(left)).equals(Buffer.from(canonicalJsonBytes(right)));
}

export function inspectRepositoryBinding(
  repoRoot: string,
  options: RepositoryContentLimits = {},
  gitDependencies: RepositoryGitIdentityDependencies = {},
): RepositoryBinding {
  const repo = realpathSync(repoRoot);
  if (!lstatSync(repo).isDirectory())
    throw new HarnessError("INVALID_ARGUMENT", "repository root is not a directory");
  const policy = resolveRepositoryContentPolicy(options);
  const maximum = policy.maxListingBytes;
  const controlMaximum = policy.maxFileBytes;
  const controlTotalMaximum = policy.maxTotalBytes;
  const beforeGit = inspectRepositoryGitIdentity(
    repo,
    maximum,
    controlMaximum,
    controlTotalMaximum,
    gitDependencies,
  );
  const content = inspectRepositoryContent(repo, options);
  let afterGit = inspectRepositoryGitIdentity(
    repo,
    maximum,
    controlMaximum,
    controlTotalMaximum,
    gitDependencies,
  );
  for (
    let attempt = 0;
    !sameIdentity(beforeGit, afterGit) && attempt < GIT_IDENTITY_SETTLE_RETRIES;
    attempt += 1
  ) {
    synchronousDelay(GIT_IDENTITY_SETTLE_DELAY_MS);
    afterGit = inspectRepositoryGitIdentity(
      repo,
      maximum,
      controlMaximum,
      controlTotalMaximum,
      gitDependencies,
    );
  }
  if (!sameIdentity(beforeGit, afterGit))
    throw new HarnessError("INTEGRITY", "repository Git identity changed during scan");
  const binding = {
    schema: "harness.repository-binding" as const,
    version: 1 as const,
    ...content,
    git_identity_sha256: sha256Bytes(
      canonicalJsonBytes({ schema: "harness.repository-git-identity", version: 1, ...afterGit }),
    ),
  };
  return {
    ...binding,
    inspection_sha256: sha256Bytes(canonicalJsonBytes(binding)),
  };
}
