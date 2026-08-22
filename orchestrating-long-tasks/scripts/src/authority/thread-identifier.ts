import { existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

export type ExecutionTier = 0 | 1 | 2 | 3;

export const TIER_NAMES: Readonly<Record<ExecutionTier, string>> = {
  0: "Tier 0: Human User Interactive Shell",
  1: "Tier 1: Autonomous Orchestrator (Background)",
  2: "Tier 2: Background Coordinator",
  3: "Tier 3: Background Implementer / Validator / Critic",
};

export const MAIN_THREAD_ADVISORY =
  "[MAIN THREAD RESTRAINT ACTIVE]: Main interactive thread must not directly modify files or execute implementation tasks. It must dispatch Tier 2 Background Coordinators or Tier 3 Implementers via invoke_subagent.";

export interface BlunderRecord {
  id: string;
  type:
    | "main_thread_direct_execution"
    | "main_thread_boundary_violation"
    | "role_escalation"
    | "unauthorized_mutation"
    | "role_confinement_violation";
  severity: "critical" | "warning";
  timestamp: string;
  pid: number;
  ppid: number;
  agent_id: string | null;
  observation: string;
  remediation: string;
  context: {
    cwd: string;
    indicators: Record<string, string>;
  };
}

export interface HostProfile {
  app_id: string;
  os_platform: string;
  os_release: string;
  os_arch: string;
  runtime_node: string | null;
  runtime_bun: string | null;
}

export interface CapabilitiesProfile {
  tools: readonly string[];
  environment_grants: readonly string[];
  command_taxonomy: string;
}

export interface ThreadIdentification {
  pid: number;
  ppid: number;
  tier: ExecutionTier;
  tier_name: string;
  role: string | null;
  agent_id: string | null;
  is_main_thread: boolean;
  compliance_state: "compliant" | "restrained" | "violation";
  advisory: string | null;
  indicators: Record<string, string>;
  blunder: BlunderRecord | null;
  host_profile: HostProfile;
  capabilities: CapabilitiesProfile;
}

export interface ExecutionContextOptions {
  pid?: number | undefined;
  ppid?: number | undefined;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined> | undefined;
  cwd?: string | undefined;
  runRoot?: string | undefined;
  agentId?: string | undefined;
  role?: string | undefined;
  tier?: ExecutionTier | undefined;
  isInteractiveMainThread?: boolean | undefined;
}

export function parseTierValue(value: string | undefined): ExecutionTier | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "0" || normalized === "tier-0" || normalized === "tier_0" || normalized === "human" || normalized === "mind") {
    return 0;
  }
  if (
    normalized === "1" ||
    normalized === "tier-1" ||
    normalized === "tier_1" ||
    normalized === "orchestrator" ||
    normalized === "mind-auditor" ||
    normalized === "auditor"
  ) {
    return 1;
  }
  if (
    normalized === "2" ||
    normalized === "tier-2" ||
    normalized === "tier_2" ||
    normalized === "coordinator"
  ) {
    return 2;
  }
  if (
    normalized === "3" ||
    normalized === "tier-3" ||
    normalized === "tier_3" ||
    normalized === "implementer" ||
    normalized === "validator" ||
    normalized === "critic" ||
    normalized === "completeness-critic" ||
    normalized === "repairer" ||
    normalized === "planner" ||
    normalized === "plan-validator"
  ) {
    return 3;
  }
  return null;
}

export function roleToTier(role: string): ExecutionTier {
  const normalized = role.toLowerCase().trim();
  if (normalized === "mind") return 0;
  if (
    normalized === "orchestrator" ||
    normalized.startsWith("orch-") ||
    normalized.startsWith("orchestrator-") ||
    normalized === "mind-auditor" ||
    normalized === "auditor"
  ) {
    return 1;
  }
  if (
    normalized === "coordinator" ||
    normalized.startsWith("coord-") ||
    normalized.startsWith("coordinator-")
  ) {
    return 2;
  }
  return 3;
}

export function agentIdToTier(agentId: string): ExecutionTier | null {
  const normalized = agentId.toLowerCase().trim();
  if (/^mind-audit|^audit/i.test(normalized)) return 1;
  if (/^mind/i.test(normalized)) return 0;
  if (/^orch/i.test(normalized)) return 1;
  if (/^coord/i.test(normalized)) return 2;
  if (/^(impl|val|critic|repair|worker|sub|plan)/i.test(normalized)) return 3;
  return null;
}

export function agentIdToRole(agentId: string): string | null {
  const normalized = agentId.toLowerCase().trim();
  if (/^mind-audit|^audit/i.test(normalized)) return "mind-auditor";
  if (/^mind/i.test(normalized)) return "mind";
  if (/^orch/i.test(normalized)) return "orchestrator";
  if (/^coord/i.test(normalized)) return "coordinator";
  if (/^impl/i.test(normalized)) return "implementer";
  if (/^val/i.test(normalized)) return "validator";
  if (/^critic/i.test(normalized)) return "completeness-critic";
  if (/^repair/i.test(normalized)) return "repairer";
  if (/^plan-val/i.test(normalized)) return "plan-validator";
  if (/^plan/i.test(normalized)) return "planner";
  return null;
}

