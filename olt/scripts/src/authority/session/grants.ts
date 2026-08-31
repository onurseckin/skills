import * as fs from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { HarnessError } from "../../core/errors/index.ts";
import { findRepoRoot, isInsideCapsule, resolveCapsulesDir } from "../../core/shared/paths.ts";
import { readAgentLedger } from "../../workflow/agents/ledger.ts";
import { agentIdToTier, detectHostApp, roleToTier, type ExecutionTier } from "../thread/index.ts";
import { assertSafeSessionComponent, assertSessionPid, resolveGlobalSessionsDir } from "./paths.ts";
import * as io from "./io.ts";
import type {
  RegisterSessionOptions,
  SessionIdentity,
  SessionSnapshot,
  StagedSessionGrant,
} from "./types.ts";

function resolveSessionRepoRoot(runRoot?: string): string {
  try {
    return findRepoRoot(runRoot);
  } catch (e) {
    if (io.isInMemorySessionStoreEnabled()) return runRoot ? resolve(runRoot) : "/virtual/repo";
    throw e;
  }
}

function resolveRunRootPath(runRoot: string, repoRoot: string): string {
  const t = runRoot.trim();
  return isAbsolute(t) || isInsideCapsule(t) ? resolve(t) : join(resolveCapsulesDir(repoRoot), t);
}

function resolveCapsuleLocation(trimmed: string): { resolved: string; statePath: string } {
  let resolved = trimmed,
    statePath = join(trimmed, "state.json");
  try {
    const root = findRepoRoot(trimmed);
    resolved =
      isAbsolute(trimmed) || isInsideCapsule(trimmed)
        ? resolve(trimmed)
        : join(resolveCapsulesDir(root), trimmed);
    statePath = join(resolved, "state.json");
  } catch {}
  return { resolved, statePath };
}

function hasValidTaskLease(tasks: unknown, agent: string): boolean {
  if (!tasks || typeof tasks !== "object") return false;
  return Object.values(tasks).some((t) => {
    const l = (t as { lease?: { agent_id?: string; expires_at?: string } })?.lease;
    return Boolean(
      l && l.agent_id === agent && (!l.expires_at || Date.parse(l.expires_at) > Date.now()),
    );
  });
}

export function assertActiveCapsuleLease(runRoot: string, agentId: string): void {
  if (!runRoot?.trim()) throw new HarnessError("INVALID_STATE", "capsule runRoot is required");
  const agent = assertSafeSessionComponent(agentId, "agentId"),
    trimmed = runRoot.trim();
  let resolved = trimmed,
    statePath = join(trimmed, "state.json");
  let raw = io.isInMemorySessionStoreEnabled() ? io.getInMemorySessionData(statePath) : undefined;
  if (raw === undefined && !fs.existsSync(statePath)) {
    const loc = resolveCapsuleLocation(trimmed);
    resolved = loc.resolved;
    statePath = loc.statePath;
    if (io.isInMemorySessionStoreEnabled()) raw = io.getInMemorySessionData(statePath);
  }
  if (raw === undefined) {
    if (!fs.existsSync(statePath))
      throw new HarnessError("INVALID_STATE", `capsule state not found at ${resolved}`);
    try {
      raw = fs.readFileSync(statePath, "utf8");
    } catch (e) {
      throw new HarnessError(
        "INTEGRITY",
        `failed to load capsule state at ${resolved}: ${io.formatSafeErrorCause(e)}`,
      );
    }
  }
  try {
    const state = JSON.parse(raw) as Record<string, unknown>;
    if (
      readAgentLedger(state as Parameters<typeof readAgentLedger>[0]).some(
        (e) => e.id === agent && e.status === "active",
      )
    )
      return;
    if (hasValidTaskLease(state.tasks, agent)) return;
  } catch (e) {
    if (e instanceof HarnessError) throw e;
    throw new HarnessError(
      "INTEGRITY",
      `failed to load capsule state at ${resolved}: ${io.formatSafeErrorCause(e)}`,
    );
  }
  throw new HarnessError(
    "INVALID_STATE",
    `agent '${agent}' does not hold an active lease in capsule '${resolved}'`,
  );
}

