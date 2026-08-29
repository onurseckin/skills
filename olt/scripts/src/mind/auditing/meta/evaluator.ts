import { runForensicsHeuristics } from "./heuristics.ts";
import { HarnessError } from "../../../core/errors/index.ts";
import { basename, join, resolve } from "node:path";
import {
  parseEventsFile,
  type AnalyzeRunForensicsOptions,
  type ForensicsAnalysisResult,
  type ForensicsIncident,
  type AgentGrantRecord,
  type ForensicsSummary,
  type ForensicsMetrics,
  type RootCauseCategory,
  type ForensicsSeverity,
} from "./types.ts";
import {
  parseStateFile,
  parseManifestFile,
  extractToolCallsFromTranscripts,
  extractToolCallsFromEvents,
  calculateEfficiencyScore,
} from "./timeline.ts";
import { synthesizeRemediationPlan } from "./forensics.ts";

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

  const stateManifest = (state as unknown as Record<string, unknown> | null)?.["manifest"] as
    | Record<string, unknown>
    | undefined;
  const stateRecord = state as unknown as Record<string, unknown> | null;
  const runId =
    options.runId ??
    manifest?.run_id ??
    (typeof stateManifest?.["run_id"] === "string" ? stateManifest["run_id"] : undefined) ??
    (typeof stateRecord?.["run_id"] === "string" ? stateRecord["run_id"] : undefined) ??
    basename(runRootPath);
  const analyzedAt = new Date().toISOString();

  let agentLedger: readonly AgentGrantRecord[] = [];
  if (options.agentLedger && options.agentLedger.length > 0) {
    agentLedger = options.agentLedger;
  } else if (state && Array.isArray(state["agents"])) {
    agentLedger = state["agents"] as unknown as AgentGrantRecord[];
  }

  if (options.agent) {
    agentLedger = agentLedger.filter(
      (a) =>
        ((a as unknown as Record<string, unknown>).id ??
          (a as unknown as Record<string, unknown>).agent_id ??
          (a as unknown as Record<string, unknown>).name) === options.agent,
    );
  }

  const transcriptCalls =
    options.transcripts && options.transcripts.length > 0
      ? extractToolCallsFromTranscripts(options.transcripts)
      : [];
  const eventCalls = extractToolCallsFromEvents(events);
  let allToolCalls = [...eventCalls, ...transcriptCalls];

  if (options.agent) {
    allToolCalls = allToolCalls.filter(
      (c) => c.agentId === options.agent || c.agentRole === options.agent,
    );
  }

  const rawIncidents: ForensicsIncident[] = [];
  const addIncident = (inc: ForensicsIncident) => rawIncidents.push(inc);

  const { sequentialWaveBottlenecks } = runForensicsHeuristics({
    allToolCalls,
    events,
    state,
    agentLedger,
    agentId: options.agent,
    addIncident,
  });

  const seenIncidents = new Set<string>();
  const incidents: ForensicsIncident[] = [];
  for (const inc of rawIncidents) {
    const key = `${inc.category}:${inc.title}`;
    if (!seenIncidents.has(key)) {
      seenIncidents.add(key);
      incidents.push(inc);
    }
  }

  const SEVERITY_PRECEDENCE: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  incidents.sort(
    (a, b) => (SEVERITY_PRECEDENCE[a.severity] ?? 99) - (SEVERITY_PRECEDENCE[b.severity] ?? 99),
  );

  let toolCallsBeforeFirstWrite = 0;
  let firstWriteFound = false;
  let readToolCallsCount = 0;
  let writeToolCallsCount = 0;
  let pollingCallsCount = 0;

  for (const call of allToolCalls) {
    if (call.isRead) readToolCallsCount++;
    if (call.isWrite) {
      writeToolCallsCount++;
      firstWriteFound = true;
    }
    if (call.isPoll) pollingCallsCount++;
    if (!firstWriteFound && call.isRead) toolCallsBeforeFirstWrite++;
  }

  const efficiencyScore = calculateEfficiencyScore({
    incidents,
    totalToolCalls: allToolCalls.length,
    readToolCalls: readToolCallsCount,
    writeToolCalls: writeToolCallsCount,
    pollingToolCalls: pollingCallsCount,
    toolCallsBeforeFirstWrite,
  });

  const critical_count = incidents.filter((i) => i.severity === "CRITICAL").length;
  const high_count = incidents.filter((i) => i.severity === "HIGH").length;
  const medium_count = incidents.filter((i) => i.severity === "MEDIUM").length;
  const low_count = incidents.filter((i) => i.severity === "LOW").length;
  const isClean = incidents.length === 0;

  const summaryText = isClean
    ? `Run \`${runId}\` achieved high behavioral efficiency`
    : `Run \`${runId}\` exhibited ${incidents.length} behavioral deviation(s)`;

  const summary: ForensicsSummary = {
    clean: isClean,
    total_incidents: incidents.length,
    critical_count,
    high_count,
    medium_count,
    low_count,
    text: summaryText,
    toString(): string {
      return this.text;
    },
  };

  const incidentCountsByCategory: Record<RootCauseCategory, number> = {
    TOKEN_BURNING: incidents.filter((i) => i.category === "TOKEN_BURNING").length,
    FALSE_SERIALIZATION: incidents.filter((i) => i.category === "FALSE_SERIALIZATION").length,
    ROLE_BOUNDARY_DEVIATION: incidents.filter((i) => i.category === "ROLE_BOUNDARY_DEVIATION")
      .length,
    POLLING_WASTE: incidents.filter((i) => i.category === "POLLING_WASTE").length,
    CONTEXT_OVERFLOW: incidents.filter((i) => i.category === "CONTEXT_OVERFLOW").length,
    GHOST_LEASE: incidents.filter((i) => i.category === "GHOST_LEASE").length,
    STRAGGLER: incidents.filter((i) => i.category === "STRAGGLER").length,
  };

  const incidentCountsBySeverity: Record<ForensicsSeverity, number> = {
    CRITICAL: critical_count,
    HIGH: high_count,
    MEDIUM: medium_count,
    LOW: low_count,
  };

  const metrics: ForensicsMetrics = {
    total_events_analyzed: events.length,
    total_tool_calls: allToolCalls.length,
    exploration_reads_count: readToolCallsCount,
    polling_calls_count: pollingCallsCount,
    concurrency_bottlenecks_detected: sequentialWaveBottlenecks,
    role_boundary_deviations: incidentCountsByCategory.ROLE_BOUNDARY_DEVIATION,
    totalAgents: agentLedger.length,
    totalTasks:
      state && typeof state["tasks"] === "object" && state["tasks"] !== null
        ? Object.keys(state["tasks"]).length
        : 0,
    totalEvents: events.length,
    totalTokensIn: 0,
    totalTokensOut: 0,
    totalToolCalls: allToolCalls.length,
    fileReadCount: readToolCallsCount,
    fileWriteCount: writeToolCallsCount,
    readToWriteRatio:
      writeToolCallsCount > 0 ? readToolCallsCount / writeToolCallsCount : readToolCallsCount,
    pollingCallsCount,
    sequentialWaveBottlenecks,
    boundaryDeviationsCount: incidentCountsByCategory.ROLE_BOUNDARY_DEVIATION,
    stragglerTasksCount: incidentCountsByCategory.STRAGGLER,
    ghostLeasesCount: incidentCountsByCategory.GHOST_LEASE,
    contextOverflowCount: incidentCountsByCategory.CONTEXT_OVERFLOW,
    efficiencyScore,
    incidentCountsByCategory,
    incidentCountsBySeverity,
  };

  const proposals = synthesizeRemediationPlan(incidents);

  return {
    runId,
    capsuleRoot: runRootPath,
    run_root: runRootPath,
    analyzedAt,
    analyzed_at: analyzedAt,
    agent_filter: options.agent,
    isClean,
    efficiencyScore,
    summary,
    metrics,
    incidents,
    proposals,
  };
}
