import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
  readdirSync,
  statSync,
  openSync,
  renameSync,
  rmSync,
  writeSync,
  type Stats,
} from "node:fs";
import { join, resolve, dirname, basename, isAbsolute } from "node:path";
import { randomBytes } from "node:crypto";
import { randomUUID } from "node:crypto";
import { HarnessError } from "../core/errors/harness-error.ts";
import { isJsonObject, type JsonObject } from "../core/contracts/json.ts";
import {
  findRepoRoot,
  isInsideCapsule,
  isTestEnvironment,
  resolveCapsulesDir,
  resolveScratchDir,
} from "../core/shared/paths.ts";
import { loadRun } from "../engine/store/load.ts";
import { readAgentLedger } from "../workflow/agents/ledger.ts";
import { releaseFlock, tryExclusiveFlock } from "../platform/flock-ffi.ts";

let sessionPersistenceObserver:
  | ((step: "file-fsync" | "rename" | "directory-fsync", path: string) => void)
  | undefined;
let sessionLockCleanupFault: { enabled: boolean; value: unknown } = {
  enabled: false,
  value: undefined,
};

/** Test-only durable-write observer. */
export function setSessionPersistenceObserverForTesting(
  observer: ((step: "file-fsync" | "rename" | "directory-fsync", path: string) => void) | undefined,
): () => void {
  const previous = sessionPersistenceObserver;
  sessionPersistenceObserver = observer;
  return () => {
    sessionPersistenceObserver = previous;
  };
}

/** Test-only cleanup fault seam for primary-error precedence. */
export function setSessionLockCleanupFailureForTesting(value: unknown): () => void {
  const previous = sessionLockCleanupFault;
  sessionLockCleanupFault = { enabled: true, value };
  return () => {
    sessionLockCleanupFault = previous;
  };
}
import {
  agentIdToRole,
  agentIdToTier,
  roleToTier,
  type ExecutionTier,
  detectHostApp,
} from "./thread-identifier.ts";

export interface SessionIdentity {
  readonly agent_id: string;
  readonly role: string;
  readonly tier: ExecutionTier;
  readonly token: string;
  readonly pid: number;
  readonly ppid: number;
  readonly run_id?: string | undefined;
  readonly task_id?: string | undefined;
  readonly write_scope?: readonly string[] | undefined;
  readonly can_execute_shell: boolean;
  readonly can_edit_files: boolean;
  readonly host: string;
  readonly mechanisms_detected: readonly string[];
  readonly granted_at: string;
}

export interface RegisterSessionOptions {
  runRoot?: string | undefined;
  agentId: string;
  role: string;
  host?: string | undefined;
  pid?: number | undefined;
  ppid?: number | undefined;
  taskId?: string | undefined;
  writeScope?: readonly string[] | undefined;
  worktreeDir?: string | undefined;
  customToken?: string | undefined;
}

export function pruneStaleSessions(maxAgeMs = 86400000): void {
  const globalDir = resolveGlobalSessionsDir(findRepoRoot());
  if (!existsSync(globalDir)) return;

  try {
    const files = readdirSync(globalDir);
    const now = Date.now();
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const filePath = join(globalDir, file);
      try {
        const stats = statSync(filePath);
        if (now - stats.mtimeMs > maxAgeMs) {
          unlinkSync(filePath);
          continue;
        }

        const pidStr = file.replace(".json", "");
        const pid = parseInt(pidStr, 10);
        if (!Number.isNaN(pid) && pid > 0) {
          try {
            process.kill(pid, 0);
          } catch (e: unknown) {
            if (readOwnDataString(e, "code") === "ESRCH") {
              unlinkSync(filePath);
            }
          }
        }
      } catch {
        // Best-effort removal
      }
    }
  } catch {
    // Best-effort directory read
  }
}

export interface ResolveSessionOptions {
  cwd?: string | undefined;
  pid?: number | undefined;
  ppid?: number | undefined;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined> | undefined;
  explicitActor?: string | undefined;
  explicitToken?: string | undefined;
  runRoot?: string | undefined;
  readPersistedSessionFile?: ((path: string, encoding: "utf8") => string) | undefined;
}

