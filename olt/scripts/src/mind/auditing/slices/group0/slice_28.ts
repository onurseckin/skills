import { HarnessError } from "../../../../core/errors/index.ts";
import { basename, dirname, join, resolve } from "node:path";
import { parseEventsFile, generateIncidentId } from "./slice_24.ts";
import { parseStateFile, parseManifestFile, calculateEfficiencyScore } from "./slice_25.ts";
import { extractToolCallsFromTranscripts, extractToolCallsFromEvents } from "./slice_25.ts";
import { synthesizeRemediationPlan } from "./slice_26.ts";
import type {
  AnalyzeRunForensicsOptions,
  ForensicsAnalysisResult,
  ForensicsIncident,
  ForensicsSeverity,
  RootCauseCategory,
  AgentGrantRecord,
} from "./slice_20.ts";

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function analyzeRunForensics(options: AnalyzeRunForensicsOptions): ForensicsAnalysisResult {
  const rootRaw = options.runRoot ?? options.run;
  if (!rootRaw || !rootRaw.trim()) {
    throw new HarnessError("INVALID_ARGUMENT", "runRoot option is required for forensics analysis");
  }

  const runRootPath = resolve(rootRaw.trim());
  const eventsFile = options.eventsPath ?? join(runRootPath, "events.jsonl");
  const stateFile = options.statePath ?? join(runRootPath, "state.json");
  const manifestFile = options.manifestPath ?? join(runRootPath, "manifest.json");

  const events = parseEventsFile(eventsFile);
  const state = parseStateFile(stateFile);
  const manifest = parseManifestFile(manifestFile);

  const runId = options.runId ?? manifest?.run_id ?? (state as unknown as Record<string, unknown>)?.["manifest"]?.["run_id"] ?? (state as unknown as Record<string, unknown>)?.["run_id"] ?? basename(runRootPath);
  const analyzedAt = new Date().toISOString();

  // Extract agent ledger
  let agentLedger: readonly AgentGrantRecord[] = [];
  if (options.agentLedger && options.agentLedger.length > 0) {
    agentLedger = options.agentLedger;
  } else if (state && Array.isArray(state["agents"])) {
    agentLedger = state["agents"] as unknown as AgentGrantRecord[];
  }

  // Filter agent ledger if agent filter requested
  if (options.agent) {
    agentLedger = agentLedger.filter((a) => ((a as unknown as Record<string, unknown>).id ?? (a as unknown as Record<string, unknown>).agent_id ?? (a as unknown as Record<string, unknown>).name) === options.agent);
  }

  // Gather tool calls from transcripts and events
  const transcriptCalls =
    options.transcripts && options.transcripts.length > 0
      ? extractToolCallsFromTranscripts(options.transcripts)
      : [];
  const eventCalls = extractToolCallsFromEvents(events);
  let allToolCalls = [...eventCalls, ...transcriptCalls];

  if (options.agent) {
    allToolCalls = allToolCalls.filter((c) => c.agentId === options.agent);
  }

  // Aggregation variables
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let fileReadCount = 0;
  let fileWriteCount = 0;
  let pollingCallsCount = 0;

  for (const agent of agentLedger) {
    if (typeof agent.tokens_in === "number") totalTokensIn += agent.tokens_in;
    else if (isJsonObject(agent.tokens_in) && typeof agent.tokens_in["value"] === "number") {
      totalTokensIn += agent.tokens_in["value"] as number;
    }
    if (typeof agent.tokens_out === "number") totalTokensOut += agent.tokens_out;
    else if (isJsonObject(agent.tokens_out) && typeof agent.tokens_out["value"] === "number") {
      totalTokensOut += agent.tokens_out["value"] as number;
    }
  }

  for (const call of allToolCalls) {
    if (call.isRead) fileReadCount++;
    if (call.isWrite) fileWriteCount++;
    if (call.isPoll) pollingCallsCount++;
  }

  // Count events that are polling
  for (const ev of events) {
    if (ev.kind === "task-polled" || ev.kind === "agent-polled") {
      pollingCallsCount++;
    }
  }

  const readToWriteRatio = fileWriteCount > 0 ? fileReadCount / fileWriteCount : fileReadCount;

  // Extract tasks from state
  const stateTasks: Record<string, Record<string, unknown>> = {};
  if (state && isJsonObject(state["tasks"])) {
    const rawTasks = state["tasks"] as Record<string, unknown>;
    for (const [k, v] of Object.entries(rawTasks)) {
      if (isJsonObject(v)) stateTasks[k] = v as Record<string, unknown>;
    }
  }

  // Incident collection
  const incidents: ForensicsIncident[] = [];
  const categoryCounts: Record<RootCauseCategory, number> = {
    TOKEN_BURNING: 0,
    FALSE_SERIALIZATION: 0,
    ROLE_BOUNDARY_DEVIATION: 0,
    POLLING_WASTE: 0,
    CONTEXT_OVERFLOW: 0,
    GHOST_LEASE: 0,
    STRAGGLER: 0,
  };
  const severityCounts: Record<ForensicsSeverity, number> = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
  };

  function addIncident(incident: ForensicsIncident): void {
    if (options.agent && incident.agentId && incident.agentId !== options.agent) {
      return;
    }
    incidents.push(incident);
    categoryCounts[incident.category]++;
    severityCounts[incident.severity]++;
  }

  // --- HEURISTIC 1: Token Burning (File browsing before edit / excessive reads) ---
  const agentCallsMap = new Map<string, ExtractedToolCall[]>();
  for (const call of allToolCalls) {
    const agKey = call.agentId ?? "unknown-agent";
    const existing = agentCallsMap.get(agKey) ?? [];
    existing.push(call);
    agentCallsMap.set(agKey, existing);
  }

  for (const [agentId, calls] of agentCallsMap.entries()) {
    let readsBeforeFirstWrite = 0;
    let hasWritten = false;
    const browsedPaths: string[] = [];

    for (const call of calls) {
      if (call.isWrite) {
        hasWritten = true;
        break;
      }
      if (call.isRead) {
        readsBeforeFirstWrite++;
        if (call.targetPath) browsedPaths.push(call.targetPath);
      }
    }

    if (readsBeforeFirstWrite > 5) {
      const title = `Excessive Exploratory Browsing by Agent \`${agentId}\` (${readsBeforeFirstWrite} reads before edit)`;
      const desc = `Agent \`${agentId}\` performed ${readsBeforeFirstWrite} consecutive read/browse tool calls before performing its first code edit. This indicates lack of exact-anchor briefings and burns significant context tokens.`;
      const rec =
        "Provide zero-exploration exact-anchor task briefings containing precise file paths, line ranges, and drop-in code replacements so implementers can make immediate edits.";

      addIncident({
        id: generateIncidentId("TOKEN_BURNING", agentId),
        category: "TOKEN_BURNING",
        severity: readsBeforeFirstWrite > 12 ? "CRITICAL" : "HIGH",
        title,
        description: desc,
        observation: desc,
        remediation: rec,
        recommendation: rec,
        agentId,
        agent_id: agentId,
        root_cause: "Lack of exact-anchor task briefing forcing blind search",
        rootCause: "Lack of exact-anchor task briefing forcing blind search",
        impact: `Wasted ~${readsBeforeFirstWrite * 2000} input tokens in exploratory file reads`,
        evidence: {
          readsBeforeFirstWrite,
          hasWritten,
          browsedPaths: browsedPaths.slice(0, 10),
        },
      });
    }
  }

  // Check overall read-to-write ratio token burning
  if (fileReadCount > 15 && readToWriteRatio > 10.0) {
    const title = `Disproportionate Read-to-Write Ratio (${readToWriteRatio.toFixed(1)}:1)`;
    const desc = `Run executed ${fileReadCount} file read operations against only ${fileWriteCount} write operations (ratio ${readToWriteRatio.toFixed(1)}:1). Blind search and directory browsing dominated over implementation work.`;
    const rec =
      "Equip implementer agents with exact line targets and drop-in anchors to collapse exploration overhead.";

    addIncident({
      id: generateIncidentId("TOKEN_BURNING", "global-ratio"),
      category: "TOKEN_BURNING",
      severity: readToWriteRatio > 25.0 ? "CRITICAL" : "HIGH",
      title,
      description: desc,
      observation: desc,
      remediation: rec,
      recommendation: rec,
      root_cause: "High exploration-to-edit ratio across run",
      rootCause: "High exploration-to-edit ratio across run",
      impact: `Wasted approximately ${Math.round((fileReadCount - 5) * 1800)} tokens on file context`,
      evidence: { fileReadCount, fileWriteCount, readToWriteRatio },
    });
  }

  // --- HEURISTIC 2: False Serialization & Concurrency Bottlenecks ---
  const taskOrder: TaskOrderEntry[] = [];
  for (const [taskId, tObj] of Object.entries(stateTasks)) {
    const ws = Array.isArray(tObj["write_scope"]) ? (tObj["write_scope"] as string[]) : [];
    let sAt: number | undefined = undefined;
    let cAt: number | undefined = undefined;

    if (Array.isArray(tObj["attempts"])) {
      for (const att of tObj["attempts"]) {
        if (isJsonObject(att)) {
          if (typeof att["started_at"] === "string") sAt = Date.parse(att["started_at"] as string);
          if (typeof att["completed_at"] === "string")
            cAt = Date.parse(att["completed_at"] as string);
        }
      }
    }
    taskOrder.push({
      id: taskId,
      writeScope: ws,
      ...(sAt !== undefined ? { startedAt: sAt } : {}),
      ...(cAt !== undefined ? { completedAt: cAt } : {}),
    });
  }

  let sequentialWaveBottlenecks = 0;
  for (let i = 0; i < taskOrder.length - 1; i++) {
    const tA = taskOrder[i];
    const tB = taskOrder[i + 1];
    if (tA && tB && tA.writeScope.length > 0 && tB.writeScope.length > 0) {
      const overlap = tA.writeScope.some((f) => tB.writeScope.includes(f));
      if (!overlap && tA.completedAt && tB.startedAt && tB.startedAt >= tA.completedAt) {
        sequentialWaveBottlenecks++;
      }
    }
  }

  if (sequentialWaveBottlenecks >= 2) {
    const title = `False Serialization Detected: ${sequentialWaveBottlenecks} Disjoint Tasks Executed Serially`;
    const desc = `Identified ${sequentialWaveBottlenecks} instances where tasks with non-overlapping write scopes were executed in sequence rather than parallel wave concurrency.`;
    const rec =
      "Implement Wave Concurrency by grouping ready tasks with disjoint write scopes and dispatching them simultaneously.";

    addIncident({
      id: generateIncidentId("FALSE_SERIALIZATION", "disjoint-tasks"),
      category: "FALSE_SERIALIZATION",
      severity: sequentialWaveBottlenecks >= 4 ? "HIGH" : "MEDIUM",
      title,
      description: desc,
      observation: desc,
      remediation: rec,
      recommendation: rec,
      root_cause: "Missing wave concurrency scheduling for independent task scopes",
      rootCause: "Missing wave concurrency scheduling for independent task scopes",
      impact: `Increased total wall-clock span by approx ${sequentialWaveBottlenecks * 20}s`,
      evidence: { sequentialWaveBottlenecks },
    });
  }

  // --- HEURISTIC 3: Role Boundary Deviation ---
  let boundaryDeviationsCount = 0;
  for (const call of allToolCalls) {
    const agId = (call.agentId ?? "").toLowerCase();
    const isCoordinator = agId.includes("coord") || agId.includes("orchestrat");
    const isValidator = agId.includes("validator") || agId.includes("val_");

    if (isCoordinator && call.isWrite) {
      boundaryDeviationsCount++;
      const title = `Coordinator Direct Code Modification Deviation (\`${call.agentId}\`)`;
      const desc = `Coordinator agent \`${call.agentId}\` directly invoked write tool \`${call.name}\` on \`${call.targetPath ?? "target"}\`. Coordinators must strictly delegate code edits to Tier 3 implementers.`;
      const rec =
        "Enforce strict supervisory persona invariants prohibiting coordinator write actions.";

      addIncident({
        id: generateIncidentId(
          "ROLE_BOUNDARY_DEVIATION",
          `coord-write-${call.targetPath ?? "file"}`,
        ),
        category: "ROLE_BOUNDARY_DEVIATION",
        severity: "CRITICAL",
        title,
        description: desc,
        observation: desc,
        remediation: rec,
        recommendation: rec,
        agentId: call.agentId,
        agent_id: call.agentId,
        root_cause: "Supervisory role directly editing source code",
        rootCause: "Supervisory role directly editing source code",
        impact: "Breached separation of concerns and lease-bounded write scope policy",
        evidence: { tool: call.name, target: call.targetPath },
      });
    }

    if (
      isValidator &&
      (call.isWrite ||
        (call.name === "run_command" &&
          call.rawArguments?.["CommandLine"] &&
          !(call.rawArguments["CommandLine"] as string).includes("test")))
    ) {
      boundaryDeviationsCount++;
      const title = `Validator Execution Boundary Deviation (\`${call.agentId}\`)`;
      const desc = `Validator agent \`${call.agentId}\` performed non-validation execution or write tool \`${call.name}\`. Validators must remain pure cognitive verification actors.`;
      const rec = "Restrict validator tool grants to read, test execution, and packet review APIs.";

      addIncident({
        id: generateIncidentId("ROLE_BOUNDARY_DEVIATION", `validator-action-${call.name}`),
        category: "ROLE_BOUNDARY_DEVIATION",
        severity: "HIGH",
        title,
        description: desc,
        observation: desc,
        remediation: rec,
        recommendation: rec,
        agentId: call.agentId,
        agent_id: call.agentId,
        root_cause: "Validator executing arbitrary bash commands or file modifications",
        rootCause: "Validator executing arbitrary bash commands or file modifications",
        impact: "Bypasses validator cognitive independence",
        evidence: { tool: call.name, arguments: call.rawArguments },
      });
    }
  }

  // --- HEURISTIC 4: Polling Waste ---
  if (pollingCallsCount >= 4) {
    const title = `Excessive Async Polling Loops (${pollingCallsCount} poll calls)`;
    const desc = `Run recorded ${pollingCallsCount} active status/poll requests. Active polling wastes tokens and turns; agents should leverage reactive wakeup notifications with WaitMsBeforeAsync: 10000.`;
    const rec =
      "Enforce WaitMsBeforeAsync: 10000 and stop tool calling to await automatic reactive resumption.";

    addIncident({
      id: generateIncidentId("POLLING_WASTE", "status-loop"),
      category: "POLLING_WASTE",
      severity: pollingCallsCount >= 10 ? "HIGH" : "MEDIUM",
      title,
      description: desc,
      observation: desc,
      remediation: rec,
      recommendation: rec,
      root_cause: "Active status polling instead of reactive wakeup sleep",
      rootCause: "Active status polling instead of reactive wakeup sleep",
      impact: `Wasted approximately ${pollingCallsCount * 500} tokens in redundant status checks`,
      evidence: { pollingCallsCount },
    });
  }

  // --- HEURISTIC 5: Context Overflow ---
  let contextOverflowCount = 0;
  for (const agent of agentLedger) {
    let tIn = 0;
    if (typeof agent.tokens_in === "number") tIn = agent.tokens_in;
    else if (isJsonObject(agent.tokens_in) && typeof agent.tokens_in["value"] === "number") {
      tIn = agent.tokens_in["value"] as number;
    }

    if (tIn > 150000) {
      contextOverflowCount++;
      const title = `Context Saturation for Agent \`${agent.id}\` (${tIn.toLocaleString()} tokens in)`;
      const desc = `Agent \`${agent.id}\` consumed ${tIn.toLocaleString()} prompt input tokens, exceeding the 150,000 threshold and approaching maximum window saturation.`;
      const rec =
        "Implement transcript chunking and purge verbose diagnostic logs prior to subagent turns.";

      addIncident({
        id: generateIncidentId("CONTEXT_OVERFLOW", agent.id),
        category: "CONTEXT_OVERFLOW",
        severity: tIn > 180000 ? "CRITICAL" : "HIGH",
        title,
        description: desc,
        observation: desc,
        remediation: rec,
        recommendation: rec,
        agentId: agent.id,
        agent_id: agent.id,
        root_cause: "Unbounded context accumulation in subagent session",
        rootCause: "Unbounded context accumulation in subagent session",
        impact: "Severe risk of context overflow and degradation of reasoning quality",
        evidence: { agentId: agent.id, tokensIn: tIn },
      });
    }
  }

  // --- HEURISTIC 6: Ghost Lease ---
  let ghostLeasesCount = 0;
  for (const [taskId, tObj] of Object.entries(stateTasks)) {
    const status = tObj["status"];
    const lease = isJsonObject(tObj["lease"]) ? (tObj["lease"] as Record<string, unknown>) : null;
    const originalImplementer =
      typeof tObj["original_implementer"] === "string"
        ? (tObj["original_implementer"] as string)
        : undefined;

    if (status === "leased" || status === "stale") {
      const holder = (lease?.["agent_id"] as string | undefined) ?? originalImplementer;
      if (holder) {
        const agentRecord = agentLedger.find((a) => ((a as unknown as Record<string, unknown>).id ?? (a as unknown as Record<string, unknown>).agent_id ?? (a as unknown as Record<string, unknown>).name) === holder);
        if (agentRecord?.status === "released") {
          ghostLeasesCount++;
          const title = `Ghost Lease on Task \`${taskId}\` by Released Agent \`${holder}\``;
          const desc = `Task \`${taskId}\` remains leased to agent \`${holder}\`, but the agent grant has already been released without task completion or explicit surrender.`;
          const rec = "Reclaim stale leases immediately upon agent release or heartbeat expiry.";

          addIncident({
            id: generateIncidentId("GHOST_LEASE", taskId),
            category: "GHOST_LEASE",
            severity: "HIGH",
            title,
            description: desc,
            observation: desc,
            remediation: rec,
            recommendation: rec,
            taskId,
            task_id: taskId,
            agentId: holder,
            agent_id: holder,
            root_cause: "Agent released without task surrender or completion",
            rootCause: "Agent released without task surrender or completion",
            impact: "Task deadlock preventing subsequent implementers from claiming work",
            evidence: { taskId, agentId: holder, taskStatus: status },
          });
        }
      }
    }
  }

  // --- HEURISTIC 7: Straggler Tasks ---
  let stragglerTasksCount = 0;
  const taskDurations: Array<{ id: string; durationMs: number }> = [];
  for (const t of taskOrder) {
    if (t.startedAt && t.completedAt && t.completedAt > t.startedAt) {
      taskDurations.push({ id: t.id, durationMs: t.completedAt - t.startedAt });
    }
  }

  if (taskDurations.length >= 3) {
    const avgDuration =
      taskDurations.reduce((sum, d) => sum + d.durationMs, 0) / taskDurations.length;
    for (const td of taskDurations) {
      if (td.durationMs > Math.max(120000, avgDuration * 3.0)) {
        stragglerTasksCount++;
        const title = `Straggler Task Detected: \`${td.id}\` (${Math.round(td.durationMs / 1000)}s runtime)`;
        const desc = `Task \`${td.id}\` required ${Math.round(td.durationMs / 1000)}s to complete, exceeding 3x the average task duration (${Math.round(avgDuration / 1000)}s).`;
        const rec = "Decompose large multi-file tasks into smaller 1-file atomic tasks.";

        addIncident({
          id: generateIncidentId("STRAGGLER", td.id),
          category: "STRAGGLER",
          severity: td.durationMs > 600000 ? "HIGH" : "MEDIUM",
          title,
          description: desc,
          observation: desc,
          remediation: rec,
          recommendation: rec,
          taskId: td.id,
          task_id: td.id,
          root_cause: "Oversized task scope with broad multi-file edit requirements",
          rootCause: "Oversized task scope with broad multi-file edit requirements",
          impact: "Serial execution bottleneck delaying wave completion",
          evidence: { taskId: td.id, durationMs: td.durationMs, avgDurationMs: avgDuration },
        });
      }
    }
  }

  // Synthesize remediation proposals
  const proposals = synthesizeRemediationPlan(incidents);

  // Compute token waste estimate
  const totalTokenWasteEstimate = Math.max(
    0,
    (fileReadCount > 5 ? (fileReadCount - 5) * 2000 : 0) +
      pollingCallsCount * 800 +
      boundaryDeviationsCount * 2500 +
      contextOverflowCount * 20000,
  );

  // Compute metrics
  const partialMetrics: ForensicsMetrics = {
    totalAgents: agentLedger.length,
    totalTasks: Object.keys(stateTasks).length,
    totalEvents: events.length,
    totalTokensIn,
    totalTokensOut,
    totalToolCalls: allToolCalls.length,
    fileReadCount,
    fileWriteCount,
    readToWriteRatio,
    pollingCallsCount,
    sequentialWaveBottlenecks,
    boundaryDeviationsCount,
    stragglerTasksCount,
    ghostLeasesCount,
    contextOverflowCount,
    efficiencyScore: 0,
    total_events_analyzed: events.length,
    total_tool_calls: allToolCalls.length,
    exploration_reads_count: fileReadCount,
    polling_calls_count: pollingCallsCount,
    concurrency_bottlenecks_detected: sequentialWaveBottlenecks,
    role_boundary_deviations: boundaryDeviationsCount,
    total_token_waste_estimate: totalTokenWasteEstimate,
    incidentCountsByCategory: categoryCounts,
    incidentCountsBySeverity: severityCounts,
  };

  const efficiencyScore = calculateEfficiencyScore(partialMetrics, incidents);
  const finalMetrics: ForensicsMetrics = {
    ...partialMetrics,
    efficiencyScore,
    efficiency_score: efficiencyScore,
  };

  const isClean =
    incidents.length === 0 || (severityCounts.CRITICAL === 0 && severityCounts.HIGH === 0);

  const summaryText = isClean
    ? `Run \`${runId}\` achieved high behavioral efficiency (Score: ${efficiencyScore.toFixed(1)}/100) with 0 critical/high deviations.`
    : `Run \`${runId}\` exhibited ${incidents.length} behavioral forensics incidents (Efficiency Score: ${efficiencyScore.toFixed(1)}/100). Synthesized ${proposals.length} remediation proposals.`;

  const summaryObj: ForensicsSummary = {
    clean: isClean,
    total_incidents: incidents.length,
    critical_count: severityCounts.CRITICAL,
    high_count: severityCounts.HIGH,
    medium_count: severityCounts.MEDIUM,
    low_count: severityCounts.LOW,
    text: summaryText,
    toString(): string {
      return summaryText;
    },
  };

  return {
    runId,
    capsuleRoot: runRootPath,
    run_root: runRootPath,
    analyzedAt,
    analyzed_at: analyzedAt,
    ...(options.agent ? { agent_filter: options.agent } : {}),
    isClean,
    efficiencyScore,
    metrics: finalMetrics,
    incidents,
    proposals,
    summary: summaryObj,
  };
}