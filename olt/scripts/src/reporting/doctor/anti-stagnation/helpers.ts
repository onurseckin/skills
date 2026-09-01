
import type {
  DoctorDiagnosticFinding,
  DoctorSeverity,
} from "../types.ts";
import {
  type SerializedDebateMemory,
  type HistoricalDebateMemory,
} from "../../../mind/auditing/socratic/index.ts";
import {
  SupersessionIndex,
  type SupersessionIndexState,
} from "../../../mind/memory/index.ts";
import {
  type SuspendedAnimationSnapshot,
} from "../../../mind/lifecycle/index.ts";



// 2. Constants & Helpers
// ============================================================================

const SUPERVISOR_ROLES = new Set([
  "mind",
  "orchestrator",
  "coordinator",
  "supervisor",
  "lead",
  "architect",
  "mind-auditor",
  "skill-auditor",
]);

export const CODE_EDIT_TOOLS = new Set([
  "write_to_file",
  "replace_file_content",
  "edit_file",
  "apply_diff",
  "patch_file",
  "notebook_edit",
  "write_file",
]);

export const TEST_RUNNER_KEYWORDS = [
  "bun test",
  "npm test",
  "npm run test",
  "pnpm test",
  "yarn test",
  "pytest",
  "jest",
  "vitest",
  "cargo test",
  "go test",
];

export function normalizeRole(role?: string): string {
  if (!role) return "";
  return role.trim().toLowerCase().replace(/_/gu, "-");
}

export function isSupervisorRole(role?: string): boolean {
  if (!role) return false;
  return SUPERVISOR_ROLES.has(normalizeRole(role));
}

export function buildFinding(
  code: string,
  severity: DoctorSeverity,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): DoctorDiagnosticFinding {
  return {
    code,
    severity,
    engine: "checkAntiStagnationDoctor",
    message,
    details,
  };
}

// ============================================================================
// 3. Invariant Evaluation Suite
// ============================================================================

export interface InvariantContext {
  readonly state?: Readonly<Record<string, unknown>> | null | undefined;
  readonly events?: readonly unknown[] | null | undefined;
  readonly commands?: Readonly<Record<string, unknown>> | readonly unknown[] | null | undefined;
  readonly grants?: readonly unknown[] | null | undefined;
  readonly repoRoot?: string | undefined;
  readonly runRoot?: string | undefined;
  readonly nowMs: number;
  readonly maxDashboardStalenessMs: number;
  readonly socraticMemory?:
    | SerializedDebateMemory
    | HistoricalDebateMemory
    | Readonly<Record<string, unknown>>
    | null
    | undefined;
  readonly supersessionIndex?: SupersessionIndex | SupersessionIndexState | null | undefined;
  readonly suspendedSnapshot?: SuspendedAnimationSnapshot | null | undefined;
  readonly autoHeal: boolean;
}

export function resolveAgentRoleMap(ctx: InvariantContext): Map<string, string> {
  const agentRoleMap = new Map<string, string>();

  // Extract from grants
  const rawGrants = ctx.grants ?? (ctx.state?.grants as readonly unknown[] | undefined);
  if (Array.isArray(rawGrants)) {
    for (const grant of rawGrants) {
      if (grant && typeof grant === "object") {
        const g = grant as Record<string, unknown>;
        const id =
          typeof g.id === "string" ? g.id : typeof g.agent_id === "string" ? g.agent_id : undefined;
        const role = typeof g.role === "string" ? g.role : undefined;
        if (id && role) {
          agentRoleMap.set(id, role);
        }
      }
    }
  }

  // Extract from state.agents
  const rawAgents = ctx.state?.agents as Record<string, unknown> | undefined;
  if (rawAgents && typeof rawAgents === "object") {
    for (const [id, agent] of Object.entries(rawAgents)) {
      if (agent && typeof agent === "object") {
        const role =
          typeof (agent as Record<string, unknown>).role === "string"
            ? ((agent as Record<string, unknown>).role as string)
            : undefined;
        if (role) {
          agentRoleMap.set(id, role);
        }
      }
    }
  }

  return agentRoleMap;
}

export function inferAgentRole(agentId?: string, explicitRole?: string, roleMap?: Map<string, string>): string {
  if (explicitRole) return explicitRole;
  if (!agentId) return "";
  if (roleMap?.has(agentId)) return roleMap.get(agentId)!;

  const lower = agentId.toLowerCase();
  if (lower.startsWith("mind-auditor") || lower.includes("mind-auditor")) return "mind-auditor";
  if (lower.startsWith("skill-auditor") || lower.includes("skill-auditor")) return "skill-auditor";
  if (lower.startsWith("mind")) return "mind";
  if (lower.startsWith("orch") || lower.includes("orchestrator")) return "orchestrator";
  if (lower.startsWith("coord") || lower.includes("coordinator")) return "coordinator";
  if (lower.startsWith("impl") || lower.includes("implementer")) return "implementer";
  if (lower.startsWith("val") || lower.includes("validator")) return "validator";
  return "";
}

/**
 * 1. SUPERVISOR_ZERO_CODE_EDITS
 */