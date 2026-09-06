import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  agentIdToRole,
  agentIdToTier,
  roleToTier,
  type ExecutionTier,
} from "../../authority/thread/index.ts";
import { resolveActiveSession } from "../../authority/session/resolver.ts";
import {
  getInMemorySessionData,
  isInMemorySessionStoreEnabled,
} from "../../authority/session/paths.ts";
import { isRecord } from "../../requirements/predicates.ts";
import type { TaskRecord, WorkflowState } from "../../workflow/types.ts";
import { computeCapsuleDoctorFacts } from "../doctor/facts.ts";
import { extractLeaseAgentId } from "../lease-agent-extractor.ts";
import type { SugiyamaEdge, SugiyamaNode } from "../sugiyama-dag/index.ts";
import type { UnifiedAgentRow } from "./types.ts";

const SCOPE_MATCHERS: [RegExp | string, string][] = [
  [/dag|reporting/, "Reporting & DAG Engine"],
  ["cluster-engine", "Engine & Scheduler Defects"],
  ["cluster-tooling", "Tooling & CLI Defects"],
  ["cluster-validation", "Validation Gate Defects"],
  ["cluster-mind", "Mind Cadence Defects"],
  ["cluster-core", "Core Shared Defects"],
  [/^mind-gen/, "Mind Autonomous Cadence"],
];

