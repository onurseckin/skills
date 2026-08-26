import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, resolve, dirname, basename, isAbsolute } from "node:path";
import { randomBytes } from "node:crypto";
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
            if (
              typeof e === "object" &&
              e !== null &&
              "code" in e &&
              (e as { code?: unknown }).code === "ESRCH"
            ) {
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

/**
 * Registers an authenticated session grant on disk and binds process ancestry.
 */
export function registerSessionGrant(options: RegisterSessionOptions): SessionIdentity {
  const repoRoot = findRepoRoot(options.runRoot);
  const token = options.customToken ?? `tok_live_${randomBytes(24).toString("hex")}`;
  const pid = options.pid ?? (typeof process !== "undefined" ? process.pid : 0);
  const ppid = options.ppid ?? (typeof process !== "undefined" ? process.ppid : 0);
  const role = options.role.trim();
  const tier = (roleToTier(role) ?? agentIdToTier(options.agentId) ?? 3) as ExecutionTier;
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
    agent_id: options.agentId.trim(),
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

  // 1. Write Global Sessions Registry by PID & PPID
  const globalDir = resolveGlobalSessionsDir(repoRoot);
  try {
    mkdirSync(globalDir, { recursive: true });
    if (pid > 0) writeFileSync(join(globalDir, `${pid}.json`), payload, "utf8");
    if (ppid > 0) writeFileSync(join(globalDir, `${ppid}.json`), payload, "utf8");
  } catch {
    // Best-effort
  }

  // 2. Write Capsule Runtime Session
  if (resolvedRunRoot) {
    const runtimeSessionsDir = join(resolvedRunRoot, "runtime", "sessions");
    try {
      mkdirSync(runtimeSessionsDir, { recursive: true });
      writeFileSync(join(runtimeSessionsDir, `${options.agentId}.json`), payload, "utf8");
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

/**
 * Executes all 3 identity detection mechanisms simultaneously, aggregating
 * detected agent attributes and enforcing cryptographic anti-spoofing interlocks.
 */
export function resolveActiveSession(options: ResolveSessionOptions = {}): SessionIdentity | null {
  const cwd = resolve(options.cwd ?? (typeof process !== "undefined" ? process.cwd() : "."));
  const env = options.env ?? (typeof process !== "undefined" ? process.env : {});
  const pid = options.pid ?? (typeof process !== "undefined" ? process.pid : 0);
  const ppid = options.ppid ?? (typeof process !== "undefined" ? process.ppid : 0);
  let repoRoot: string;
  try {
    repoRoot = findRepoRoot(cwd);
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
    if (existsSync(sessionFile)) {
      try {
        const parsed = JSON.parse(readFileSync(sessionFile, "utf8")) as JsonObject;
        if (isJsonObject(parsed) && typeof parsed.agent_id === "string") {
          mechanisms.push(`process_ancestry_pid_${checkPid}`);
          if (!detectedAgentId) detectedAgentId = parsed.agent_id as string;
          if (!detectedRole && typeof parsed.role === "string")
            detectedRole = parsed.role as string;
          if (!detectedToken && typeof parsed.token === "string")
            detectedToken = parsed.token as string;
          if (typeof parsed.can_execute_shell === "boolean")
            detectedCanShell = parsed.can_execute_shell;
          if (typeof parsed.can_edit_files === "boolean") detectedCanEdit = parsed.can_edit_files;
          if (Array.isArray(parsed.write_scope))
            detectedWriteScope = parsed.write_scope as string[];
          if (typeof parsed.task_id === "string") detectedTaskId = parsed.task_id as string;
          if (typeof parsed.granted_at === "string") grantedAt = parsed.granted_at as string;
          break;
        }
      } catch {
        // Continue
      }
    }
  }

  // Mechanism 3: Directory / Workspace Anchoring (.session.json or .olt-identity.json)
  let currentDir = cwd;
  while (true) {
    const sessionPath = join(currentDir, ".session.json");
    const identityPath = join(currentDir, ".olt-identity.json");
    const targetPath = existsSync(sessionPath)
      ? sessionPath
      : existsSync(identityPath)
        ? identityPath
        : null;

    if (targetPath) {
      try {
        const parsed = JSON.parse(readFileSync(targetPath, "utf8")) as JsonObject;
        if (isJsonObject(parsed) && typeof parsed.agent_id === "string") {
          mechanisms.push("workspace_directory_session");
          if (!detectedAgentId) detectedAgentId = parsed.agent_id as string;
          if (!detectedRole && typeof parsed.role === "string")
            detectedRole = parsed.role as string;
          if (!detectedToken && typeof parsed.token === "string")
            detectedToken = parsed.token as string;
          if (typeof parsed.can_execute_shell === "boolean")
            detectedCanShell = parsed.can_execute_shell;
          if (typeof parsed.can_edit_files === "boolean") detectedCanEdit = parsed.can_edit_files;
          if (Array.isArray(parsed.write_scope))
            detectedWriteScope = parsed.write_scope as string[];
          if (typeof parsed.task_id === "string") detectedTaskId = parsed.task_id as string;
          break;
        }
      } catch {
        // Continue
      }
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
