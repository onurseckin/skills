import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
  type Dirent,
  type Stats,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { HarnessError } from "../core/errors/harness-error.ts";
import { findRepoRoot, resolveCapsulesDir, resolveScratchDir } from "../core/shared/paths.ts";
import { releaseFlock, tryExclusiveFlock } from "../platform/flock-ffi.ts";
import type { ReviewProtocolPolicy } from "../policy/repo-policy.ts";

export interface AgentMetadata {
  readonly agent_id: string;
  readonly role: string;
  readonly tier: number;
  readonly write_scope: readonly string[];
  readonly allowed_read_scope: readonly string[];
  readonly can_execute_shell: boolean;
  readonly spawned_at: string;
  readonly run_id?: string | undefined;
  readonly task_id?: string | undefined;
  readonly review_config?: ReviewProtocolPolicy | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

interface AgentMetadataDependencies {
  readonly findRepoRoot: () => string;
  readonly resolveCapsulesDir: (repoRoot?: string) => string;
  readonly resolveScratchDir: (repoRoot?: string) => string;
  readonly readDirectory: (
    path: string,
    options: { readonly withFileTypes: true },
  ) => readonly Dirent[];
  readonly readFile: (path: string, encoding: "utf-8") => string;
}

const defaultAgentMetadataDependencies: AgentMetadataDependencies = {
  findRepoRoot,
  resolveCapsulesDir,
  resolveScratchDir,
  readDirectory: (path, options) => readdirSync(path, options),
  readFile: readFileSync,
};

let agentMetadataDependencies = defaultAgentMetadataDependencies;
const activeAgentMetadataParents = new Set<string>();
const activeAgentMetadataParentInodes = new Set<string>();
const activeAgentMetadataRoots = new Set<string>();
const activeAgentMetadataRootInodes = new Set<string>();
const activeAgentMetadataParentIdentity = new Map<string, Pick<Stats, "dev" | "ino">>();
const activeAgentMetadataRootIdentity = new Map<string, Pick<Stats, "dev" | "ino">>();
const activeAgentMetadataAuthority = new Map<string, string>();

/** Test-only dependency seam for deterministic metadata-discovery failures and ordering. */
export function setAgentMetadataDependenciesForTesting(
  overrides: Partial<AgentMetadataDependencies>,
): () => void {
  const previousDependencies = agentMetadataDependencies;
  agentMetadataDependencies = { ...agentMetadataDependencies, ...overrides };
  return () => {
    agentMetadataDependencies = previousDependencies;
  };
}

export function inferTierFromRole(role: string): number {
  const normalized = role.trim().toLowerCase();
  if (normalized === "mind") return 0;
  if (normalized === "orchestrator") return 1;
  if (
    normalized === "coordinator" ||
    normalized === "meta-auditor" ||
    normalized === "meta_auditor" ||
    normalized === "mind-auditor" ||
    normalized === "mind_auditor"
  ) {
    return 2;
  }
  return 3;
}

export function inferCanExecuteShell(role: string): boolean {
  const normalized = role.trim().toLowerCase();
  // Cognitive validators are STRICTLY forbidden from shell execution (0 commands)
  if (
    normalized === "validator" ||
    normalized === "cognitive-validator" ||
    normalized === "cognitive_validator" ||
    normalized.startsWith("validator-") ||
    normalized === "critic" ||
    normalized === "completeness-critic" ||
    normalized === "completeness_critic" ||
    normalized === "planner" ||
    normalized === "plan-validator" ||
    normalized === "plan_validator" ||
    normalized === "sub-investigator" ||
    normalized === "sub_investigator" ||
    normalized === "mind" ||
    normalized === "orchestrator" ||
    normalized === "coordinator" ||
    normalized === "meta-auditor" ||
    normalized === "meta_auditor"
  ) {
    return false;
  }

  if (
    normalized === "implementer" ||
    normalized === "repairer" ||
    normalized === "sub-implementer" ||
    normalized === "sub_implementer" ||
    normalized === "mechanic-validator" ||
    normalized === "mechanic_validator" ||
    normalized === "sub-validator" ||
    normalized === "sub_validator" ||
    normalized === "worker"
  ) {
    return true;
  }

  return false;
}

export function createAgentMetadata(params: {
  readonly agent_id: string;
  readonly role: string;
  readonly tier?: number | undefined;
  readonly write_scope?: readonly string[] | undefined;
  readonly allowed_read_scope?: readonly string[] | undefined;
  readonly can_execute_shell?: boolean | undefined;
  readonly run_id?: string | undefined;
  readonly task_id?: string | undefined;
  readonly review_config?: ReviewProtocolPolicy | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}): AgentMetadata {
  const tier = params.tier !== undefined ? params.tier : inferTierFromRole(params.role);
  const roleCanExecute = inferCanExecuteShell(params.role);
  // Zero-shell roles (validators, supervisors, critics) can NEVER be overridden to true
  const canExecuteShell = !roleCanExecute
    ? false
    : params.can_execute_shell !== undefined
      ? params.can_execute_shell
      : true;

  return {
    agent_id: params.agent_id,
    role: params.role,
    tier,
    write_scope: params.write_scope ?? [],
    allowed_read_scope: params.allowed_read_scope ?? [],
    can_execute_shell: canExecuteShell,
    spawned_at: new Date().toISOString(),
    ...(params.run_id ? { run_id: params.run_id } : {}),
    ...(params.task_id ? { task_id: params.task_id } : {}),
    ...(params.review_config ? { review_config: params.review_config } : {}),
    ...(params.metadata ? { metadata: params.metadata } : {}),
  };
}

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

/** Writes metadata while the caller already holds the matching metadata mutation lock. */
export function writeAgentMetadataUnlocked(metadata: AgentMetadata, runRoot?: string): string {
  const filePath = getAgentMetadataPath(metadata.agent_id, runRoot);
  const serialized = serializeValidatedAgentMetadata(metadata, filePath);
  replaceAgentMetadataUnlocked(filePath, serialized);
  return filePath;
}

function requiredNoFollowFlag(): number {
  const flag = constants.O_NOFOLLOW;
  if (!Number.isInteger(flag) || flag === 0)
    throw new HarnessError("UNSUPPORTED_PLATFORM", "agent metadata storage requires O_NOFOLLOW");
  return flag;
}

function delay(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function sameInode(left: Pick<Stats, "dev" | "ino">, right: Pick<Stats, "dev" | "ino">): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function safeFailureCause(error: unknown): string {
  return readOwnDataString(error, "message") ?? "unknown error";
}

function assertRealDirectory(path: string, label: string): Stats {
  let metadata: Stats;
  try {
    metadata = lstatSync(path);
  } catch (error) {
    throw new HarnessError("INTEGRITY", `${label} is unavailable: ${safeFailureCause(error)}`);
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink())
    throw new HarnessError("PATH_SAFETY", `${label} must be a real directory: ${path}`);
  return metadata;
}

function openVerifiedDirectory(
  path: string,
  create: boolean,
  label: string,
): { descriptor: number; metadata: Stats } {
  if (!existsSync(path)) {
    if (!create) throw new HarnessError("INTEGRITY", `${label} is unavailable: ${path}`);
    try {
      mkdirSync(path, { recursive: true, mode: 0o700 });
    } catch (error) {
      throw new HarnessError("INTEGRITY", `failed to create ${label}: ${safeFailureCause(error)}`);
    }
  }
  const before = assertRealDirectory(path, label);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(
      path,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | requiredNoFollowFlag(),
    );
    const opened = fstatSync(descriptor);
    const after = assertRealDirectory(path, label);
    if (!opened.isDirectory() || !sameInode(before, opened) || !sameInode(opened, after))
      throw new HarnessError("INTEGRITY", `${label} changed while opening: ${path}`);
    return { descriptor, metadata: opened };
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    throw error;
  }
}

function acquireExclusiveLock(descriptor: number, path: string): void {
  const deadline = performance.now() + 10_000;
  while (!tryExclusiveFlock(descriptor)) {
    const remaining = deadline - performance.now();
    if (remaining <= 0)
      throw new HarnessError("LOCK_TIMEOUT", `timed out waiting for agent metadata lock: ${path}`);
    delay(Math.min(10, remaining));
  }
}

function serializeValidatedAgentMetadata(metadata: AgentMetadata, filePath: string): string {
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

function assertActiveMetadataAuthority(filePath: string): void {
  const parent = resolve(dirname(filePath));
  const root = activeAgentMetadataAuthority.get(parent);
  const expectedParent = activeAgentMetadataParentIdentity.get(parent);
  const expectedRoot = root === undefined ? undefined : activeAgentMetadataRootIdentity.get(root);
  if (
    root === undefined ||
    expectedParent === undefined ||
    expectedRoot === undefined ||
    !sameInode(expectedParent, assertRealDirectory(parent, "agent metadata runtime directory")) ||
    !sameInode(expectedRoot, assertRealDirectory(root, "agent metadata root"))
  ) {
    throw new HarnessError(
      "INTEGRITY",
      `agent metadata authority changed before write: ${filePath}`,
    );
  }
}

function assertRegularMetadataFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  const metadata = lstatSync(filePath);
  if (metadata.isSymbolicLink() || !metadata.isFile())
    throw new HarnessError("PATH_SAFETY", `agent metadata must be a regular file: ${filePath}`);
  if (metadata.nlink > 1) {
    throw new HarnessError(
      "INTEGRITY",
      `agent metadata must not have multiple hard links: ${filePath}`,
    );
  }
}

function assertExistingMetadataAuthorityFiles(filePath: string): void {
  assertRegularMetadataFile(filePath);
  const name = filePath.slice(filePath.lastIndexOf("/") + 1);
  const canonical = /^agent-(.+)\.json$/.exec(name);
  if (canonical?.[1]) {
    assertRegularMetadataFile(join(dirname(filePath), `${canonical[1]}.json`));
  }
}

function fsyncDirectory(path: string): void {
  const descriptor = openSync(
    path,
    constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | requiredNoFollowFlag(),
  );
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

/** Writes a prevalidated JSON document while an agent-metadata mutation lock is held. */
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

/** Serializes metadata read/modify/write operations through stable run-root and runtime-directory locks. */
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

function readOwnDataString(error: unknown, property: "code" | "message"): string | null {
  if (error === null || (typeof error !== "object" && typeof error !== "function")) {
    return null;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, property);
    return descriptor && "value" in descriptor && typeof descriptor.value === "string"
      ? descriptor.value
      : null;
  } catch {
    return null;
  }
}

function isTrustedEnoent(error: unknown): boolean {
  try {
    return error instanceof Error && readOwnDataString(error, "code") === "ENOENT";
  } catch {
    return false;
  }
}

function formatSafeErrorCause(error: unknown): string {
  const message = readOwnDataString(error, "message");
  if (message !== null) return message;
  if (error === null || (typeof error !== "object" && typeof error !== "function")) {
    try {
      return String(error);
    } catch {
      return "unknown error";
    }
  }
  return "unknown error";
}

function metadataIntegrityError(filePath: string, reason: string): never {
  throw new HarnessError("INTEGRITY", `invalid agent metadata at '${filePath}': ${reason}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function assertSafeAgentId(agentId: string): void {
  if (
    !isNonEmptyString(agentId) ||
    agentId === "." ||
    agentId === ".." ||
    /[\\/\0]/.test(agentId)
  ) {
    throw new HarnessError("PATH_SAFETY", "agent_id must be a safe single path component");
  }
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function parseReviewConfig(value: unknown, filePath: string): ReviewProtocolPolicy {
  if (!isRecord(value)) {
    metadataIntegrityError(filePath, "review_config must be an object");
  }
  const maxAdversarialPushes = value["max_adversarial_pushes"];
  if (
    typeof maxAdversarialPushes !== "number" ||
    !Number.isSafeInteger(maxAdversarialPushes) ||
    maxAdversarialPushes < 1
  ) {
    metadataIntegrityError(
      filePath,
      "review_config.max_adversarial_pushes must be a safe integer greater than zero",
    );
  }
  const cognitivePushes = value["cognitive_pushes"];
  if (
    typeof cognitivePushes !== "number" ||
    !Number.isSafeInteger(cognitivePushes) ||
    cognitivePushes < 0
  ) {
    metadataIntegrityError(
      filePath,
      "review_config.cognitive_pushes must be a nonnegative safe integer",
    );
  }
  const escalation = value["escalate_on_exhausted_adversarial"];
  if (escalation !== undefined && typeof escalation !== "boolean") {
    metadataIntegrityError(
      filePath,
      "review_config.escalate_on_exhausted_adversarial must be a boolean when present",
    );
  }
  return {
    max_adversarial_pushes: maxAdversarialPushes,
    cognitive_pushes: cognitivePushes,
    ...(escalation === undefined ? {} : { escalate_on_exhausted_adversarial: escalation }),
  };
}

function validateAgentMetadata(
  value: unknown,
  expectedAgentId: string,
  filePath: string,
): AgentMetadata {
  if (!isRecord(value)) metadataIntegrityError(filePath, "expected a JSON object");
  const agentId = value["agent_id"];
  if (!isNonEmptyString(agentId))
    metadataIntegrityError(filePath, "agent_id must be a nonempty string");
  if (agentId !== expectedAgentId) {
    metadataIntegrityError(
      filePath,
      `agent_id '${agentId}' does not match requested '${expectedAgentId}'`,
    );
  }
  const role = value["role"];
  if (!isNonEmptyString(role)) metadataIntegrityError(filePath, "role must be a nonempty string");
  const tier = value["tier"];
  if (typeof tier !== "number" || !Number.isSafeInteger(tier) || tier < 0 || tier > 3) {
    metadataIntegrityError(filePath, "tier must be a safe integer in the range 0 through 3");
  }
  const writeScope = value["write_scope"];
  if (!isStringArray(writeScope))
    metadataIntegrityError(filePath, "write_scope must be an array of strings");
  const allowedReadScope = value["allowed_read_scope"];
  if (!isStringArray(allowedReadScope)) {
    metadataIntegrityError(filePath, "allowed_read_scope must be an array of strings");
  }
  const canExecuteShell = value["can_execute_shell"];
  if (typeof canExecuteShell !== "boolean") {
    metadataIntegrityError(filePath, "can_execute_shell must be a boolean");
  }
  const spawnedAt = value["spawned_at"];
  if (!isNonEmptyString(spawnedAt))
    metadataIntegrityError(filePath, "spawned_at must be a nonempty string");

  const runId = value["run_id"];
  if (runId !== undefined && !isNonEmptyString(runId)) {
    metadataIntegrityError(filePath, "run_id must be a nonempty string when present");
  }
  const taskId = value["task_id"];
  if (taskId !== undefined && !isNonEmptyString(taskId)) {
    metadataIntegrityError(filePath, "task_id must be a nonempty string when present");
  }
  const reviewConfig = value["review_config"];
  const metadata = value["metadata"];
  if (metadata !== undefined && !isRecord(metadata)) {
    metadataIntegrityError(filePath, "metadata must be an object when present");
  }

  return {
    agent_id: agentId,
    role,
    tier,
    write_scope: writeScope,
    allowed_read_scope: allowedReadScope,
    can_execute_shell: canExecuteShell,
    spawned_at: spawnedAt,
    ...(runId === undefined ? {} : { run_id: runId }),
    ...(taskId === undefined ? {} : { task_id: taskId }),
    ...(reviewConfig === undefined
      ? {}
      : { review_config: parseReviewConfig(reviewConfig, filePath) }),
    ...(metadata === undefined ? {} : { metadata }),
  };
}

function readAgentMetadataFileSecure(filePath: string): string {
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

function readAgentMetadataFile(
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

function readAgentMetadataAtRoot(
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

function readCapsuleRoots(capsulesDir: string): readonly string[] {
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
