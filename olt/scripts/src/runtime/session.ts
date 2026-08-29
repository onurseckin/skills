import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  openSync,
  renameSync,
  rmSync,
  writeSync,
  type Stats,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { HarnessError } from "../core/errors/index.ts";
import { findRepoRoot, resolveScratchDir } from "../core/shared/paths.ts";
import { releaseFlock } from "../platform/index.ts";
import { AgentMetadata } from "./contracts.ts";
import { assertSafeAgentId, validateAgentMetadata } from "./metadata.ts";
import {
  acquireExclusiveLock,
  activeAgentMetadataParents,
  activeAgentMetadataParentInodes,
  activeAgentMetadataRoots,
  activeAgentMetadataRootInodes,
  activeAgentMetadataParentIdentity,
  activeAgentMetadataRootIdentity,
  activeAgentMetadataAuthority,
  assertActiveMetadataAuthority,
  assertExistingMetadataAuthorityFiles,
  assertRealDirectory,
  fsyncDirectory,
  openVerifiedDirectory,
  requiredNoFollowFlag,
  safeFailureCause,
  sameInode,
} from "./util.ts";

export function getAgentMetadataPath(agentId: string, runRoot?: string): string {
  assertSafeAgentId(agentId);
  if (runRoot !== undefined) {
    return join(resolve(runRoot), "runtime", `agent-${agentId}.json`);
  }
  const repoRoot = findRepoRoot();
  return join(resolveScratchDir(repoRoot), "runtime", `agent-${agentId}.json`);
}

export function writeAgentMetadata(metadata: AgentMetadata, runRoot?: string): string {
  const filePath = getAgentMetadataPath(metadata.agent_id, runRoot);
  const serialized = serializeValidatedAgentMetadata(metadata, filePath);
  withAgentMetadataMutationLock(filePath, () => replaceAgentMetadataUnlocked(filePath, serialized));
  return filePath;
}

export function writeAgentMetadataUnlocked(metadata: AgentMetadata, runRoot?: string): string {
  const filePath = getAgentMetadataPath(metadata.agent_id, runRoot);
  const serialized = serializeValidatedAgentMetadata(metadata, filePath);
  replaceAgentMetadataUnlocked(filePath, serialized);
  return filePath;
}

export function serializeValidatedAgentMetadata(metadata: AgentMetadata, filePath: string): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(metadata, null, 2) + "\n";
  } catch (error) {
    throw new HarnessError(
      "INTEGRITY",
      `failed to serialize agent metadata at '${filePath}': ${safeFailureCause(error)}`,
    );
  }
  try {
    validateAgentMetadata(JSON.parse(serialized) as unknown, metadata.agent_id, filePath);
  } catch (error) {
    if (error instanceof HarnessError) throw error;
    throw new HarnessError(
      "INTEGRITY",
      `failed to validate serialized agent metadata at '${filePath}': ${safeFailureCause(error)}`,
    );
  }
  return serialized;
}

export function replaceAgentMetadataUnlocked(filePath: string, serialized: string): void {
  assertActiveMetadataAuthority(filePath);
  assertExistingMetadataAuthorityFiles(filePath);
  const parent = dirname(filePath);
  const temporary = join(parent, `.${filePath.slice(parent.length + 1)}.${randomUUID()}.tmp`);
  let descriptor: number | undefined;
  let hasPrimary = false;
  let primary: unknown;
  try {
    descriptor = openSync(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | requiredNoFollowFlag(),
      0o600,
    );
    const bytes = Buffer.from(serialized, "utf8");
    let offset = 0;
    while (offset < bytes.byteLength) {
      const written = writeSync(descriptor, bytes, offset, bytes.byteLength - offset);
      if (written <= 0)
        throw new HarnessError("INTEGRITY", "agent metadata write made no progress");
      offset += written;
    }
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    assertActiveMetadataAuthority(filePath);
    assertExistingMetadataAuthorityFiles(filePath);
    renameSync(temporary, filePath);
    fsyncDirectory(parent);
    assertActiveMetadataAuthority(filePath);
  } catch (error) {
    hasPrimary = true;
    primary = error;
  }
  if (descriptor !== undefined) {
    try {
      closeSync(descriptor);
    } catch (error) {
      if (!hasPrimary) {
        hasPrimary = true;
        primary = error;
      }
    }
  }
  if (existsSync(temporary)) {
    try {
      rmSync(temporary);
    } catch (error) {
      if (!hasPrimary) {
        hasPrimary = true;
        primary = error;
      }
    }
  }
  if (hasPrimary) throw primary;
}