function resolveGlobalSessionsDir(repoRoot?: string): string {
  if (repoRoot) {
    const resolved = resolve(repoRoot);
    if (isTestEnvironment() && resolved === findRepoRoot()) {
      return join(resolveScratchDir(), ".sessions");
    }
    return join(resolved, ".olt", ".sessions");
  }
  if (isTestEnvironment()) {
    return join(resolveScratchDir(), ".sessions");
  }
  return join(findRepoRoot(), ".olt", ".sessions");
}

function resolveSessionRepositoryRoot(runRoot: string | undefined, cwd: string): string {
  if (runRoot !== undefined && runRoot.trim() !== "") {
    const raw = runRoot.trim();
    const anchor = isAbsolute(raw) ? resolve(raw) : resolve(cwd, raw);
    return findRepoRoot(anchor);
  }
  return findRepoRoot(cwd);
}

function noFollow(): number {
  const flag = constants.O_NOFOLLOW;
  if (!Number.isInteger(flag) || flag === 0)
    throw new HarnessError("UNSUPPORTED_PLATFORM", "session authority requires O_NOFOLLOW");
  return flag;
}

function sameInode(left: Pick<Stats, "dev" | "ino">, right: Pick<Stats, "dev" | "ino">): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function assertRealDirectory(path: string, label: string): Stats {
  const metadata = lstatSync(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink())
    throw new HarnessError("PATH_SAFETY", `${label} must be a real directory: ${path}`);
  return metadata;
}

function openVerifiedDirectory(
  path: string,
  create: boolean,
  label: string,
): { fd: number; stat: Stats } {
  if (!existsSync(path)) {
    if (!create) throw new HarnessError("INTEGRITY", `${label} is unavailable: ${path}`);
    mkdirSync(path, { recursive: true, mode: 0o700 });
  }
  const before = assertRealDirectory(path, label);
  const fd = openSync(path, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | noFollow());
  try {
    const opened = fstatSync(fd);
    const after = assertRealDirectory(path, label);
    if (!opened.isDirectory() || !sameInode(before, opened) || !sameInode(opened, after))
      throw new HarnessError("INTEGRITY", `${label} changed while opening: ${path}`);
    return { fd, stat: opened };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

function assertSingleLinkRegular(path: string): Stats | undefined {
  if (!existsSync(path)) return undefined;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile())
    throw new HarnessError("PATH_SAFETY", `session authority must be a regular file: ${path}`);
  if (stat.nlink !== 1)
    throw new HarnessError(
      "INTEGRITY",
      `session authority must have exactly one hard link: ${path}`,
    );
  return stat;
}

function secureReadSession(path: string): string {
  const before = assertSingleLinkRegular(path);
  if (!before) {
    const error = Object.assign(new Error("missing session"), { code: "ENOENT" });
    throw error;
  }
  const fd = openSync(path, constants.O_RDONLY | noFollow());
  try {
    const opened = fstatSync(fd);
    const after = assertSingleLinkRegular(path);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      !after ||
      !sameInode(before, opened) ||
      !sameInode(opened, after)
    )
      throw new HarnessError("INTEGRITY", `session authority changed while opening: ${path}`);
    return readFileSync(fd, "utf8");
  } finally {
    closeSync(fd);
  }
}

function atomicSessionWrite(path: string, payload: string): void {
  assertSingleLinkRegular(path);
  const parent = dirname(path);
  const temporary = join(parent, `.${basename(path)}.${randomUUID()}.tmp`);
  let fd: number | undefined;
  try {
    fd = openSync(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow(),
      0o600,
    );
    const bytes = Buffer.from(payload);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const wrote = writeSync(fd, bytes, offset, bytes.byteLength - offset);
      if (wrote <= 0)
        throw new HarnessError("INTEGRITY", "session authority write made no progress");
      offset += wrote;
    }
    fsyncSync(fd);
    sessionPersistenceObserver?.("file-fsync", path);
    closeSync(fd);
    fd = undefined;
    assertSingleLinkRegular(path);
    renameSync(temporary, path);
    sessionPersistenceObserver?.("rename", path);
    const directory = openSync(
      parent,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | noFollow(),
    );
    try {
      fsyncSync(directory);
      sessionPersistenceObserver?.("directory-fsync", path);
    } finally {
      closeSync(directory);
    }
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temporary)) rmSync(temporary);
    throw error;
  }
}

