import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { HarnessError } from "../../core/errors/index.ts";
import { findRepoRoot, isInsideCapsule, resolveCapsulesDir } from "../../core/shared/paths.ts";
import { agentIdToTier, detectHostApp, roleToTier, type ExecutionTier } from "../thread/index.ts";
import { assertSafeSessionComponent, assertSessionPid, resolveGlobalSessionsDir } from "./paths.ts";
import {
  atomicSessionWrite,
  deleteInMemorySessionData,
  enableInMemorySessionStore,
  formatSafeErrorCause,
  getInMemorySessionStore,
  inferCanExecute,
  isInMemorySessionStoreEnabled,
  readOwnDataString,
  restoreSnapshotIfUnchanged,
  setInMemorySessionData,
  snapshotSession,
  withSessionAuthorityLock,
} from "./io.ts";
import type {
  RegisterSessionOptions,
  SessionIdentity,
  SessionSnapshot,
  StagedSessionGrant,
} from "./types.ts";

export { assertActiveCapsuleLease } from "./capsule-lease.ts";

function resolveSessionRepoRoot(runRoot?: string): string {
  try {
    return findRepoRoot(runRoot);
  } catch (error) {
    if (isInMemorySessionStoreEnabled()) return runRoot ? resolve(runRoot) : "/virtual/repo";
    throw error;
  }
}

function resolveRunRootPath(runRoot: string, repoRoot: string): string {
  const trimmed = runRoot.trim();
  return isAbsolute(trimmed) || isInsideCapsule(trimmed)
    ? resolve(trimmed)
    : join(resolveCapsulesDir(repoRoot), trimmed);
}

export function stageSessionGrant(options: RegisterSessionOptions): StagedSessionGrant {
  const repoRoot = resolveSessionRepoRoot(options.runRoot);
  const agentId = assertSafeSessionComponent(options.agentId, "agentId");
  const role = assertSafeSessionComponent(options.role, "role");
  const token = options.customToken ?? `tok_live_${randomBytes(24).toString("hex")}`;
  if (typeof token !== "string" || !token.trim())
    throw new HarnessError("INVALID_ARGUMENT", "customToken must be a nonempty string");
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
  if (options.runRoot && options.runRoot.trim())
    resolvedRunRoot = resolveRunRootPath(options.runRoot, repoRoot);

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
  const bindProcessAncestry = options.bindProcessAncestry ?? true;
  const globalDir = resolveGlobalSessionsDir(repoRoot);
  const paths = bindProcessAncestry
    ? [...new Set([pid, ppid])].map((p) => join(globalDir, `${p}.json`))
    : [];
  let processSnapshots: readonly SessionSnapshot[] = [];
  let capsuleSnapshot: SessionSnapshot | undefined;

  if (paths.length > 0) {
    try {
      if (!isInMemorySessionStoreEnabled()) mkdirSync(globalDir, { recursive: true });
      withSessionAuthorityLock(repoRoot, globalDir, () => {
        processSnapshots = paths.map(snapshotSession);
        try {
          for (const path of paths) atomicSessionWrite(path, payload);
        } catch (error) {
          for (const snapshot of processSnapshots) restoreSnapshotIfUnchanged(snapshot, payload);
          throw error;
        }
      });
    } catch (error: unknown) {
      throw new HarnessError(
        "INTEGRITY",
        `failed to persist process-ancestry session grant in ${globalDir}: ${formatSafeErrorCause(error)}`,
      );
    }
  }

  if (resolvedRunRoot) {
    const runtimeSessionsDir = join(resolvedRunRoot, "runtime", "sessions");
    const path = join(runtimeSessionsDir, `${agentId}.json`);
    if (isInMemorySessionStoreEnabled()) {
      capsuleSnapshot = snapshotSession(path);
      setInMemorySessionData(path, payload);
    } else {
      try {
        mkdirSync(runtimeSessionsDir, { recursive: true });
        capsuleSnapshot = snapshotSession(path);
        writeFileSync(path, payload, "utf8");
      } catch {}
    }
  }

  return {
    session,
    repoRoot,
    globalDir,
    payload,
    processSnapshots,
    ...(capsuleSnapshot === undefined ? {} : { capsuleSnapshot }),
  };
}

export function rollbackStagedSessionGrant(stage: StagedSessionGrant): void {
  withSessionAuthorityLock(stage.repoRoot, stage.globalDir, () => {
    for (const snapshot of stage.processSnapshots)
      restoreSnapshotIfUnchanged(snapshot, stage.payload);
    if (stage.capsuleSnapshot !== undefined)
      restoreSnapshotIfUnchanged(stage.capsuleSnapshot, stage.payload);
  });
}

export function registerSessionGrant(options: RegisterSessionOptions): SessionIdentity {
  const stage = stageSessionGrant(options);
  if (options.worktreeDir) {
    const path = join(options.worktreeDir, ".session.json");
    if (isInMemorySessionStoreEnabled()) {
      setInMemorySessionData(path, stage.payload);
    } else if (existsSync(options.worktreeDir)) {
      try {
        writeFileSync(path, stage.payload, "utf8");
      } catch {}
    }
  }
  return stage.session;
}

export function registerInMemorySessionGrant(options: RegisterSessionOptions): SessionIdentity {
  if (!isInMemorySessionStoreEnabled()) enableInMemorySessionStore();
  return registerSessionGrant(options);
}

export function revokeSessionGrant(options: {
  readonly runRoot?: string | undefined;
  readonly agentId: string;
  readonly pid: number;
  readonly ppid: number;
}): void {
  const repoRoot = resolveSessionRepoRoot(options.runRoot);
  const agentId = assertSafeSessionComponent(options.agentId, "agentId");
  const pid = assertSessionPid(options.pid, "pid");
  const ppid = assertSessionPid(options.ppid, "ppid");
  for (const processId of new Set([pid, ppid])) {
    const path = join(resolveGlobalSessionsDir(repoRoot), `${processId}.json`);
    if (isInMemorySessionStoreEnabled()) deleteInMemorySessionData(path);
    else if (existsSync(path)) unlinkSync(path);
  }
  if (options.runRoot && options.runRoot.trim()) {
    const runRoot = resolve(options.runRoot);
    const path = join(runRoot, "runtime", "sessions", `${agentId}.json`);
    if (isInMemorySessionStoreEnabled()) deleteInMemorySessionData(path);
    else if (existsSync(path)) unlinkSync(path);
  }
}

export function pruneStaleSessions(maxAgeMs = 86400000): void {
  if (isInMemorySessionStoreEnabled()) {
    const store = getInMemorySessionStore();
    if (store) {
      for (const key of [...store.keys()]) {
        if (key.includes(".sessions") && key.endsWith(".json")) store.delete(key);
      }
    }
    return;
  }
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
        const pid = parseInt(file.replace(".json", ""), 10);
        if (!Number.isNaN(pid) && pid > 0) {
          try {
            process.kill(pid, 0);
          } catch (e: unknown) {
            if (readOwnDataString(e, "code") === "ESRCH") unlinkSync(filePath);
          }
        }
      } catch {}
    }
  } catch {}
}
