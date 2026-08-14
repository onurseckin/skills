import { lstatSync, realpathSync } from "node:fs";
import type { RepositoryContentIdentity } from "../contracts/repository.ts";
import { canonicalJsonBytes, sha256Bytes } from "../core/json.ts";
import { HarnessError } from "../errors/harness-error.ts";
import { inspectRepositoryNode, type RepositoryContentNode } from "./repository-content-node.ts";
import { repositoryContentPaths, type RepositoryContentPath } from "./repository-content-paths.ts";
import {
  resolveRepositoryContentPolicy,
  validateRepositoryContentPath,
  type RepositoryContentLimits,
  type RepositoryContentScanPolicy,
} from "./repository-content-policy.ts";

export type { RepositoryContentLimits } from "./repository-content-policy.ts";

export type RepositoryContentPathSource = (
  repo: string,
  maximum: number,
  policy?: Readonly<RepositoryContentScanPolicy>,
) => readonly (RepositoryContentPath | string)[];

export interface RepositoryContentScanHooks {
  afterNode?: (event: { pass: 1 | 2; index: number; path: string }) => void;
}

function normalize(values: readonly (RepositoryContentPath | string)[]): RepositoryContentPath[] {
  return values.map((value) =>
    typeof value === "string" ? { path: value, index: [] } : structuredClone(value),
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  return Buffer.from(canonicalJsonBytes(left as never)).equals(
    Buffer.from(canonicalJsonBytes(right as never)),
  );
}

function scanNodes(
  repo: string,
  paths: RepositoryContentPath[],
  configured: RepositoryContentScanPolicy,
  pass: 1 | 2,
  hooks: RepositoryContentScanHooks,
): { nodes: RepositoryContentNode[]; total: number } {
  const nodes: RepositoryContentNode[] = [];
  let total = 0;
  for (const [index, entry] of paths.entries()) {
    const node = inspectRepositoryNode(repo, entry, configured.maxFileBytes);
    total += node.bytes;
    if (total > configured.maxTotalBytes)
      throw new HarnessError("INTEGRITY", "repository content total byte limit exceeded");
    nodes.push(node);
    hooks.afterNode?.({ pass, index, path: entry.path });
  }
  return { nodes, total };
}

function listedPaths(
  repo: string,
  configured: RepositoryContentScanPolicy,
  source: RepositoryContentPathSource,
): RepositoryContentPath[] {
  const paths = normalize(source(repo, configured.maxListingBytes, configured));
  if (paths.length > configured.maxFiles)
    throw new HarnessError("INTEGRITY", "repository content file limit exceeded");
  return paths.map((entry) => ({
    ...entry,
    path: validateRepositoryContentPath(entry.path, configured),
  }));
}

export function inspectRepositoryContent(
  repoRoot: string,
  options: RepositoryContentLimits = {},
  pathSource: RepositoryContentPathSource = repositoryContentPaths,
  hooks: RepositoryContentScanHooks = {},
): RepositoryContentIdentity {
  const configured = resolveRepositoryContentPolicy(options);
  const repo = realpathSync(repoRoot);
  if (!lstatSync(repo).isDirectory())
    throw new HarnessError("INVALID_ARGUMENT", "repository root is not a directory");
  const before = listedPaths(repo, configured, pathSource);
  const first = scanNodes(repo, before, configured, 1, hooks);
  const middle = listedPaths(repo, configured, pathSource);
  if (!sameJson(before, middle))
    throw new HarnessError("INTEGRITY", "repository content listing changed during scan");
  const second = scanNodes(repo, middle, configured, 2, hooks);
  const after = listedPaths(repo, configured, pathSource);
  if (!sameJson(middle, after))
    throw new HarnessError("INTEGRITY", "repository content listing changed during scan");
  if (!sameJson(first.nodes, second.nodes))
    throw new HarnessError("INTEGRITY", "repository node identity changed during scan");
  return {
    content_sha256: sha256Bytes(
      canonicalJsonBytes({
        schema: "harness.repository-content",
        version: 3,
        policy: configured,
        nodes: second.nodes,
      }),
    ),
    file_count: second.nodes.length,
    total_bytes: second.total,
  };
}