function withSessionAuthorityLock<T>(repoRoot: string, directory: string, operation: () => T): T {
  const root = openVerifiedDirectory(repoRoot, false, "session repository root");
  let session: { fd: number; stat: Stats } | undefined;
  let rootLocked = false;
  let sessionLocked = false;
  let primary: unknown;
  let hasPrimary = false;
  let cleanup: unknown;
  let hasCleanup = false;
  let result!: T;
  try {
    if (!tryExclusiveFlock(root.fd))
      throw new HarnessError("LOCK_TIMEOUT", "session repository lock is busy");
    rootLocked = true;
    const olt = dirname(directory);
    assertRealDirectory(olt, "session authority parent");
    session = openVerifiedDirectory(directory, true, "session authority directory");
    if (!tryExclusiveFlock(session.fd))
      throw new HarnessError("LOCK_TIMEOUT", "session directory lock is busy");
    sessionLocked = true;
    if (
      !sameInode(root.stat, assertRealDirectory(repoRoot, "session repository root")) ||
      !sameInode(session.stat, assertRealDirectory(directory, "session authority directory"))
    )
      throw new HarnessError("INTEGRITY", "session authority changed while locked");
    result = operation();
  } catch (error) {
    hasPrimary = true;
    primary = error;
  }
  for (const action of [
    () => {
      if (sessionLockCleanupFault.enabled) throw sessionLockCleanupFault.value;
      if (session && sessionLocked) releaseFlock(session.fd);
    },
    () => {
      if (session) closeSync(session.fd);
    },
    () => {
      if (rootLocked) releaseFlock(root.fd);
    },
    () => closeSync(root.fd),
  ]) {
    try {
      action();
    } catch (error) {
      if (!hasCleanup) {
        hasCleanup = true;
        cleanup = error;
      }
    }
  }
  if (hasPrimary) throw primary;
  if (hasCleanup) throw cleanup;
  return result;
}

function readOwnDataString(error: unknown, key: "code" | "message"): string | null {
  if ((typeof error !== "object" && typeof error !== "function") || error === null) {
    return null;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, key);
    return descriptor && "value" in descriptor && typeof descriptor.value === "string"
      ? descriptor.value
      : null;
  } catch {
    return null;
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

function readPersistedSession(
  path: string,
  mechanism: string,
  readSessionFile: (path: string, encoding: "utf8") => string,
): JsonObject | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readSessionFile(path, "utf8"));
  } catch (error: unknown) {
    if (readOwnDataString(error, "code") === "ENOENT") {
      return null;
    }
    throw new HarnessError(
      "INTEGRITY",
      `failed to read persisted ${mechanism} session evidence at ${path}: ${formatSafeErrorCause(error)}`,
    );
  }

  const invalid = (cause: string): never => {
    throw new HarnessError(
      "INTEGRITY",
      `invalid persisted ${mechanism} session evidence at ${path}: ${cause}`,
    );
  };

  const session: JsonObject = isJsonObject(parsed) ? parsed : invalid("expected a JSON object");
  if (typeof session.agent_id !== "string" || !session.agent_id.trim()) {
    invalid("agent_id must be a nonempty string");
  }
  for (const field of ["role", "token"] as const) {
    if (field in session && (typeof session[field] !== "string" || !session[field].trim())) {
      invalid(`${field} must be a nonempty string when present`);
    }
  }
  for (const field of ["can_execute_shell", "can_edit_files"] as const) {
    if (field in session && typeof session[field] !== "boolean") {
      invalid(`${field} must be a boolean when present`);
    }
  }
  if (
    "write_scope" in session &&
    (!Array.isArray(session.write_scope) ||
      session.write_scope.some((entry) => typeof entry !== "string"))
  ) {
    invalid("write_scope must be an array of strings when present");
  }
  for (const field of ["task_id", "granted_at"] as const) {
    if (field in session && typeof session[field] !== "string") {
      invalid(`${field} must be a string when present`);
    }
  }

  return session;
}

