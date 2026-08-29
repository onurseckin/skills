import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { HarnessError } from "../../core/errors/index.ts";
import { findRepoRoot, isInsideCapsule, resolveCapsulesDir } from "../../core/shared/paths.ts";
import { readAgentLedger } from "../../workflow/agents/ledger.ts";
import {
  agentIdToRole,
  agentIdToTier,
  detectHostApp,
  roleToTier,
  type ExecutionTier,
} from "../thread/index.ts";
import { assertSafeSessionComponent, assertSessionPid, resolveGlobalSessionsDir } from "./paths.ts";
import {
  atomicSessionWrite,
  formatSafeErrorCause,
  inferCanExecute,
  readOwnDataString,
  restoreSnapshotIfUnchanged,
  snapshotSession,
  withSessionAuthorityLock,
} from "./io.ts";
import type {
  RegisterSessionOptions,
  SessionIdentity,
  SessionSnapshot,
  StagedSessionGrant,
} from "./types.ts";

export function stageSessionGrant(options: RegisterSessionOptions): StagedSessionGrant {
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
  const bindProcessAncestry = options.bindProcessAncestry ?? true;
  const globalDir = resolveGlobalSessionsDir(repoRoot);
  const paths = bindProcessAncestry
    ? [...new Set([pid, ppid])].map((processId) => join(globalDir, `${processId}.json`))
    : [];
  let processSnapshots: readonly SessionSnapshot[] = [];
  let capsuleSnapshot: SessionSnapshot | undefined;

  if (paths.length > 0) {
    try {
      mkdirSync(globalDir, { recursive: true });
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
    try {
      mkdirSync(runtimeSessionsDir, { recursive: true });
      const path = join(runtimeSessionsDir, `${agentId}.json`);
      capsuleSnapshot = snapshotSession(path);
      writeFileSync(path, payload, "utf8");
    } catch {}
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
    for (const snapshot of stage.processSnapshots) {
      restoreSnapshotIfUnchanged(snapshot, stage.payload);
    }
    if (stage.capsuleSnapshot !== undefined) {
      restoreSnapshotIfUnchanged(stage.capsuleSnapshot, stage.payload);
    }
  });
}

export function registerSessionGrant(options: RegisterSessionOptions): SessionIdentity {
  const stage = stageSessionGrant(options);

  if (options.worktreeDir && existsSync(options.worktreeDir)) {
    try {
      writeFileSync(join(options.worktreeDir, ".session.json"), stage.payload, "utf8");
    } catch {}
  }

  return stage.session;
}

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
      } catch {}
    }
  } catch {}
}

export function assertActiveCapsuleLease(runRoot: string, agentId: string): void {
  if (!runRoot || !runRoot.trim()) {
    throw new HarnessError("INVALID_STATE", "capsule runRoot is required");
  }
  const agent = assertSafeSessionComponent(agentId, "agentId");
  const trimmed = runRoot.trim();
  let statePath = join(trimmed, "state.json");
  let resolved = trimmed;
  if (!existsSync(statePath)) {
    try {
      const repoRoot = findRepoRoot(trimmed);
      resolved =
        isAbsolute(trimmed) || isInsideCapsule(trimmed)
          ? resolve(trimmed)
          : join(resolveCapsulesDir(repoRoot), trimmed);
      statePath = join(resolved, "state.json");
    } catch {}
  }
  if (!existsSync(statePath)) {
    throw new HarnessError("INVALID_STATE", `capsule state not found at ${resolved}`);
  }
  let state: Record<string, unknown>;
  try {
    const raw = readFileSync(statePath, "utf8");
    state = JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    throw new HarnessError(
      "INTEGRITY",
      `failed to load capsule state at ${resolved}: ${formatSafeErrorCause(error)}`,
    );
  }
  const ledger = readAgentLedger(state);
  const activeGrant = ledger.find((entry) => entry.id === agent && entry.status === "active");
  if (activeGrant) return;
  const tasks = state.tasks;
  if (tasks && typeof tasks === "object") {
    const hasActiveTaskLease = Object.values(tasks).some((t) => {
      if (!t || typeof t !== "object") return false;
      const lease = (t as { lease?: { agent_id?: string; expires_at?: string } }).lease;
      if (!lease || lease.agent_id !== agent) return false;
      if (lease.expires_at && Date.parse(lease.expires_at) <= Date.now()) return false;
      return true;
    });
    if (hasActiveTaskLease) return;
  }
  throw new HarnessError(
    "INVALID_STATE",
    `agent '${agent}' does not hold an active lease in capsule '${resolved}'`,
  );
}
