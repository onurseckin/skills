import { existsSync } from "node:fs";
import { dirname, join, resolve, isAbsolute } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import {
  findRepoRoot,
  isInsideCapsule,
  isTestEnvironment,
  resolveCapsulesDir,
} from "../../core/shared/paths.ts";
import { loadRun } from "../../engine/store/capsule/load.ts";
import { readAgentLedger } from "../../workflow/agents/ledger.ts";
import {
  agentIdToRole,
  agentIdToTier,
  detectHostApp,
  roleToTier,
  type ExecutionTier,
} from "../thread/index.ts";
import { resolveGlobalSessionsDir, resolveSessionRepositoryRoot } from "./paths.ts";
import { isInMemorySessionStoreEnabled, readPersistedSession, secureReadSession } from "./io.ts";
import type { ResolveSessionOptions, SessionIdentity } from "./types.ts";

export function resolveActiveSession(options: ResolveSessionOptions = {}): SessionIdentity | null {
  const cwd = resolve(options.cwd ?? (typeof process !== "undefined" ? process.cwd() : "."));
  const env = options.env ?? (typeof process !== "undefined" ? process.env : {});
  const readSessionFile = options.readPersistedSessionFile ?? ((p: string) => secureReadSession(p));
  const pid = options.pid ?? (typeof process !== "undefined" ? process.pid : 0);
  const ppid = options.ppid ?? (typeof process !== "undefined" ? process.ppid : 0);
  let repoRoot: string;
  try {
    repoRoot = resolveSessionRepositoryRoot(options.runRoot, cwd);
  } catch (error) {
    if (error instanceof HarnessError && error.code === "PATH_SAFETY") return null;
    throw error;
  }
  const mechanisms: string[] = [];
  let detectedAgentId: string | null = null;
  let detectedRole: string | null = null;
  let detectedToken: string | null = null;
  let detectedHost: string = detectHostApp(env);
  let detectedCanShell = true;
  let detectedCanEdit = true;
  let detectedWriteScope: readonly string[] | undefined;
  let detectedTaskId: string | undefined;
  let grantedAt = new Date().toISOString();

  const envToken = env["HARNESS_TOKEN"] || env["HARNESS_SESSION_TOKEN"];
  const envAgent = env["AGENT_ID"] || env["HARNESS_AGENT_ID"];
  const envRole = env["ROLE"] || env["HARNESS_ROLE"];

  if (envToken || envAgent || envRole) {
    mechanisms.push("environment_variables");
    if (envToken) detectedToken = envToken.trim();
    if (envAgent) detectedAgentId = envAgent.trim();
    if (envRole) detectedRole = envRole.trim();
  }

  const globalSessionsDir = resolveGlobalSessionsDir(repoRoot);
  const checkPids = [ppid, pid].filter((p) => p > 0);

  const applyParsed = (parsed: Record<string, unknown>): void => {
    if (!detectedAgentId && typeof parsed["agent_id"] === "string")
      detectedAgentId = parsed["agent_id"];
    if (!detectedRole && typeof parsed["role"] === "string") detectedRole = parsed["role"];
    if (!detectedToken && typeof parsed["token"] === "string") detectedToken = parsed["token"];
    if (typeof parsed["can_execute_shell"] === "boolean")
      detectedCanShell = parsed["can_execute_shell"];
    if (typeof parsed["can_edit_files"] === "boolean") detectedCanEdit = parsed["can_edit_files"];
    if (Array.isArray(parsed["write_scope"]))
      detectedWriteScope = parsed["write_scope"] as string[];
    if (typeof parsed["task_id"] === "string") detectedTaskId = parsed["task_id"];
    if (typeof parsed["granted_at"] === "string") grantedAt = parsed["granted_at"];
  };

  if (options.runRoot && options.explicitActor) {
    const trimmed = options.runRoot.trim();
    const resolvedRunRoot =
      isAbsolute(trimmed) || isInsideCapsule(trimmed)
        ? resolve(trimmed)
        : join(resolveCapsulesDir(repoRoot), trimmed);
    const runtimeSessionPath = join(
      resolvedRunRoot,
      "runtime",
      "sessions",
      `${options.explicitActor.trim()}.json`,
    );
    const parsed = readPersistedSession(
      runtimeSessionPath,
      "capsule_runtime_session",
      readSessionFile,
    );
    if (parsed) {
      mechanisms.push("capsule_runtime_session");
      applyParsed(parsed);
    }
  }

  if (isInMemorySessionStoreEnabled() || !isTestEnvironment() || repoRoot !== findRepoRoot()) {
    for (const checkPid of checkPids) {
      const sessionFile = join(globalSessionsDir, `${checkPid}.json`);
      const mechanism = `process_ancestry_pid_${checkPid}`;
      const parsed = readPersistedSession(sessionFile, mechanism, readSessionFile);
      if (!parsed) continue;
      mechanisms.push(mechanism);
      applyParsed(parsed);
      break;
    }
  }

  if (isInMemorySessionStoreEnabled() || !isTestEnvironment() || cwd !== findRepoRoot()) {
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
        session ??
        readPersistedSession(identityPath, "workspace_directory_session", readSessionFile);

      if (parsed) {
        mechanisms.push("workspace_directory_session");
        applyParsed(parsed);
        break;
      }

      const parent = dirname(currentDir);
      if (parent === currentDir || (!isInMemorySessionStoreEnabled() && currentDir === repoRoot))
        break;
      currentDir = parent;
    }
  }

  if (!detectedAgentId && !detectedRole && !detectedToken) return null;

  const finalRole =
    detectedRole ?? (detectedAgentId ? agentIdToRole(detectedAgentId) : null) ?? "implementer";
  const finalAgentId = detectedAgentId ?? `agent-${finalRole}`;
  const finalTier = (roleToTier(finalRole) ?? agentIdToTier(finalAgentId) ?? 3) as ExecutionTier;
  const finalToken = detectedToken ?? options.explicitToken ?? "unauthenticated";

  if (options.explicitActor) {
    const requestedActor = options.explicitActor.trim();
    if (
      requestedActor !== finalAgentId &&
      requestedActor !== finalRole &&
      requestedActor !== `agent-${finalRole}`
    ) {
      throw new HarnessError(
        "AUTHENTICATION_FAILURE",
        `Actor spoofing blocked: caller verified as '${finalAgentId}' (${finalRole}) cannot execute as '${requestedActor}'. Session tokens authenticate their holder and cannot delegate another agent's durable grant.`,
      );
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

export function isSessionLedgerBacked(
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
    const ledger = readAgentLedger(loadRun(resolved, false).state);
    return ledger.some(
      (entry) => entry.id === agentId && entry.status === "active" && entry.role === role,
    );
  } catch {
    return false;
  }
}

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
      (m) =>
        m.startsWith("process_ancestry_pid_") ||
        m === "workspace_directory_session" ||
        m === "capsule_runtime_session",
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

  const explicit = options.explicitActor?.trim();
  const fallbackRole = explicit ? (agentIdToRole(explicit) ?? explicit) : "mind";
  const fallbackTier = roleToTier(fallbackRole);

  return {
    actor: explicit ?? "mind",
    role: fallbackRole,
    tier: fallbackTier,
    token: options.explicitToken,
    mechanisms: ["interactive_terminal_fallback"],
    verified: false,
  };
}

export { requireTurn1Registration } from "./turn1-interlock.ts";