function inferCanExecute(role: string): { can_execute_shell: boolean; can_edit_files: boolean } {
  const normalized = role.trim().toLowerCase();
  if (
    normalized === "validator" ||
    normalized === "cognitive-validator" ||
    normalized === "cognitive_validator" ||
    normalized.startsWith("validator-") ||
    normalized === "critic" ||
    normalized === "completeness-critic" ||
    normalized === "completeness_critic" ||
    normalized === "plan-validator" ||
    normalized === "plan_validator" ||
    normalized === "sub-investigator"
  ) {
    return { can_execute_shell: false, can_edit_files: false };
  }
  if (
    normalized === "mind" ||
    normalized === "orchestrator" ||
    normalized === "coordinator" ||
    normalized === "meta-auditor" ||
    normalized === "meta_auditor"
  ) {
    return { can_execute_shell: true, can_edit_files: false };
  }
  return { can_execute_shell: true, can_edit_files: true };
}

function assertSafeSessionComponent(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "." || trimmed === ".." || /[\\/\0]/.test(trimmed)) {
    throw new HarnessError("INVALID_ARGUMENT", `${field} must be a safe single path component`);
  }
  return trimmed;
}

function assertSessionPid(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new HarnessError("INVALID_ARGUMENT", `${field} must be a positive safe integer`);
  }
  return value;
}

function restoreSessionSnapshots(
  snapshots: readonly { path: string; bytes: string | null }[],
): void {
  for (const snapshot of snapshots) {
    try {
      if (snapshot.bytes === null) {
        if (existsSync(snapshot.path)) unlinkSync(snapshot.path);
      } else {
        writeFileSync(snapshot.path, snapshot.bytes, "utf8");
      }
    } catch {
      // The original persistence failure remains authoritative; restore is best effort.
    }
  }
}

/**
 * Registers an authenticated session grant on disk and binds process ancestry.
 */
