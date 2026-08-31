import { isCoordinatorRole, isOrchestratorRole, isValidatorRole } from "../roles/index.ts";
import {
  isContractuallyReadOnlyRole,
  isPermittedValidatorTool,
  parseTaskEntry,
  resolveAgentRole,
} from "./classifier.ts";
import { runExtendedForensicsHeuristics } from "./heuristics-extended.ts";
import type {
  AgentGrantRecord,
  ExtractedToolCall,
  ForensicsIncident,
  ForensicsSeverity,
  RootCauseCategory,
} from "./types.ts";
import { generateIncidentId } from "./types.ts";

export interface HeuristicsContext {
  readonly allToolCalls: readonly ExtractedToolCall[];
  readonly events: readonly Record<string, unknown>[];
  readonly state: Record<string, unknown> | null;
  readonly agentLedger: readonly AgentGrantRecord[];
  readonly agentId?: string | undefined;
  readonly addIncident: (inc: ForensicsIncident) => void;
}

const REM_DIR_EDIT = "Direct agent to targeted edit site with explicit file paths and symbols.";
const REM_WAVE_CONC =
  "Implement Wave Concurrency by grouping ready tasks with disjoint write scopes.";
const REM_DELEGATE =
  "Supervisors and orchestrators must delegate code edits exclusively to Tier 3 Implementers.";
const REM_READ_ONLY = "Cognitive Validators must evaluate deliverables via read-only inspection.";
const REM_ANCHORS = "Provide localized symbol anchors to reduce exploratory context bloat.";

function inc(
  cat: RootCauseCategory,
  target: string,
  title: string,
  desc: string,
  remediation: string,
  severity: ForensicsSeverity = "MEDIUM",
  opts?: { agentId?: string | undefined; toolCallsCount?: number | undefined },
): ForensicsIncident {
  return {
    id: generateIncidentId(cat, target),
    category: cat,
    severity,
    title,
    observation: desc,
    description: desc,
    remediation,
    recommendation: remediation,
    agentId: opts?.agentId,
    toolCallsCount: opts?.toolCallsCount,
  };
}