export function deriveCapsuleScope(
  runId: string,
  manifest?: Record<string, unknown> | null,
  promptPath?: string,
): string {
  if (typeof manifest?.title === "string" && manifest.title.trim()) {
    return manifest.title.trim();
  }
  if (typeof manifest?.scope === "string" && manifest.scope.trim()) {
    return manifest.scope.trim();
  }
  if (promptPath && existsSync(promptPath)) {
    try {
      const heading = readFileSync(promptPath, "utf-8")
        .split("\n")
        .find((l) => l.trim().startsWith("#"));
      if (heading) return heading.replace(/^#+\s*/, "").trim();
    } catch {}
  }
  for (const [pattern, label] of SCOPE_MATCHERS) {
    if (typeof pattern === "string" ? runId.includes(pattern) : pattern.test(runId)) {
      return label;
    }
  }
  return runId
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function getCapsuleDoctorHealth(capsulePath: string): string {
  try {
    const facts = computeCapsuleDoctorFacts(capsulePath);
    if (facts.healthy) return "✅ Healthy";
    return facts.criticalIssues.length > 0 ? "❌ Critical" : "⚠️ Warning";
  } catch {
    return "⚪ Unchecked";
  }
}

export function buildNodesAndEdges(
  tasks: readonly TaskRecord[],
  state?: WorkflowState | null,
): { nodes: SugiyamaNode[]; edges: SugiyamaEdge[] } {
  const nodes: SugiyamaNode[] = [];
  const edges: SugiyamaEdge[] = [];
  for (const t of tasks) {
    const deps = Array.isArray(t.dependencies) ? (t.dependencies as string[]) : [];
    const lease = isRecord(t.lease) ? t.lease : null;
    nodes.push({
      id: t.id,
      label: typeof t.label === "string" ? t.label : t.id,
      status: typeof t.status === "string" ? t.status : "proposed",
      priority: typeof t.priority === "number" ? t.priority : 50,
      writeScope: Array.isArray(t.write_scope) ? (t.write_scope as string[]) : [],
      resourceScope: Array.isArray(t.resource_scope) ? (t.resource_scope as string[]) : [],
      gate: typeof t.gate === "string" ? t.gate : undefined,
      dependencies: deps,
      assignedAgent: lease ? extractLeaseAgentId(lease) : null,
      attempt: lease && typeof lease.attempt === "number" ? lease.attempt : null,
      effort: typeof t.effort === "number" ? t.effort : 1,
    });
    for (const dep of deps) edges.push({ from: dep, to: t.id });
  }
  if (nodes.length === 0 && Array.isArray(state?.planning_buffer)) {
    for (const p of state.planning_buffer as {
      id: string;
      label?: string;
      deps?: string[];
      effort?: number;
      writeScope?: string[];
    }[]) {
      const deps = Array.isArray(p.deps) ? p.deps : [];
      nodes.push({
        id: p.id,
        label: p.label || p.id,
        status: "ready",
        priority: 50,
        writeScope: Array.isArray(p.writeScope) ? p.writeScope : [],
        dependencies: deps,
        effort: typeof p.effort === "number" ? p.effort : 1,
      });
      for (const dep of deps) edges.push({ from: dep, to: p.id });
    }
  }
  return { nodes, edges };
}

export function resolveSessionActor(repoRoot: string): {
  agentId: string;
  role: string;
  tier: ExecutionTier;
  fleetId?: string | undefined;
  taskId?: string | undefined;
} | null {
  const sessionPath = resolve(repoRoot, ".session.json");
  let parsed: Record<string, unknown> | null = null;
  if (isInMemorySessionStoreEnabled()) {
    const raw = getInMemorySessionData(sessionPath);
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch {}
    }
  }
  if (!parsed && existsSync(sessionPath)) {
    try {
      parsed = JSON.parse(readFileSync(sessionPath, "utf-8"));
    } catch {}
  }
  if (parsed && typeof parsed === "object") {
    const rawId = parsed.agent_id ?? parsed.agentId ?? parsed.actor ?? parsed.id;
    if (typeof rawId === "string" && rawId.trim()) {
      const agentId = rawId.trim();
      const role =
        typeof parsed.role === "string" && parsed.role.trim()
          ? parsed.role.trim()
          : (agentIdToRole(agentId) ?? "implementer");
      const tier = (
        typeof parsed.tier === "number"
          ? parsed.tier
          : (roleToTier(role) ?? agentIdToTier(agentId) ?? 3)
      ) as ExecutionTier;
      const fleetId = (parsed.fleet_id ?? parsed.fleetId ?? parsed.run_id ?? parsed.runId) as
        | string
        | undefined;
      const taskId = (parsed.task_id ?? parsed.taskId) as string | undefined;
      return { agentId, role, tier, fleetId, taskId };
    }
  }
  try {
    const active = resolveActiveSession({ cwd: repoRoot, runRoot: repoRoot });
    if (active?.agent_id) {
      return {
        agentId: active.agent_id,
        role: active.role,
        tier: active.tier,
        taskId: active.task_id,
      };
    }
  } catch {}
  return null;
}

export function computeSupervisoryStats(agentRoster: readonly UnifiedAgentRow[]): {
  mind: string;
  mindAuditor: string;
  skillAuditor: string;
  healthy: boolean;
} {
  let [hasMind, hasMindAuditor, skillAuditorCount] = [false, false, 0];
  for (const a of agentRoster) {
    const role = a.role.toLowerCase();
    const id = a.agentId.toLowerCase();
    if (a.status === "active") {
      if (
        role === "mind" ||
        (role.includes("mind") && !role.includes("auditor")) ||
        id.startsWith("mind-gen") ||
        id === "mind"
      ) {
        hasMind = true;
      }
      if (
        role.includes("mind-auditor") ||
        role.includes("mind_auditor") ||
        id.includes("mind_auditor") ||
        id.includes("mind-auditor")
      ) {
        hasMindAuditor = true;
      }
      if (
        role.includes("skill-auditor") ||
        role.includes("skill_auditor") ||
        id.includes("skill_auditor") ||
        id.includes("skill-auditor")
      ) {
        skillAuditorCount += 1;
      }
    }
  }
  return {
    mind: hasMind ? "Active" : "Inactive",
    mindAuditor: hasMindAuditor ? "Active" : "Inactive",
    skillAuditor: skillAuditorCount === 1 ? "1/1" : `${skillAuditorCount}/1`,
    healthy: hasMind ? hasMindAuditor && skillAuditorCount === 1 : true,
  };
}
