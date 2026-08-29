import { generateIncidentId } from "./types.ts";
import { runExtendedForensicsHeuristics } from "./heuristics-extended.ts";
import type {
  ForensicsIncident,
  ForensicsSeverity,
  RootCauseCategory,
  AgentGrantRecord,
  ExtractedToolCall,
} from "./types.ts";

export interface HeuristicsContext {
  readonly allToolCalls: readonly ExtractedToolCall[];
  readonly events: readonly Record<string, unknown>[];
  readonly state: Record<string, unknown> | null;
  readonly agentLedger: readonly AgentGrantRecord[];
  readonly agentId?: string | undefined;
  readonly addIncident: (inc: ForensicsIncident) => void;
}

export function runForensicsHeuristics(ctx: HeuristicsContext): {
  sequentialWaveBottlenecks: number;
} {
  const { allToolCalls, events, state, agentLedger, addIncident } = ctx;
  let sequentialWaveBottlenecks = 0;

  // Group tool calls by agent
  const callsByAgent = new Map<string, ExtractedToolCall[]>();
  for (const call of allToolCalls) {
    const aid = call.agentId || "unknown";
    if (!callsByAgent.has(aid)) callsByAgent.set(aid, []);
    callsByAgent.get(aid)!.push(call);
  }

  // --- HEURISTIC 1: Token Burning ---
  for (const [aid, agentCalls] of callsByAgent.entries()) {
    let readsBeforeWrite = 0;
    let writeFound = false;
    for (const call of agentCalls) {
      if (call.isWrite) {
        writeFound = true;
        break;
      }
      if (call.isRead) {
        readsBeforeWrite++;
      }
    }
    if (readsBeforeWrite >= 5) {
      const severity: ForensicsSeverity = readsBeforeWrite > 10 ? "CRITICAL" : "HIGH";
      addIncident({
        id: generateIncidentId("TOKEN_BURNING", `excessive_reads_${aid}`),
        category: "TOKEN_BURNING",
        severity,
        title: "Token Burning: Excessive Read Exploration Before First Edit",
        observation: `Agent '${aid}' executed ${readsBeforeWrite} read operations before first code modification.`,
        description: `Agent '${aid}' executed ${readsBeforeWrite} read operations before first code modification.`,
        remediation: "Direct agent to targeted edit site with explicit file paths and symbols.",
        recommendation: "Direct agent to targeted edit site with explicit file paths and symbols.",
        agentId: aid,
        toolCallsCount: readsBeforeWrite,
      });
    }
  }

  const readCalls = allToolCalls.filter((c) => c.isRead).length;
  const explorationRatio = allToolCalls.length > 0 ? readCalls / allToolCalls.length : 0;
  if (allToolCalls.length >= 15 && explorationRatio > 0.85) {
    addIncident({
      id: generateIncidentId("TOKEN_BURNING", "high_exploration_ratio"),
      category: "TOKEN_BURNING",
      severity: "MEDIUM",
      title: "Token Burning: High Exploration-to-Edit Ratio",
      observation: `Exploration ratio of ${Math.round(explorationRatio * 100)}% exceeds 85% threshold.`,
      description: `Exploration ratio of ${Math.round(explorationRatio * 100)}% exceeds 85% threshold.`,
      remediation: "Provide localized symbol anchors to reduce exploratory context bloat.",
      recommendation: "Provide localized symbol anchors to reduce exploratory context bloat.",
      toolCallsCount: readCalls,
    });
  }

  // --- HEURISTIC 2: False Serialization ---
  if (
    state &&
    typeof state === "object" &&
    typeof state["tasks"] === "object" &&
    state["tasks"] !== null
  ) {
    const rawTasks = Object.values(state["tasks"] as Record<string, Record<string, unknown>>);
    const taskList: {
      id: string;
      writeScope: string[];
      startedAt?: number | undefined;
      completedAt?: number | undefined;
    }[] = [];

    for (const t of rawTasks) {
      const id = String(t["id"] ?? "");
      const writeScope = Array.isArray(t["write_scope"]) ? (t["write_scope"] as string[]) : [];
      let startedAt: number | undefined;
      let completedAt: number | undefined;

      if (Array.isArray(t["attempts"]) && t["attempts"].length > 0) {
        const lastAtt = t["attempts"][t["attempts"].length - 1] as Record<string, unknown>;
        if (typeof lastAtt["started_at"] === "string")
          startedAt = Date.parse(lastAtt["started_at"]);
        if (typeof lastAtt["completed_at"] === "string")
          completedAt = Date.parse(lastAtt["completed_at"]);
      }

      taskList.push({ id, writeScope, startedAt, completedAt });
    }

    taskList.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));

    for (let i = 0; i < taskList.length - 1; i++) {
      const tA = taskList[i];
      const tB = taskList[i + 1];
      if (tA && tB && tA.writeScope.length > 0 && tB.writeScope.length > 0) {
        const hasOverlap = tA.writeScope.some((f) => tB.writeScope.includes(f));
        if (!hasOverlap && tA.completedAt && tB.startedAt && tB.startedAt >= tA.completedAt) {
          sequentialWaveBottlenecks++;
        }
      }
    }

    if (sequentialWaveBottlenecks >= 2) {
      addIncident({
        id: generateIncidentId("FALSE_SERIALIZATION", "wave_bottleneck"),
        category: "FALSE_SERIALIZATION",
        severity: "MEDIUM",
        title: "False Serialization Detected: Disjoint Tasks Executed Serially",
        observation: `Identified ${sequentialWaveBottlenecks} instances where tasks with non-overlapping write scopes were executed in sequence.`,
        description: `Identified ${sequentialWaveBottlenecks} instances where tasks with non-overlapping write scopes were executed in sequence.`,
        remediation:
          "Implement Wave Concurrency by grouping ready tasks with disjoint write scopes.",
        recommendation:
          "Implement Wave Concurrency by grouping ready tasks with disjoint write scopes.",
      });
    }
  }

  // --- HEURISTIC 3: Role Boundary Deviation ---
  for (const call of allToolCalls) {
    const role = String(call.agentRole || call.agentId || "").toLowerCase();
    const tool = String(call.toolName || call.name || "").toLowerCase();
    const isCoord = role.includes("coord");
    const isVal = role.includes("val");
    const isWrite =
      tool.includes("write") ||
      tool.includes("replace") ||
      tool.includes("edit") ||
      tool.includes("patch");
    const isExec = tool === "run_command" || tool.includes("exec") || tool.includes("bash");

    if (isCoord && isWrite) {
      addIncident({
        id: generateIncidentId("ROLE_BOUNDARY_DEVIATION", `coord_write_${tool}`),
        category: "ROLE_BOUNDARY_DEVIATION",
        severity: "CRITICAL",
        title: "Role Boundary Deviation: Coordinator Direct Code Modification",
        observation: `Coordinator '${call.agentId}' executed code modification tool '${tool}'.`,
        description: `Coordinator '${call.agentId}' executed code modification tool '${tool}'.`,
        remediation: "Coordinators must delegate code edits exclusively to Tier 3 Implementers.",
        recommendation: "Coordinators must delegate code edits exclusively to Tier 3 Implementers.",
        agentId: call.agentId,
      });
    }
    if (isVal) {
      let isForbidden = isWrite;
      if (isExec) {
        const cmd = String(
          call.rawArguments?.["CommandLine"] ?? call.rawArguments?.["command"] ?? "",
        );
        const isTestCommand = cmd.includes("test") || cmd.includes("spec") || cmd.includes("check");
        if (!isTestCommand) isForbidden = true;
      }
      if (isForbidden) {
        addIncident({
          id: generateIncidentId("ROLE_BOUNDARY_DEVIATION", `validator_${tool}`),
          category: "ROLE_BOUNDARY_DEVIATION",
          severity: "HIGH",
          title: "Role Boundary Deviation: Validator Execution/Write Tool Call",
          observation:
            "Validator agent `" +
            String(call.agentId ?? "") +
            "` attempted forbidden tool '" +
            tool +
            "'.",
          description:
            "Validator agent `" +
            String(call.agentId ?? "") +
            "` attempted forbidden tool '" +
            tool +
            "'.",
          remediation: "Cognitive Validators must evaluate deliverables via read-only inspection.",
          recommendation:
            "Cognitive Validators must evaluate deliverables via read-only inspection.",
          agentId: call.agentId,
        });
      }
    }
  }

  // Run extended heuristics (Polling Waste, Context Overflow, Ghost Lease, Straggler)
  runExtendedForensicsHeuristics(ctx);

  return { sequentialWaveBottlenecks };
}
