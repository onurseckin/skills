import { basename, dirname } from "node:path";
import { getHarnessConfig } from "../../config/harness-config.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { isRecord } from "../../requirements/predicates.ts";
import type { TaskDeclaration } from "../../requirements/compiler.ts";
import { enforceLineLimit } from "../formatters/line-limiter.ts";
import { boolFlag, integerFlag, textFlag, type CommandContext, type Flags } from "../options.ts";
import { parseArguments } from "../arguments.ts";
import { loadRun } from "../../store/index.ts";
import { resolveCapsuleRun } from "./dag-view.ts";
import { schedulingMetrics } from "../../scheduler/metrics.ts";
import {
  buildSugiyamaDagReport,
  type SugiyamaDagReport,
  type SugiyamaNode,
  type SugiyamaEdge,
} from "../../reporting/sugiyama-dag.ts";
import { buildLivingTracerReport, type LivingTracerReport } from "../../reporting/living-tracer.ts";
import { readCapsuleEvents } from "../../reporting/event-stream.ts";

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function dagRenderCommand(
  flags: Flags,
  _context: CommandContext = {},
): Record<string, unknown> {
  const repo = textFlag(flags, "repo", false) ?? process.cwd();
  const runFlag = textFlag(flags, "run", false);
  const runIdFlag = textFlag(flags, "run-id", false);
  const detailed = boolFlag(flags, "detailed");
  const showAll = boolFlag(flags, "all");
  const style = textFlag(flags, "box-style", false) ?? "rounded";
  const boxStyle = style === "sharp" ? "sharp" : style === "ascii" ? "ascii" : "rounded";

  const run = resolveCapsuleRun(repo, runFlag, runIdFlag);
  const loaded = loadRun(run);
  const state = loaded.state;
  const runId = basename(run);

  const runRoot = loaded?.runRoot ?? run;
  const harnessConfig = getHarnessConfig(dirname(dirname(runRoot)), runRoot);
  const maxParallel = harnessConfig.default_max_parallel;

  const isCompiled = state.graph !== undefined && state.graph !== null;
  const graphRevision =
    isRecord(state.graph) && typeof state.graph.revision === "number" ? state.graph.revision : null;

  const taskMap = (isRecord(state.tasks) ? state.tasks : {}) as Record<
    string,
    Record<string, unknown>
  >;
  const planningBuffer = Array.isArray(state.planning_buffer)
    ? (state.planning_buffer as unknown as readonly TaskDeclaration[])
    : [];

  const rawAgents = (Array.isArray(state.agents) ? state.agents : []) as Record<string, unknown>[];

  let depMap: Map<string, Set<string>>;
  if (isCompiled) {
    depMap = new Map();
    for (const [id, t] of Object.entries(taskMap)) {
      const deps = isStringArray(t.dependencies) ? t.dependencies : [];
      depMap.set(id, new Set(deps));
    }
  } else {
    depMap = new Map();
    for (const item of planningBuffer) {
      depMap.set(item.id, new Set(Array.isArray(item.deps) ? item.deps : []));
    }
  }

  let criticalDepthMap = new Map<string, number>();
  let descendantsMap = new Map<string, number>();
  try {
    const metrics = schedulingMetrics(depMap);
    criticalDepthMap = metrics.criticalDepth;
    descendantsMap = metrics.descendants;
  } catch {
    for (const k of depMap.keys()) {
      criticalDepthMap.set(k, 0);
      descendantsMap.set(k, 0);
    }
  }

  const sugiyamaNodes: SugiyamaNode[] = [];
  const sugiyamaEdges: SugiyamaEdge[] = [];

  if (isCompiled) {
    for (const [id, t] of Object.entries(taskMap)) {
      const status = typeof t.status === "string" ? t.status : "proposed";
      const label = typeof t.label === "string" ? t.label : id;
      const priority = typeof t.priority === "number" ? t.priority : 50;
      const writeScope = isStringArray(t.write_scope) ? t.write_scope : [];
      const resourceScope = isStringArray(t.resource_scope) ? t.resource_scope : [];
      const gate = typeof t.gate === "string" ? t.gate : undefined;
      const deps = isStringArray(t.dependencies) ? t.dependencies : [];
      const lease = isRecord(t.lease) ? t.lease : null;
      let assignedAgent =
        lease && typeof lease.agent_id === "string" && lease.agent_id.trim().length > 0
          ? lease.agent_id.trim()
          : lease && typeof lease.agent === "string" && lease.agent.trim().length > 0
            ? lease.agent.trim()
            : null;
      let assignedRole =
        typeof lease?.role === "string" && lease.role.length > 0
          ? (lease.role as string)
          : undefined;
      let assignedTool: string | undefined;
      let attempt = lease && typeof lease.attempt === "number" ? lease.attempt : null;
      const effort = typeof t.effort === "number" ? t.effort : 1;

      // Check validations if validating
      if (!assignedAgent && Array.isArray(t.validations)) {
        for (const val of t.validations) {
          if (isRecord(val) && typeof val.validator_id === "string" && val.verdict === undefined) {
            assignedAgent = val.validator_id;
            assignedRole = "validator";
            assignedTool = "run_command/verify";
            if (typeof val.attempt === "number") attempt = val.attempt;
            break;
          }
        }
      }

      const matchingAgent = rawAgents.find((a) => a.id === assignedAgent);
      if (matchingAgent) {
        if (!assignedRole && typeof matchingAgent.role === "string") {
          assignedRole = matchingAgent.role;
        }
        if (!assignedTool) {
          assignedTool =
            typeof matchingAgent.tool === "string"
              ? matchingAgent.tool
              : typeof matchingAgent.current_tool === "string"
                ? matchingAgent.current_tool
                : undefined;
        }
      }
      if (!assignedRole && assignedAgent) {
        assignedRole = status === "validating" ? "validator" : "implementer";
      }

      const depReasons = isRecord(t.dep_reasons)
        ? (t.dep_reasons as Readonly<Record<string, string>>)
        : isRecord(t.depReasons)
          ? (t.depReasons as Readonly<Record<string, string>>)
          : undefined;

      sugiyamaNodes.push({
        id,
        label,
        status,
        priority,
        writeScope,
        resourceScope,
        gate,
        dependencies: deps,
        assignedAgent,
        assignedRole,
        assignedTool,
        attempt,
        effort,
        criticalDepth: criticalDepthMap.get(id) ?? 0,
        descendantCount: descendantsMap.get(id) ?? 0,
        depReasons,
      });

      for (const depId of deps) {
        sugiyamaEdges.push({
          from: depId,
          to: id,
          reason: depReasons?.[depId],
          type: depReasons?.[depId] ? "explicit_justification" : "declared_dep",
        });
      }
    }
  } else {
    for (const item of planningBuffer) {
      const gateStr =
        typeof item.gate === "string"
          ? item.gate
          : Array.isArray(item.gate)
            ? item.gate.join(" ")
            : undefined;
      const deps = Array.isArray(item.deps) ? item.deps : [];

      sugiyamaNodes.push({
        id: item.id,
        label: item.label,
        status: "draft",
        priority: typeof item.priority === "number" ? item.priority : 50,
        writeScope: item.writeScope,
        resourceScope: [],
        gate: gateStr,
        dependencies: deps,
        assignedAgent: null,
        effort: typeof item.effort === "number" ? item.effort : 1,
        criticalDepth: criticalDepthMap.get(item.id) ?? 0,
        descendantCount: descendantsMap.get(item.id) ?? 0,
        depReasons: item.depReasons,
      });

      for (const depId of deps) {
        sugiyamaEdges.push({
          from: depId,
          to: item.id,
          reason: item.depReasons?.[depId],
          type: item.depReasons?.[depId] ? "explicit_justification" : "declared_dep",
        });
      }
    }
  }

  const report = buildSugiyamaDagReport(sugiyamaNodes, sugiyamaEdges, {
    runRoot: run,
    runId,
    isCompiled,
    graphRevision,
    maxParallel,
    detailed,
    boxStyle,
  });

  const finalMarkdown = showAll ? report.markdown : enforceLineLimit(report.markdown, 80);

  return {
    ...report,
    markdown: finalMarkdown,
  } as unknown as Record<string, unknown>;
}