export function registerSessionGrant(options: RegisterSessionOptions): SessionIdentity {
  const repoRoot = findRepoRoot(options.runRoot);
  const agentId = assertSafeSessionComponent(options.agentId, "agentId");
  const role = assertSafeSessionComponent(options.role, "role");
  const token = options.customToken ?? `tok_live_${randomBytes(24).toString("hex")}`;
  if (typeof token !== "string" || !token.trim()) {
    throw new HarnessError("INVALID_ARGUMENT", "customToken must be a nonempty string");
  }
  const pid = assertSessionPid(
    options.pid ?? (typeof process !== "undefined" ? process.pid : 0),
    "pid",
  );
  const ppid = assertSessionPid(
    options.ppid ?? (typeof process !== "undefined" ? process.ppid : 0),
    "ppid",
  );
  const tier = (roleToTier(role) ?? agentIdToTier(agentId) ?? 3) as ExecutionTier;
  const { can_execute_shell, can_edit_files } = inferCanExecute(role);
  const host = options.host ?? detectHostApp(process.env);
  const granted_at = new Date().toISOString();

  let resolvedRunRoot: string | undefined;
  if (options.runRoot && options.runRoot.trim()) {
    const trimmed = options.runRoot.trim();
    if (isAbsolute(trimmed) || isInsideCapsule(trimmed)) {
      resolvedRunRoot = resolve(trimmed);
    } else {
      resolvedRunRoot = join(resolveCapsulesDir(repoRoot), trimmed);
    }
  }

  const session: SessionIdentity = {
    agent_id: agentId,
    role,
    tier,
    token,
    pid,
    ppid,
    run_id: resolvedRunRoot ? basename(resolvedRunRoot) : undefined,
    task_id: options.taskId,
    write_scope: options.writeScope,
    can_execute_shell,
    can_edit_files,
    host,
    mechanisms_detected: ["registration"],
    granted_at,
  };

  const payload = JSON.stringify(session, null, 2);

  // 1. Atomically stage the required global PID/PPID authority set. A failed second
  // write restores every prior byte and removes newly-created grants.
  const globalDir = resolveGlobalSessionsDir(repoRoot);
  try {
    mkdirSync(globalDir, { recursive: true });
    const paths = [...new Set([pid, ppid])].map((processId) =>
      join(globalDir, `${processId}.json`),
    );
    const snapshots = paths.map((path) => ({
      path,
      bytes: existsSync(path) ? readFileSync(path, "utf8") : null,
    }));
    try {
      withSessionAuthorityLock(repoRoot, globalDir, () => {
        for (const path of paths) atomicSessionWrite(path, payload);
      });
    } catch (error) {
      restoreSessionSnapshots(snapshots);
      throw error;
    }
  } catch (error: unknown) {
    throw new HarnessError(
      "INTEGRITY",
      `failed to persist process-ancestry session grant in ${globalDir}: ${formatSafeErrorCause(error)}`,
    );
  }

  // 2. Write Capsule Runtime Session
  if (resolvedRunRoot) {
    const runtimeSessionsDir = join(resolvedRunRoot, "runtime", "sessions");
    try {
      mkdirSync(runtimeSessionsDir, { recursive: true });
      writeFileSync(join(runtimeSessionsDir, `${agentId}.json`), payload, "utf8");
    } catch {
      // Best-effort
    }
  }

  // 3. Write Worktree Local Session
  if (options.worktreeDir && existsSync(options.worktreeDir)) {
    try {
      writeFileSync(join(options.worktreeDir, ".session.json"), payload, "utf8");
    } catch {
      // Best-effort
    }
  }

  return session;
}

/** Removes only the required process-session records created for a failed higher-level grant. */
export function revokeSessionGrant(options: {
  readonly runRoot?: string | undefined;
  readonly agentId: string;
  readonly pid: number;
  readonly ppid: number;
}): void {
  const repoRoot = findRepoRoot(options.runRoot);
  const agentId = assertSafeSessionComponent(options.agentId, "agentId");
  const pid = assertSessionPid(options.pid, "pid");
  const ppid = assertSessionPid(options.ppid, "ppid");
  for (const processId of new Set([pid, ppid])) {
    const path = join(resolveGlobalSessionsDir(repoRoot), `${processId}.json`);
    if (existsSync(path)) unlinkSync(path);
  }
  if (options.runRoot && options.runRoot.trim()) {
    const runRoot = resolve(options.runRoot);
    const path = join(runRoot, "runtime", "sessions", `${agentId}.json`);
    if (existsSync(path)) unlinkSync(path);
  }
}

/**
 * Executes all 3 identity detection mechanisms simultaneously, aggregating
 * detected agent attributes and enforcing cryptographic anti-spoofing interlocks.
 */
