import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { findRepoRoot, resolveCapsulesDir, resolveScratchDir } from "../shared/paths.ts";
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
  const repoRoot = findRepoRoot();
  if (runRoot && existsSync(runRoot) && resolve(runRoot) !== resolve(repoRoot)) {
    return join(runRoot, "runtime", `agent-${agentId}.json`);
  }
  return join(resolveScratchDir(repoRoot), "runtime", `agent-${agentId}.json`);
}

export function writeAgentMetadata(metadata: AgentMetadata, runRoot?: string): string {
  const filePath = getAgentMetadataPath(metadata.agent_id, runRoot);
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, JSON.stringify(metadata, null, 2) + "\n", "utf-8");
  return filePath;
}

export function findAgentMetadataLocation(
  agentId: string,
  preferredRunRoot?: string,
): { metadata: AgentMetadata; runRoot: string; filePath: string } | undefined {
  const repoRoot = findRepoRoot();
  const searchRoots: string[] = [];

  if (preferredRunRoot && existsSync(preferredRunRoot)) {
    searchRoots.push(resolve(preferredRunRoot));
  }

  // Scan capsule directories under .olt/capsules/
  const capsulesDir = resolveCapsulesDir(repoRoot);
  if (existsSync(capsulesDir)) {
    try {
      const entries = readdirSync(capsulesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          searchRoots.push(join(capsulesDir, entry.name));
        }
      }
    } catch {
      // ignore
    }
  }

  // Add scratch dir
  searchRoots.push(resolveScratchDir(repoRoot));

  for (const root of searchRoots) {
    const directPath = join(root, "runtime", `agent-${agentId}.json`);
    if (existsSync(directPath)) {
      try {
        const raw = readFileSync(directPath, "utf-8");
        const metadata = JSON.parse(raw) as AgentMetadata;
        return { metadata, runRoot: root, filePath: directPath };
      } catch {
        // ignore parse error
      }
    }

    const altPath = join(root, "runtime", `${agentId}.json`);
    if (existsSync(altPath)) {
      try {
        const raw = readFileSync(altPath, "utf-8");
        const metadata = JSON.parse(raw) as AgentMetadata;
        return { metadata, runRoot: root, filePath: altPath };
      } catch {
        // ignore
      }
    }
  }

  return undefined;
}

export function readAgentMetadata(agentId: string, runRoot?: string): AgentMetadata | undefined {
  return findAgentMetadataLocation(agentId, runRoot)?.metadata;
}
