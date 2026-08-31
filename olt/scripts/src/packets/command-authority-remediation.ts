import { detectActiveHost, type HostType } from "../platform/host-autodetect.ts";

export type DetectedHost = HostType | "unknown";

export function resolveCurrentHost(
  env: Record<string, string | undefined> = process.env,
): DetectedHost {
  try {
    return detectActiveHost(env);
  } catch {
    return "unknown";
  }
}

function getHostToolName(host: DetectedHost): string {
  switch (host) {
    case "antigravity":
      return "invoke_subagent";
    case "claude_code":
      return "Agent / Task tools";
    case "codex":
      return "spawn_agent";
    case "cursor":
      return "subagent dispatch";
    default:
      return "subagent dispatch";
  }
}

function getHostDisplayName(host: DetectedHost): string {
  switch (host) {
    case "antigravity":
      return "Antigravity";
    case "claude_code":
      return "Claude Code";
    case "codex":
      return "Codex";
    case "cursor":
      return "Cursor";
    default:
      return "Host environment";
  }
}

export function formatHardlockRemediation(host: DetectedHost = resolveCurrentHost()): string {
  switch (host) {
    case "antigravity":
      return "[Remediation: In Antigravity, cognitive validators must not execute shell commands or tests directly. Delegate test execution to a mechanic-validator subagent via invoke_subagent or inspect files using read-only tools (view_file, read_resource).]";
    case "claude_code":
      return "[Remediation: In Claude Code, cognitive validators must not execute shell commands or tests directly. Delegate test execution to a mechanic-validator subagent via Agent/Task tools or inspect files using read-only tools.]";
    case "codex":
      return "[Remediation: In Codex, cognitive validators must not execute shell commands or tests directly. Delegate test execution to a mechanic-validator subagent via spawn_agent or inspect files using read-only tools.]";
    case "cursor":
      return "[Remediation: In Cursor, cognitive validators must not execute shell commands or tests directly. Delegate test execution to a mechanic-validator subagent or inspect files using read-only tools.]";
    default:
      return "[Remediation: Cognitive validators must not execute shell commands or tests directly. Delegate test execution to a mechanic-validator subagent or inspect files using read-only tools.]";
  }
}

export function formatHierarchicalRemediation(
  parentTier: number,
  _childTier: number,
  host: DetectedHost = resolveCurrentHost(),
): string {
  const hostLabel = getHostDisplayName(host);
  const toolName = getHostToolName(host);

  if (parentTier === 0) {
    return `[Remediation: In ${hostLabel}, Tier 0 Mind must dispatch a Tier 1 Orchestrator via ${toolName}.]`;
  }
  if (parentTier === 1) {
    return `[Remediation: In ${hostLabel}, Tier 1 Orchestrator must dispatch a Tier 2 Coordinator via ${toolName}.]`;
  }
  if (parentTier === 2) {
    return `[Remediation: In ${hostLabel}, Tier 2 Coordinator must dispatch Tier 3 workers (Implementer, Validator, Critic, Repairer) via ${toolName}.]`;
  }
  return `[Remediation: In ${hostLabel}, Tier 3 execution workers are leaf nodes and cannot spawn subagents. Request delegation from your supervising coordinator.]`;
}

export function formatSupervisionRemediation(
  _childRole: string,
  _childTier: number,
  host: DetectedHost = resolveCurrentHost(),
): string {
  const hostLabel = getHostDisplayName(host);
  const toolName = getHostToolName(host);
  return `[Remediation: In ${hostLabel}, pass --parent-agent <supervisor-id> with your active supervisor ID or dispatch through the supervising coordinator via ${toolName}.]`;
}

export function formatDeclaredSpawnRemediation(
  parentRole: string,
  childRole: string,
  host: DetectedHost = resolveCurrentHost(),
): string {
  const toolName = getHostToolName(host);
  return `[Remediation: Update the role contract for '${parentRole}' to declare '${childRole}' in its spawns allowlist, or dispatch an allowlisted role via ${toolName}.]`;
}

export function formatRoleContractRemediation(
  _role: string,
  commandName: string,
  host: DetectedHost = resolveCurrentHost(),
): string {
  const toolName = getHostToolName(host);
  return `[Remediation: Ensure agent holds an authorized role for ${commandName} or delegate the action to an authorized subagent via ${toolName}.]`;
}

export function formatSessionRemediation(
  _commandName: string,
  host: DetectedHost = resolveCurrentHost(),
): string {
  const hostLabel = getHostDisplayName(host);
  return `[Remediation: In ${hostLabel}, execute within an authenticated caller session backed by an active run grant, or provide --actor / --agent flags.]`;
}