export function stageSessionGrant(opts: RegisterSessionOptions): StagedSessionGrant {
  const repoRoot = resolveSessionRepoRoot(opts.runRoot);
  const agent_id = assertSafeSessionComponent(opts.agentId, "agentId"),
    role = assertSafeSessionComponent(opts.role, "role");
  const token = opts.customToken ?? `tok_live_${randomBytes(24).toString("hex")}`;
  if (!token?.trim())
    throw new HarnessError("INVALID_ARGUMENT", "customToken must be a nonempty string");
  const pid = assertSessionPid(opts.pid ?? process?.pid ?? 0, "pid"),
    ppid = assertSessionPid(opts.ppid ?? process?.ppid ?? 0, "ppid");
  const tier = (roleToTier(role) ?? agentIdToTier(agent_id) ?? 3) as ExecutionTier,
    exec = io.inferCanExecute(role);
  const run_id = opts.runRoot?.trim()
    ? basename(resolveRunRootPath(opts.runRoot, repoRoot))
    : undefined;
  const session: SessionIdentity = {
    agent_id,
    role,
    tier,
    token,
    pid,
    ppid,
    ...(run_id ? { run_id } : {}),
    ...(opts.taskId ? { task_id: opts.taskId } : {}),
    ...(opts.writeScope ? { write_scope: opts.writeScope } : {}),
    can_execute_shell: exec.can_execute_shell,
    can_edit_files: exec.can_edit_files,
    host: opts.host ?? detectHostApp(process.env),
    mechanisms_detected: ["registration"],
    granted_at: new Date().toISOString(),
  };

  const payload = JSON.stringify(session, null, 2),
    globalDir = resolveGlobalSessionsDir(repoRoot);
  const paths =
    (opts.bindProcessAncestry ?? true)
      ? [...new Set([pid, ppid])].map((p) => join(globalDir, `${p}.json`))
      : [];
  let processSnapshots: readonly SessionSnapshot[] = [],
    capsuleSnapshot: SessionSnapshot | undefined;

  if (paths.length > 0) {
    try {
      if (!io.isInMemorySessionStoreEnabled()) fs.mkdirSync(globalDir, { recursive: true });
      io.withSessionAuthorityLock(repoRoot, globalDir, () => {
        processSnapshots = paths.map(io.snapshotSession);
        try {
          for (const p of paths) io.atomicSessionWrite(p, payload);
        } catch (e) {
          for (const s of processSnapshots) io.restoreSnapshotIfUnchanged(s, payload);
          throw e;
        }
      });
    } catch (e: unknown) {
      throw new HarnessError(
        "INTEGRITY",
        `failed to persist process-ancestry session grant in ${globalDir}: ${io.formatSafeErrorCause(e)}`,
      );
    }
  }

  if (opts.runRoot?.trim()) {
    const p = join(
      resolveRunRootPath(opts.runRoot, repoRoot),
      "runtime",
      "sessions",
      `${agent_id}.json`,
    );
    capsuleSnapshot = io.snapshotSession(p);
    if (io.isInMemorySessionStoreEnabled()) io.setInMemorySessionData(p, payload);
    else {
      try {
        fs.mkdirSync(dirname(p), { recursive: true });
        fs.writeFileSync(p, payload, "utf8");
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
  io.withSessionAuthorityLock(stage.repoRoot, stage.globalDir, () => {
    for (const snapshot of stage.processSnapshots)
      io.restoreSnapshotIfUnchanged(snapshot, stage.payload);
    if (stage.capsuleSnapshot !== undefined)
      io.restoreSnapshotIfUnchanged(stage.capsuleSnapshot, stage.payload);
  });
}

export function registerSessionGrant(options: RegisterSessionOptions): SessionIdentity {
  const stage = stageSessionGrant(options);
  if (options.worktreeDir) {
    const p = join(options.worktreeDir, ".session.json");
    if (io.isInMemorySessionStoreEnabled()) io.setInMemorySessionData(p, stage.payload);
    else if (fs.existsSync(options.worktreeDir)) {
      try {
        fs.writeFileSync(p, stage.payload, "utf8");
      } catch {}
    }
  }
  return stage.session;
}

export function registerInMemorySessionGrant(options: RegisterSessionOptions): SessionIdentity {
  if (!io.isInMemorySessionStoreEnabled()) io.enableInMemorySessionStore();
  return registerSessionGrant(options);
}

export function revokeSessionGrant(opts: {
  readonly runRoot?: string;
  readonly agentId: string;
  readonly pid: number;
  readonly ppid: number;
}): void {
  const repoRoot = resolveSessionRepoRoot(opts.runRoot),
    agent = assertSafeSessionComponent(opts.agentId, "agentId");
  const pids = [assertSessionPid(opts.pid, "pid"), assertSessionPid(opts.ppid, "ppid")];
  for (const id of new Set(pids)) {
    const p = join(resolveGlobalSessionsDir(repoRoot), `${id}.json`);
    if (io.isInMemorySessionStoreEnabled()) io.deleteInMemorySessionData(p);
    else if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  if (opts.runRoot?.trim()) {
    const p = join(resolve(opts.runRoot), "runtime", "sessions", `${agent}.json`);
    if (io.isInMemorySessionStoreEnabled()) io.deleteInMemorySessionData(p);
    else if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

export function pruneStaleSessions(maxAgeMs = 86400000): void {
  if (io.isInMemorySessionStoreEnabled()) {
    const s = io.getInMemorySessionStore();
    if (s)
      for (const k of [...s.keys()])
        if (k.includes(".sessions") && k.endsWith(".json")) s.delete(k);
    return;
  }
  const globalDir = resolveGlobalSessionsDir(findRepoRoot());
  if (!fs.existsSync(globalDir)) return;
  try {
    const now = Date.now();
    for (const f of fs.readdirSync(globalDir)) {
      if (!f.endsWith(".json")) continue;
      const fp = join(globalDir, f);
      try {
        if (now - fs.statSync(fp).mtimeMs > maxAgeMs) {
          fs.unlinkSync(fp);
          continue;
        }
        const pid = parseInt(f.replace(".json", ""), 10);
        if (pid > 0) {
          try {
            process.kill(pid, 0);
          } catch (e: unknown) {
            if (io.readOwnDataString(e, "code") === "ESRCH") fs.unlinkSync(fp);
          }
        }
      } catch {}
    }
  } catch {}
}