export function withAgentMetadataMutationLock<T>(filePath: string, operation: () => T): T {
  const parent = resolve(dirname(filePath));
  const root = resolve(dirname(parent));
  if (activeAgentMetadataParents.has(parent) || activeAgentMetadataRoots.has(root)) {
    throw new HarnessError(
      "LOCK_TIMEOUT",
      `agent metadata is already active in this process: ${filePath}`,
    );
  }
  let rootDescriptor: number | undefined;
  let parentDescriptor: number | undefined;
  let rootAcquired = false;
  let parentAcquired = false;
  let rootInode: string | undefined;
  let parentInode: string | undefined;
  let hasPrimary = false;
  let primary: unknown;
  let hasCleanup = false;
  let cleanupFailure: unknown;
  let result!: T;
  activeAgentMetadataParents.add(parent);
  activeAgentMetadataRoots.add(root);
  activeAgentMetadataAuthority.set(parent, root);
  try {
    const openedRoot = openVerifiedDirectory(root, true, "agent metadata root");
    rootDescriptor = openedRoot.descriptor;
    rootInode = `${openedRoot.metadata.dev}:${openedRoot.metadata.ino}`;
    if (activeAgentMetadataRootInodes.has(rootInode))
      throw new HarnessError("LOCK_TIMEOUT", `agent metadata root is already active: ${root}`);
    activeAgentMetadataRootInodes.add(rootInode);
    activeAgentMetadataRootIdentity.set(root, openedRoot.metadata);
    acquireExclusiveLock(rootDescriptor, root);
    rootAcquired = true;
    if (!sameInode(openedRoot.metadata, assertRealDirectory(root, "agent metadata root")))
      throw new HarnessError("INTEGRITY", `agent metadata root changed while locked: ${root}`);

    const openedParent = openVerifiedDirectory(parent, true, "agent metadata runtime directory");
    parentDescriptor = openedParent.descriptor;
    parentInode = `${openedParent.metadata.dev}:${openedParent.metadata.ino}`;
    if (activeAgentMetadataParentInodes.has(parentInode)) {
      throw new HarnessError(
        "LOCK_TIMEOUT",
        `agent metadata runtime directory is already active: ${parent}`,
      );
    }
    activeAgentMetadataParentInodes.add(parentInode);
    activeAgentMetadataParentIdentity.set(parent, openedParent.metadata);
    acquireExclusiveLock(parentDescriptor, parent);
    parentAcquired = true;
    if (
      !sameInode(
        openedParent.metadata,
        assertRealDirectory(parent, "agent metadata runtime directory"),
      )
    ) {
      throw new HarnessError(
        "INTEGRITY",
        `agent metadata runtime directory changed while locked: ${parent}`,
      );
    }
    result = operation();
    if (!sameInode(openedRoot.metadata, assertRealDirectory(root, "agent metadata root"))) {
      throw new HarnessError("INTEGRITY", `agent metadata root changed after mutation: ${root}`);
    }
  } catch (error) {
    hasPrimary = true;
    primary = error;
  }
  for (const cleanup of [
    () => {
      if (parentDescriptor !== undefined && parentAcquired) releaseFlock(parentDescriptor);
    },
    () => {
      if (parentDescriptor !== undefined) closeSync(parentDescriptor);
    },
    () => {
      if (rootDescriptor !== undefined && rootAcquired) releaseFlock(rootDescriptor);
    },
    () => {
      if (rootDescriptor !== undefined) closeSync(rootDescriptor);
    },
  ]) {
    try {
      cleanup();
    } catch (error) {
      if (!hasCleanup) {
        hasCleanup = true;
        cleanupFailure = error;
      }
    }
  }
  activeAgentMetadataParents.delete(parent);
  activeAgentMetadataRoots.delete(root);
  activeAgentMetadataAuthority.delete(parent);
  activeAgentMetadataParentIdentity.delete(parent);
  activeAgentMetadataRootIdentity.delete(root);
  if (parentInode !== undefined) activeAgentMetadataParentInodes.delete(parentInode);
  if (rootInode !== undefined) activeAgentMetadataRootInodes.delete(rootInode);
  if (hasPrimary) throw primary;
  if (hasCleanup) throw cleanupFailure;
  return result;
}