export function resolveActiveSession(options: ResolveSessionOptions = {}): SessionIdentity | null {
  const cwd = resolve(options.cwd ?? (typeof process !== "undefined" ? process.cwd() : "."));
  const env = options.env ?? (typeof process !== "undefined" ? process.env : {});
  const readSessionFile: (path: string, encoding: "utf8") => string =
    options.readPersistedSessionFile ?? ((path) => secureReadSession(path));
  const pid = options.pid ?? (typeof process !== "undefined" ? process.pid : 0);
  const ppid = options.ppid ?? (typeof process !== "undefined" ? process.ppid : 0);
  let repoRoot: string;
  try {
    repoRoot = resolveSessionRepositoryRoot(options.runRoot, cwd);
  } catch (error) {
    if (error instanceof HarnessError && error.code === "PATH_SAFETY") {
      return null;
    }
    throw error;
  }
  const mechanisms: string[] = [];

  let detectedAgentId: string | null = null;
  let detectedRole: string | null = null;
  let detectedToken: string | null = null;
  let detectedTier: ExecutionTier | null = null;
  let detectedHost: string = detectHostApp(env);
  let detectedCanShell = true;
  let detectedCanEdit = true;
  let detectedWriteScope: readonly string[] | undefined;
  let detectedTaskId: string | undefined;
  let grantedAt = new Date().toISOString();

  // Mechanism 1: Environment Variables & Injected Session Tokens
  const envToken = env["HARNESS_TOKEN"] || env["HARNESS_SESSION_TOKEN"];
  const envAgent = env["AGENT_ID"] || env["HARNESS_AGENT_ID"];
  const envRole = env["ROLE"] || env["HARNESS_ROLE"];

  if (envToken || envAgent || envRole) {
    mechanisms.push("environment_variables");
    if (envToken) detectedToken = envToken.trim();
    if (envAgent) detectedAgentId = envAgent.trim();
    if (envRole) detectedRole = envRole.trim();
  }

  // Mechanism 2: Process Tree (PID / PPID) Session Registry
  const globalSessionsDir = resolveGlobalSessionsDir(repoRoot);
  const checkPids = [ppid, pid].filter((p) => p > 0);

  for (const checkPid of checkPids) {
    const sessionFile = join(globalSessionsDir, `${checkPid}.json`);
    const mechanism = `process_ancestry_pid_${checkPid}`;
    const parsed = readPersistedSession(sessionFile, mechanism, readSessionFile);
    if (!parsed) continue;
    mechanisms.push(mechanism);
    if (!detectedAgentId) detectedAgentId = parsed.agent_id as string;
    if (!detectedRole && typeof parsed.role === "string") detectedRole = parsed.role;
    if (!detectedToken && typeof parsed.token === "string") detectedToken = parsed.token;
    if (typeof parsed.can_execute_shell === "boolean") detectedCanShell = parsed.can_execute_shell;
    if (typeof parsed.can_edit_files === "boolean") detectedCanEdit = parsed.can_edit_files;
    if (Array.isArray(parsed.write_scope)) detectedWriteScope = parsed.write_scope as string[];
    if (typeof parsed.task_id === "string") detectedTaskId = parsed.task_id;
    if (typeof parsed.granted_at === "string") grantedAt = parsed.granted_at;
    break;
  }

  // Mechanism 3: Directory / Workspace Anchoring (.session.json or .olt-identity.json)
  let currentDir = cwd;
  while (true) {
    const sessionPath = join(currentDir, ".session.json");
    const identityPath = join(currentDir, ".olt-identity.json");
    const session = readPersistedSession(
      sessionPath,
      "workspace_directory_session",
      readSessionFile,
    );
    const parsed =
      session ?? readPersistedSession(identityPath, "workspace_directory_session", readSessionFile);

    if (parsed) {
      mechanisms.push("workspace_directory_session");
      if (!detectedAgentId) detectedAgentId = parsed.agent_id as string;
      if (!detectedRole && typeof parsed.role === "string") detectedRole = parsed.role;
      if (!detectedToken && typeof parsed.token === "string") detectedToken = parsed.token;
      if (typeof parsed.can_execute_shell === "boolean")
        detectedCanShell = parsed.can_execute_shell;
      if (typeof parsed.can_edit_files === "boolean") detectedCanEdit = parsed.can_edit_files;
      if (Array.isArray(parsed.write_scope)) detectedWriteScope = parsed.write_scope as string[];
      if (typeof parsed.task_id === "string") detectedTaskId = parsed.task_id;
      if (typeof parsed.granted_at === "string") grantedAt = parsed.granted_at;
      break;
    }

    const parent = dirname(currentDir);
    if (parent === currentDir || currentDir === repoRoot) break;
    currentDir = parent;
  }

  // If no identity detected across all 3 mechanisms, return null
  if (!detectedAgentId && !detectedRole && !detectedToken) {
    return null;
  }

  // Fill in missing derived fields
  const finalRole =
    detectedRole ?? (detectedAgentId ? agentIdToRole(detectedAgentId) : null) ?? "implementer";
  const finalAgentId = detectedAgentId ?? `agent-${finalRole}`;
  const finalTier = (roleToTier(finalRole) ?? agentIdToTier(finalAgentId) ?? 3) as ExecutionTier;
  const finalToken = detectedToken ?? options.explicitToken ?? "unauthenticated";

  // Anti-Spoofing Interlock: If explicit actor is specified, verify it matches detected identity
  if (options.explicitActor) {
    const requestedActor = options.explicitActor.trim();
    if (
      requestedActor !== finalAgentId &&
      requestedActor !== finalRole &&
      requestedActor !== `agent-${finalRole}`
    ) {
      // If tokens match, allow delegation; otherwise reject spoofing attempt
      if (!options.explicitToken || options.explicitToken !== detectedToken) {
        throw new HarnessError(
          "AUTHENTICATION_FAILURE",
          `Actor spoofing blocked: caller verified as '${finalAgentId}' (${finalRole}) cannot execute as '${requestedActor}' without matching credentials.`,
        );
      }
    }
  }

  return {
    agent_id: finalAgentId,
    role: finalRole,
    tier: finalTier,
    token: finalToken,
    pid,
    ppid,
    task_id: detectedTaskId,
    write_scope: detectedWriteScope,
    can_execute_shell: detectedCanShell,
    can_edit_files: detectedCanEdit,
    host: detectedHost,
    mechanisms_detected: mechanisms,
    granted_at: grantedAt,
  };
}