export function recordBlunder(
  blunder: BlunderRecord,
  options: { runRoot?: string | undefined; cwd?: string | undefined } = {},
): BlunderRecord {
  const targetDir = options.runRoot
    ? options.runRoot
    : options.cwd && existsSync(join(options.cwd, ".capsules"))
      ? join(options.cwd, ".capsules")
      : null;

  if (targetDir && existsSync(targetDir)) {
    try {
      const blundersPath = join(targetDir, "blunders.jsonl");
      appendFileSync(blundersPath, `${JSON.stringify(blunder)}\n`, "utf8");
    } catch {
      // Disk recording is best-effort and non-fatal
    }
  }
  return blunder;
}

export function detectHostApp(env: NodeJS.ProcessEnv | Record<string, string | undefined>): string {
  const termProgram = env["TERM_PROGRAM"]?.toLowerCase() || "";
  
  if (env["CLAUDE_CODE_VERSION"] || env["CLAUDE_CLI"]) return "Claude Code";
  if (env["ANTIGRAVITY_CLI"] || env["GEMINI_CLI"] || env["ANTIGRAVITY_VERSION"]) return "Antigravity/Gemini CLI";
  if (termProgram === "cursor" || env["CURSOR_VERSION"]) return "Cursor";
  if (env["OPENCODE_VERSION"] || env["OPENCODE_CLI"] || env["OPENCODE"]) return "OpenCode";
  if (env["CODEX_VERSION"] || env["CODEX_CLI"] || env["CODEX"]) return "Codex";
  if (termProgram === "vscode") return "VSCode Terminal";
  
  return "Generic Host";
}

export function buildCapabilitiesProfile(tier: ExecutionTier, env: Record<string, string | undefined>): CapabilitiesProfile {
  let taxonomy = "Restricted Sandbox";
  if (tier === 0) taxonomy = "Full Root / All Permissions";
  else if (tier === 1) taxonomy = "Orchestration / Delegation Only";
  else if (tier === 2) taxonomy = "Coordination / Dispatch Only";
  else if (tier === 3) taxonomy = "Implementation / Execution";

  const rawTools = env.GRANTED_TOOLS || env.AVAILABLE_TOOLS || "";
  const tools = rawTools ? rawTools.split(",").map(t => t.trim()).filter(Boolean) : [];
  
  const rawGrants = env.ENVIRONMENT_GRANTS || env.TOOL_GRANTS || "";
  const environment_grants = rawGrants ? rawGrants.split(",").map(g => g.trim()).filter(Boolean) : [];

  return {
    tools,
    environment_grants,
    command_taxonomy: taxonomy,
  };
}