export function executeDagRenderCommand(
  argvOrFlags: readonly string[] | Flags,
  context: CommandContext = {},
): SugiyamaDagReport {
  if (isStringArray(argvOrFlags)) {
    const tokens =
      argvOrFlags.length > 0 && !argvOrFlags[0]?.startsWith("-")
        ? argvOrFlags
        : ["dag:render", ...argvOrFlags];
    const parsed = parseArguments(tokens);
    return dagRenderCommand(parsed.flags, context) as unknown as SugiyamaDagReport;
  }
  return dagRenderCommand(argvOrFlags, context) as unknown as SugiyamaDagReport;
}

export function dagTraceCommand(
  flags: Flags,
  _context: CommandContext = {},
): Record<string, unknown> {
  const repo = textFlag(flags, "repo", false) ?? process.cwd();
  const runFlag = textFlag(flags, "run", false);
  const runIdFlag = textFlag(flags, "run-id", false);
  const fromSeq = integerFlag(flags, "from-seq");
  const toSeq = integerFlag(flags, "to-seq");
  const maxSteps = integerFlag(flags, "max-steps") ?? 50;
  const filterTask = textFlag(flags, "task", false);
  const filterActor = textFlag(flags, "actor", false);
  const filterKind = textFlag(flags, "filter-type", false) ?? textFlag(flags, "filter-kind", false);
  const detailed = boolFlag(flags, "detailed");
  const showAll = boolFlag(flags, "all");

  const run = resolveCapsuleRun(repo, runFlag, runIdFlag);
  const eventsResult = readCapsuleEvents(run, { all: true });

  const report = buildLivingTracerReport(eventsResult.matchingEvents, {
    runId: eventsResult.runId,
    runRoot: eventsResult.runRoot,
    fromSeq,
    toSeq,
    maxSteps: showAll ? undefined : maxSteps,
    filterTask,
    filterActor,
    filterKind,
    detailed,
    all: showAll,
  });

  const finalMarkdown = showAll ? report.markdown : enforceLineLimit(report.markdown, 80);

  return {
    ...report,
    markdown: finalMarkdown,
  } as unknown as Record<string, unknown>;
}

export function executeDagTraceCommand(
  argvOrFlags: readonly string[] | Flags,
  context: CommandContext = {},
): LivingTracerReport {
  if (isStringArray(argvOrFlags)) {
    const tokens =
      argvOrFlags.length > 0 && !argvOrFlags[0]?.startsWith("-")
        ? argvOrFlags
        : ["dag:trace", ...argvOrFlags];
    const parsed = parseArguments(tokens);
    return dagTraceCommand(parsed.flags, context) as unknown as LivingTracerReport;
  }
  return dagTraceCommand(argvOrFlags, context) as unknown as LivingTracerReport;
}