function isSessionLedgerBacked(
  runRoot: string | undefined,
  agentId: string,
  role: string,
): boolean {
  const trimmed = runRoot?.trim();
  if (!trimmed) return false;
  try {
    const repoRoot = findRepoRoot(trimmed);
    const resolved =
      isAbsolute(trimmed) || isInsideCapsule(trimmed)
        ? resolve(trimmed)
        : join(resolveCapsulesDir(repoRoot), trimmed);
    if (!existsSync(join(resolved, "state.json"))) return false;
    const ledger = readAgentLedger(loadRun(resolved).state);
    return ledger.some(
      (entry) => entry.id === agentId && entry.status === "active" && entry.role === role,
    );
  } catch {
    return false;
  }
}

/**
 * Auto-derives caller credentials for any CLI command, ensuring agents never have
 * to pass manual --actor flags while mechanically blocking unauthorized identity spoofing.
 */
export function autoDeriveCallerIdentity(
  options: ResolveSessionOptions & { requiredRole?: string | undefined } = {},
): {
  actor: string;
  role: string;
  tier: ExecutionTier;
  token?: string | undefined;
  mechanisms: readonly string[];
  verified: boolean;
} {
  const session = resolveActiveSession(options);

  if (session) {
    const fileBased = session.mechanisms_detected.some(
      (mechanism) =>
        mechanism.startsWith("process_ancestry_pid_") ||
        mechanism === "workspace_directory_session",
    );
    const envBased = session.mechanisms_detected.includes("environment_variables");
    const verified = fileBased
      ? isSessionLedgerBacked(options.runRoot, session.agent_id, session.role)
      : !envBased;
    return {
      actor: session.agent_id,
      role: session.role,
      tier: session.tier,
      token: session.token,
      mechanisms: session.mechanisms_detected,
      verified,
    };
  }

  // Fallback for interactive human terminal / root mind shell (Tier 0)
  const explicit = options.explicitActor?.trim();
  const fallbackRole = explicit ? (agentIdToRole(explicit) ?? explicit) : "mind";
  const fallbackTier = (roleToTier(fallbackRole) ??
    (explicit ? agentIdToTier(explicit) : 0) ??
    0) as ExecutionTier;

  return {
    actor: explicit ?? "mind",
    role: fallbackRole,
    tier: fallbackTier,
    token: options.explicitToken,
    mechanisms: ["interactive_terminal_fallback"],
    verified: false,
  };
}