export function identifyExecutionContext(
  options: ExecutionContextOptions = {},
): ThreadIdentification {
  const pid = options.pid ?? (typeof process !== "undefined" ? process.pid : 0);
  const ppid = options.ppid ?? (typeof process !== "undefined" ? process.ppid : 0);
  const env = options.env ?? (typeof process !== "undefined" ? process.env : {});
  const cwd = options.cwd ?? (typeof process !== "undefined" ? process.cwd() : ".");

  const indicators: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (
      value !== undefined &&
      (key.startsWith("HARNESS_") ||
        key.startsWith("AGENT_") ||
        key.startsWith("HOST_") ||
        key === "ROLE" ||
        key === "SESSION_ID" ||
        key === "CONVERSATION_ID" ||
        key === "SUBAGENT_CONVERSATION_ID" ||
        key === "INTERACTIVE_MAIN_THREAD")
    ) {
      indicators[key] = value;
    }
  }

  const explicitTierEnv = parseTierValue(env.HARNESS_EXECUTION_TIER);
  const explicitRole =
    options.role ?? env.HARNESS_AGENT_ROLE ?? env.AGENT_ROLE ?? env.ROLE ?? null;
  const explicitAgentId =
    options.agentId ?? env.HARNESS_AGENT_ID ?? env.AGENT_ID ?? null;

  const isSubagent =
    env.HOST_SUBAGENT === "1" ||
    env.HOST_SUBAGENT === "true" ||
    Boolean(env.SUBAGENT_CONVERSATION_ID) ||
    Boolean(env.SUBAGENT_ROLE) ||
    (explicitRole !== null && explicitRole !== "user" && explicitRole !== "main");

  const hasInteractiveMainIndicator =
    options.isInteractiveMainThread === true ||
    env.INTERACTIVE_MAIN_THREAD === "1" ||
    env.INTERACTIVE_MAIN_THREAD === "true" ||
    ((Boolean(env.HOST_SESSION) ||
      Boolean(env.CONVERSATION_ID) ||
      Boolean(env.SESSION_ID)) &&
      !isSubagent &&
      explicitTierEnv === null &&
      explicitRole === null &&
      explicitAgentId === null);

  let tier: ExecutionTier = 0;
  let inferredRole: string | null = explicitRole;
  let inferredAgentId: string | null = explicitAgentId;

  if (options.tier !== undefined) {
    tier = options.tier;
    if (inferredRole === null) {
      if (tier === 0) inferredRole = "mind";
      else if (tier === 1) inferredRole = "orchestrator";
      else if (tier === 2) inferredRole = "coordinator";
      else if (tier === 3) inferredRole = "implementer";
    }
  } else if (explicitTierEnv !== null) {
    tier = explicitTierEnv;
    if (inferredRole === null) {
      if (tier === 0) inferredRole = "mind";
      else if (tier === 1) inferredRole = "orchestrator";
      else if (tier === 2) inferredRole = "coordinator";
      else if (tier === 3) inferredRole = "implementer";
    }
  } else if (explicitRole !== null) {
    tier = roleToTier(explicitRole);
  } else if (explicitAgentId !== null) {
    const tierFromAgent = agentIdToTier(explicitAgentId);
    tier = tierFromAgent ?? 3;
    if (inferredRole === null) {
      inferredRole = agentIdToRole(explicitAgentId);
    }
  } else if (hasInteractiveMainIndicator) {
    tier = 0;
  } else {
    tier = 0;
  }

  const isMainThread = hasInteractiveMainIndicator;
  const complianceState: "compliant" | "restrained" | "violation" = isMainThread
    ? "restrained"
    : "compliant";

  const advisory = isMainThread ? MAIN_THREAD_ADVISORY : null;

  let blunder: BlunderRecord | null = null;
  if (isMainThread) {
    const blunderId = `blunder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    blunder = {
      id: blunderId,
      type: "main_thread_direct_execution",
      severity: "critical",
      timestamp: new Date().toISOString(),
      pid,
      ppid,
      agent_id: inferredAgentId,
      observation:
        "Execution detected on interactive main conversation thread without subagent boundary delegation.",
      remediation:
        "Main thread must not directly modify code or execute implementation tasks. Dispatch Tier 2 Background Coordinators or Tier 3 Implementers via invoke_subagent.",
      context: {
        cwd,
        indicators,
      },
    };
    recordBlunder(blunder, {
      ...(options.runRoot !== undefined ? { runRoot: options.runRoot } : {}),
      cwd,
    });
  }

  const host_profile: HostProfile = {
    app_id: detectHostApp(env),
    os_platform: os.platform(),
    os_release: os.release(),
    os_arch: os.arch(),
    runtime_node: process.versions?.node ?? null,
    runtime_bun: (process.versions as Record<string, string | undefined>)?.bun ?? null,
  };

  const capabilities = buildCapabilitiesProfile(tier, env);

  return {
    pid,
    ppid,
    tier,
    tier_name: isMainThread ? "Main Interactive Agent Thread" : TIER_NAMES[tier],
    role: inferredRole,
    agent_id: inferredAgentId,
    is_main_thread: isMainThread,
    compliance_state: complianceState,
    advisory,
    indicators,
    blunder,
    host_profile,
    capabilities,
  };
}

export function formatThreadIdentificationBrief(id: ThreadIdentification): string {
  const lines = [
    `### Thread Authority Identification (\`whoami\`)`,
    `- **PID / PPID**: \`${id.pid}\` / \`${id.ppid}\``,
    `- **Execution Tier**: \`${id.is_main_thread ? "Main Interactive Agent Thread" : `Tier ${id.tier}`}\` (${id.tier_name})`,
    `- **Active Agent**: \`${id.agent_id ?? "none"}\`${id.role ? ` (role: \`${id.role}\`)` : ""}`,
    `- **Compliance**: \`${id.compliance_state.toUpperCase()}\``,
    `- **Host App**: \`${id.host_profile.app_id}\``,
    `- **OS Platform**: \`${id.host_profile.os_platform} ${id.host_profile.os_release} (${id.host_profile.os_arch})\``,
    `- **Runtime**: \`${id.host_profile.runtime_bun ? `bun ${id.host_profile.runtime_bun}` : `node ${id.host_profile.runtime_node}`}\``,
    `- **Taxonomy**: \`${id.capabilities.command_taxonomy}\``,
  ];

  if (id.capabilities.tools.length > 0) {
    lines.push(`- **Tools**: ${id.capabilities.tools.join(", ")}`);
  }
  if (id.capabilities.environment_grants.length > 0) {
    lines.push(`- **Environment Grants**: ${id.capabilities.environment_grants.join(", ")}`);
  }

  if (id.advisory) {
    lines.push(`- **Advisory**: ⚠️ ${id.advisory}`);
  }
  if (id.blunder) {
    lines.push(`- **Blunder Logged**: \`${id.blunder.id}\` (${id.blunder.type})`);
  }

  return lines.join("\n");
}