export function runForensicsHeuristics(ctx: HeuristicsContext): {
  sequentialWaveBottlenecks: number;
} {
  const { allToolCalls, events, state, agentLedger, addIncident } = ctx;
  let sequentialWaveBottlenecks = 0;

  const callsByAgent = new Map<string, ExtractedToolCall[]>();
  for (const call of allToolCalls) {
    const aid = call.agentId || "unknown";
    if (!callsByAgent.has(aid)) callsByAgent.set(aid, []);
    callsByAgent.get(aid)!.push(call);
  }

  for (const [aid, agentCalls] of callsByAgent.entries()) {
    const role = resolveAgentRole(aid, agentCalls, agentLedger, state);
    if (isContractuallyReadOnlyRole(role)) continue;

    let readsBeforeWrite = 0;
    for (const call of agentCalls) {
      if (call.isWrite) break;
      if (call.isRead) readsBeforeWrite++;
    }
    if (readsBeforeWrite >= 5) {
      const severity: ForensicsSeverity = readsBeforeWrite > 10 ? "CRITICAL" : "HIGH";
      addIncident(
        inc(
          "TOKEN_BURNING",
          `excessive_reads_${aid}`,
          "Token Burning: Excessive Read Exploration Before First Edit",
          `Agent '${aid}' executed ${readsBeforeWrite} read operations before first code modification.`,
          REM_DIR_EDIT,
          severity,
          { agentId: aid, toolCallsCount: readsBeforeWrite },
        ),
      );
    }
  }

  const nonReadOnlyCalls = allToolCalls.filter(
    (c) => !isContractuallyReadOnlyRole(resolveAgentRole(c.agentId || "", [c], agentLedger, state)),
  );
  if (nonReadOnlyCalls.length >= 15) {
    const readCalls = nonReadOnlyCalls.filter((c) => c.isRead).length;
    const explorationRatio = readCalls / nonReadOnlyCalls.length;
    if (explorationRatio > 0.85) {
      addIncident(
        inc(
          "TOKEN_BURNING",
          "high_exploration_ratio",
          "Token Burning: High Exploration-to-Edit Ratio",
          `Exploration ratio of ${Math.round(explorationRatio * 100)}% exceeds 85% threshold.`,
          REM_ANCHORS,
          "MEDIUM",
          { toolCallsCount: readCalls },
        ),
      );
    }
  }

  if (
    state &&
    typeof state === "object" &&
    typeof state["tasks"] === "object" &&
    state["tasks"] !== null
  ) {
    const taskList = Object.values(state["tasks"] as Record<string, Record<string, unknown>>)
      .map(parseTaskEntry)
      .sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));

    for (let i = 0; i < taskList.length - 1; i++) {
      const tA = taskList[i];
      const tB = taskList[i + 1];
      if (tA && tB && tA.writeScope.length > 0 && tB.writeScope.length > 0) {
        const hasOverlap = tA.writeScope.some((f) => tB.writeScope.includes(f));
        const hasCausalDependency =
          tB.dependencies.includes(tA.id) || tA.dependencies.includes(tB.id);
        if (
          !hasOverlap &&
          !hasCausalDependency &&
          tA.completedAt &&
          tB.startedAt &&
          tB.startedAt >= tA.completedAt
        ) {
          sequentialWaveBottlenecks++;
        }
      }
    }

    if (sequentialWaveBottlenecks >= 2) {
      addIncident(
        inc(
          "FALSE_SERIALIZATION",
          "wave_bottleneck",
          "False Serialization Detected: Disjoint Tasks Executed Serially",
          `Identified ${sequentialWaveBottlenecks} instances where tasks with non-overlapping write scopes were executed in sequence.`,
          REM_WAVE_CONC,
        ),
      );
    }
  }

  for (const call of allToolCalls) {
    const rawRole = resolveAgentRole(call.agentId || "", [call], agentLedger, state);
    const tool = String(call.toolName || call.name || "").toLowerCase();
    const isCoord =
      isCoordinatorRole(rawRole) ||
      isOrchestratorRole(rawRole) ||
      rawRole.toLowerCase().includes("superv");
    const isVal = isValidatorRole(rawRole);

    if (isCoord && call.isWrite) {
      addIncident(
        inc(
          "ROLE_BOUNDARY_DEVIATION",
          `coord_write_${tool}`,
          "Role Boundary Deviation: Coordinator Direct Code Modification",
          `Coordinator '${call.agentId}' executed code modification tool '${tool}'.`,
          REM_DELEGATE,
          "CRITICAL",
          { agentId: call.agentId },
        ),
      );
    }
    if (isVal && !isPermittedValidatorTool(call)) {
      addIncident(
        inc(
          "ROLE_BOUNDARY_DEVIATION",
          `validator_${tool}`,
          "Role Boundary Deviation: Validator Execution/Write Tool Call",
          `Validator agent \`${String(call.agentId ?? "")}\` attempted forbidden tool '${tool}'.`,
          REM_READ_ONLY,
          "HIGH",
          { agentId: call.agentId },
        ),
      );
    }
  }

  for (const evt of events) {
    const isViolation =
      evt["type"] === "boundary_violation" ||
      evt["error_code"] === "ROLE_BOUNDARY_DEVIATION" ||
      evt["category"] === "ROLE_BOUNDARY_DEVIATION";
    if (isViolation) {
      const eventTarget =
        typeof evt["command_id"] === "string" && evt["command_id"].length > 0
          ? evt["command_id"]
          : typeof evt["message"] === "string" && evt["message"].length > 0
            ? evt["message"]
            : "unknown";
      const eventMessage =
        typeof evt["message"] === "string" && evt["message"].length > 0
          ? evt["message"]
          : "unknown";
      const eventActor =
        typeof evt["actor"] === "string" && evt["actor"].length > 0 ? evt["actor"] : "unknown";
      addIncident(
        inc(
          "ROLE_BOUNDARY_DEVIATION",
          eventTarget,
          "Role Boundary Deviation: Supervisor Direct Code Modification",
          eventMessage,
          REM_DELEGATE,
          "CRITICAL",
          { agentId: eventActor },
        ),
      );
    }
  }

  runExtendedForensicsHeuristics(ctx);
  return { sequentialWaveBottlenecks };
}
