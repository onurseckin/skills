import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  type Dirent,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { HarnessError } from "../core/errors/index.ts";
import { findRepoRoot, resolveCapsulesDir, resolveScratchDir } from "../core/shared/paths.ts";
import { AgentMetadata, AgentMetadataDependencies } from "./contracts.ts";
import { assertSafeAgentId, validateAgentMetadata } from "./metadata.ts";
import { formatSafeErrorCause, isTrustedEnoent, requiredNoFollowFlag, sameInode } from "./util.ts";

export const defaultAgentMetadataDependencies: AgentMetadataDependencies = {
  findRepoRoot,
  resolveCapsulesDir,
  resolveScratchDir,
  readDirectory: (path, options) => readdirSync(path, options),
  readFile: readFileSync,
};

export let agentMetadataDependencies = defaultAgentMetadataDependencies;

export function setAgentMetadataDependenciesForTesting(
  overrides: Partial<AgentMetadataDependencies>,
): () => void {
  const previousDependencies = agentMetadataDependencies;
  agentMetadataDependencies = { ...agentMetadataDependencies, ...overrides };
  return () => {
    agentMetadataDependencies = previousDependencies;
  };
}

export function readAgentMetadataFileSecure(filePath: string): string {
  const root = resolve(dirname(dirname(filePath)));
  const parent = dirname(filePath);
  const before = lstatSync(filePath);
  const rootMetadata = lstatSync(root);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new HarnessError("PATH_SAFETY", `agent metadata root must be a real directory: ${root}`);
  }
  const parentMetadata = lstatSync(parent);
  if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink()) {
    throw new HarnessError(
      "PATH_SAFETY",
      `agent metadata runtime directory must be a real directory: ${parent}`,
    );
  }
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new HarnessError("PATH_SAFETY", `agent metadata must be a regular file: ${filePath}`);
  }
  if (before.nlink > 1) {
    throw new HarnessError(
      "INTEGRITY",
      `agent metadata must not have multiple hard links: ${filePath}`,
    );
  }
  let descriptor: number | undefined;
  try {
    descriptor = openSync(filePath, constants.O_RDONLY | requiredNoFollowFlag());
    const opened = fstatSync(descriptor);
    const after = lstatSync(filePath);
    if (
      !opened.isFile() ||
      opened.nlink > 1 ||
      after.nlink > 1 ||
      !sameInode(before, opened) ||
      !sameInode(opened, after)
    ) {
      throw new HarnessError("INTEGRITY", `agent metadata changed while opening: ${filePath}`);
    }
    return readFileSync(descriptor, "utf8");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function readAgentMetadataFile(
  agentId: string,
  filePath: string,
): { metadata: AgentMetadata; filePath: string } | undefined {
  let raw: string;
  try {
    raw =
      agentMetadataDependencies.readFile === defaultAgentMetadataDependencies.readFile
        ? readAgentMetadataFileSecure(filePath)
        : agentMetadataDependencies.readFile(filePath, "utf-8");
  } catch (error) {
    if (isTrustedEnoent(error)) return undefined;
    throw new HarnessError(
      "INTEGRITY",
      `failed to read agent metadata at '${filePath}': ${formatSafeErrorCause(error)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new HarnessError(
      "INTEGRITY",
      `failed to parse agent metadata at '${filePath}': ${formatSafeErrorCause(error)}`,
    );
  }
  return { metadata: validateAgentMetadata(parsed, agentId, filePath), filePath };
}

export function readAgentMetadataAtRoot(
  agentId: string,
  runRoot: string,
): { metadata: AgentMetadata; runRoot: string; filePath: string } | undefined {
  const canonicalPath = join(runRoot, "runtime", `agent-${agentId}.json`);
  const canonical = readAgentMetadataFile(agentId, canonicalPath);
  if (canonical !== undefined) return { ...canonical, runRoot };

  const legacyPath = join(runRoot, "runtime", `${agentId}.json`);
  const legacy = readAgentMetadataFile(agentId, legacyPath);
  return legacy === undefined ? undefined : { ...legacy, runRoot };
}

export function readCapsuleRoots(capsulesDir: string): readonly string[] {
  let entries: readonly Dirent[];
  try {
    entries = agentMetadataDependencies.readDirectory(capsulesDir, { withFileTypes: true });
  } catch (error) {
    if (isTrustedEnoent(error)) return [];
    throw new HarnessError(
      "INTEGRITY",
      `failed to read capsule metadata directory '${capsulesDir}': ${formatSafeErrorCause(error)}`,
    );
  }

  try {
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(capsulesDir, entry.name))
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    throw new HarnessError(
      "INTEGRITY",
      `failed to enumerate capsule metadata directory '${capsulesDir}': ${formatSafeErrorCause(error)}`,
    );
  }
}

export function findAgentMetadataLocation(
  agentId: string,
  preferredRunRoot?: string,
): { metadata: AgentMetadata; runRoot: string; filePath: string } | undefined {
  assertSafeAgentId(agentId);
  if (preferredRunRoot !== undefined) {
    const root = resolve(preferredRunRoot);
    return readAgentMetadataAtRoot(agentId, root);
  }

  const repoRoot = agentMetadataDependencies.findRepoRoot();
  const capsulesDir = agentMetadataDependencies.resolveCapsulesDir(repoRoot);
  const searchRoots = [
    ...readCapsuleRoots(capsulesDir),
    resolve(agentMetadataDependencies.resolveScratchDir(repoRoot)),
  ];
  const uniqueRoots = [...new Set(searchRoots.map((root) => resolve(root)))].sort((left, right) =>
    left.localeCompare(right),
  );
  const matches = uniqueRoots.flatMap((root) => {
    const match = readAgentMetadataAtRoot(agentId, root);
    return match === undefined ? [] : [match];
  });

  if (matches.length === 0) return undefined;
  if (matches.length === 1) return matches[0];

  const locations = matches
    .map((match) => match.filePath)
    .sort((left, right) => left.localeCompare(right));
  throw new HarnessError(
    "INTEGRITY",
    `agent metadata for '${agentId}' is ambiguous across multiple run roots: ${locations.join(", ")}`,
  );
}

export function readAgentMetadata(agentId: string, runRoot?: string): AgentMetadata | undefined {
  return findAgentMetadataLocation(agentId, runRoot)?.metadata;
}
