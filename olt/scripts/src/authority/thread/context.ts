import os from "node:os";
import { isTestEnvironment } from "../../core/shared/paths.ts";
import { MAIN_THREAD_ADVISORY, TIER_NAMES } from "./constants.ts";
import {
  agentIdToRole,
  agentIdToTier,
  parseTierValue,
  recordDefect,
  roleToTier,
} from "./role-mapping.ts";
import type {
  CapabilitiesProfile,
  DefectRecord,
  ExecutionContextOptions,
  ExecutionTier,
  HostProfile,
  ThreadIdentification,
} from "./types.ts";

export function detectHostApp(env: NodeJS.ProcessEnv | Record<string, string | undefined>): string {
  const termProgram = env["TERM_PROGRAM"]?.toLowerCase() || "";

  if (env["CLAUDE_CODE_VERSION"] || env["CLAUDE_CLI"]) return "Claude Code";
  if (env["ANTIGRAVITY_CLI"] || env["GEMINI_CLI"] || env["ANTIGRAVITY_VERSION"]) {
    return "Antigravity/Gemini CLI";
  }
  if (termProgram === "cursor" || env["CURSOR_VERSION"]) return "Cursor";
  if (env["OPENCODE_VERSION"] || env["OPENCODE_CLI"] || env["OPENCODE"]) return "OpenCode";
  if (env["CODEX_VERSION"] || env["CODEX_CLI"] || env["CODEX"]) return "Codex";
  if (termProgram === "vscode") return "VSCode Terminal";

  return "Generic Host";
}

export function buildCapabilitiesProfile(
  tier: ExecutionTier,
  env: Record<string, string | undefined>,
): CapabilitiesProfile {
  let taxonomy = "Restricted Sandbox";
  if (tier === 0) taxonomy = "Full Root / All Permissions";
  else if (tier === 1) taxonomy = "Orchestration / Delegation Only";
  else if (tier === 2) taxonomy = "Coordination / Dispatch Only";
  else if (tier === 3) taxonomy = "Implementation / Execution";

  const rawTools = env.GRANTED_TOOLS || env.AVAILABLE_TOOLS || "";
  const tools = rawTools
    ? rawTools
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];

  const rawGrants = env.ENVIRONMENT_GRANTS || env.TOOL_GRANTS || "";
  const environment_grants = rawGrants
    ? rawGrants
        .split(",")
        .map((g) => g.trim())
        .filter(Boolean)
    : [];

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
  const explicitRole = options.role ?? env.HARNESS_AGENT_ROLE ?? env.AGENT_ROLE ?? env.ROLE ?? null;
  const explicitAgentId = options.agentId ?? env.HARNESS_AGENT_ID ?? env.AGENT_ID ?? null;

  const isSubagent =
    env.HOST_SUBAGENT === "1" ||
    env.HOST_SUBAGENT === "true" ||
    Boolean(env.SUBAGENT_CONVERSATION_ID) ||
    Boolean(env.SUBAGENT_ROLE) ||
    (explicitRole !== null && explicitRole !== "user" && explicitRole !== "main");

  const hasInteractiveMainIndicator =
    options.isInteractiveMainThread === true ||
    (options.isInteractiveMainThread !== false &&
      (env.INTERACTIVE_MAIN_THREAD === "1" ||
        env.INTERACTIVE_MAIN_THREAD === "true" ||
        ((Boolean(env.HOST_SESSION) || Boolean(env.CONVERSATION_ID) || Boolean(env.SESSION_ID)) &&
          !isSubagent &&
          explicitTierEnv === null &&
          explicitRole === null &&
          explicitAgentId === null)));

  let tier: ExecutionTier = 3;
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
    tier = 3;
  }

  const isMainThread = hasInteractiveMainIndicator;
  const complianceState: "compliant" | "restrained" | "violation" = isMainThread
    ? "restrained"
    : "compliant";

  const advisory = isMainThread ? MAIN_THREAD_ADVISORY : null;

  let defect: DefectRecord | null = null;
  const argv = options.argv ?? (typeof process !== "undefined" ? process.argv : []);
  const executionActions = new Set([
    "test",
    "vitest",
    "pytest",
    "jest",
    "run:exec",
    "shell",
    "task:submit",
    "task:claim",
    "task:review",
    "replace_file",
    "write_to_file",
  ]);
  const matchedAction = argv.find((token) => executionActions.has(token));

  if (isMainThread && matchedAction !== undefined) {
    const defectId = `defect-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    defect = {
      id: defectId,
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
        matched_action: matchedAction,
      },
    };
    if (!isTestEnvironment() || options.recordDefectInTest) {
      recordDefect(defect, {
        ...(options.runRoot !== undefined ? { runRoot: options.runRoot } : {}),
        cwd,
      });
    }
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
    defect,
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
  if (id.defect) {
    lines.push(`- **Defect Logged**: \`${id.defect.id}\` (${id.defect.type})`);
  }

  return lines.join("\n");
}
