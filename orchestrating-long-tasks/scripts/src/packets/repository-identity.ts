import { lstatSync, realpathSync } from "node:fs";
import type { RepositoryBinding } from "../contracts/repository.ts";
import { canonicalJsonBytes, sha256Bytes } from "../core/json.ts";
import { HarnessError } from "../errors/harness-error.ts";
import { inspectRepositoryContent, type RepositoryContentLimits } from "./repository-content.ts";
import { resolveRepositoryContentPolicy } from "./repository-content-policy.ts";
import { inspectRepositoryGitIdentity } from "./repository-git-identity.ts";

export function inspectRepositoryBinding(
  repoRoot: string,
  options: RepositoryContentLimits = {},
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
  );
  const content = inspectRepositoryContent(repo, options);
  const afterGit = inspectRepositoryGitIdentity(repo, maximum, controlMaximum, controlTotalMaximum);
  if (!Buffer.from(canonicalJsonBytes(beforeGit)).equals(Buffer.from(canonicalJsonBytes(afterGit))))
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
