import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../core/errors/index.ts";
import type { JsonObject } from "../core/contracts/index.ts";
import { isJsonObject } from "../core/contracts/index.ts";
import { isInteger, isNonblank, isRecord } from "../requirements/predicates.ts";
import {
  compileRequirementsFromPrompt,
  type CompiledRequirementsResult,
  type TaskDeclaration,
} from "../requirements/compiler.ts";
import { compileGraphDocument, type CompiledGraphResult } from "./compiler.ts";
import {
  auditPlan,
  blockingFindings,
  advisoryFindings,
  type AuditFinding,
  type AuditTaskInput,
  type PlanAuditResult,
} from "./plan-audit.ts";
import {
  decoupleDisjointTasks,
  type DecoupledGraphResult,
  type ParallelLaneAssignment,
  type ParallelMetrics,
} from "./parallel-decoupler.ts";
import {
  detectTransitiveBypasses,
  expandDynamicPlan,
  type BypassViolation,
  type CognitiveGuidance,
  type DeeperExpansionRequest,
  type DynamicExpansionOptions,
  type DynamicExpansionPlan,
  type DynamicExpansionResult,
  type TransitiveBypassCheckResult,
  type WiderExpansionRequest,
} from "./dynamic-expansion.ts";
import { normalizeScopePath, type ConcurrencyWave } from "./scope-analyzer.ts";
import { dependencyData, topologicalOrder, type DependencyMap } from "./topology.ts";
import { jsonCopy } from "./plan-contract.ts";

export {
  expandDynamicPlan,
  type DeeperExpansionRequest,
  type DynamicExpansionOptions,
  type DynamicExpansionPlan,
  type DynamicExpansionResult,
  type WiderExpansionRequest,
};

export interface UnifiedPlanInput {
  readonly tasks: readonly TaskDeclaration[];
  readonly prompt?: string | undefined;
  readonly requirementsDocument?: Record<string, unknown> | undefined;
  readonly completionGate: string | readonly string[];
  readonly repoRoot?: string | undefined;
  readonly runState?: JsonObject | undefined;
  readonly capsuleRoot?: string | undefined;
  readonly revision?: number | undefined;
  readonly acceptAudit?: Readonly<Record<string, string>> | undefined;
  readonly autoDecouple?: boolean | undefined;
  readonly pairValidators?: boolean | undefined;
  readonly maxLanes?: number | undefined;
  readonly strictBypassCheck?: boolean | undefined;
  readonly preserveJustified?: boolean | undefined;
}

export interface ExecutableTopology {
  readonly order: readonly string[];
  readonly waves: readonly ConcurrencyWave[];
  readonly lanes: readonly ParallelLaneAssignment[];
  readonly metrics: ParallelMetrics;
  readonly dependencies: DependencyMap;
}

export interface UnifiedPlanResult {
  readonly graphDocument: Record<string, unknown>;
  readonly requirementsDocument: Record<string, unknown>;
  readonly audit: PlanAuditResult;
  readonly bypassDiagnostic: TransitiveBypassCheckResult;
  readonly decoupled: DecoupledGraphResult | null;
  readonly topology: ExecutableTopology;
  readonly warnings: readonly string[];
  readonly cognitiveGuidance: readonly CognitiveGuidance[];
}

export interface CapsuleContext {
  readonly repoRoot: string;
  readonly prompt: string;
  readonly runState: JsonObject;
  readonly requirementsDocument?: Record<string, unknown> | undefined;
  readonly graphDocument?: Record<string, unknown> | undefined;
}

export function detectCapsuleContext(
  contextOrPath?: string | Record<string, unknown>,
  fallbackRepoRoot = ".",
): CapsuleContext {
  if (typeof contextOrPath === "string" && contextOrPath.trim().length > 0) {
    const root = contextOrPath.trim();
    let prompt = "";
    let runState: JsonObject = {};
    let requirementsDoc: Record<string, unknown> | undefined = undefined;
    let graphDoc: Record<string, unknown> | undefined = undefined;

    const promptPath = join(root, "prompt.md");
    if (existsSync(promptPath)) {
      try {
        prompt = readFileSync(promptPath, "utf8");
      } catch {
        prompt = "";
      }
    }

    const statePath = join(root, "state.json");
    if (existsSync(statePath)) {
      try {
        const parsed = JSON.parse(readFileSync(statePath, "utf8"));
        if (isJsonObject(parsed)) {
          runState = parsed;
          if (isRecord(parsed.requirements)) {
            requirementsDoc = parsed.requirements;
          }
          if (isRecord(parsed.graph)) {
            graphDoc = parsed.graph;
          }
        }
      } catch {
        runState = {};
      }
    }

    const reqPath = join(root, "requirements.json");
    if (!requirementsDoc && existsSync(reqPath)) {
      try {
        const parsed = JSON.parse(readFileSync(reqPath, "utf8"));
        if (isRecord(parsed)) {
          requirementsDoc = parsed;
        }
      } catch {}
    }

    const graphPath = join(root, "graph.json");
    if (!graphDoc && existsSync(graphPath)) {
      try {
        const parsed = JSON.parse(readFileSync(graphPath, "utf8"));
        if (isRecord(parsed)) {
          graphDoc = parsed;
        }
      } catch {}
    }

    return {
      repoRoot: fallbackRepoRoot,
      prompt,
      runState,
      requirementsDocument: requirementsDoc,
      graphDocument: graphDoc,
    };
  }

  if (isRecord(contextOrPath)) {
    const prompt = typeof contextOrPath.prompt === "string" ? contextOrPath.prompt : "";
    const runState: JsonObject = isJsonObject(contextOrPath.state)
      ? contextOrPath.state
      : isJsonObject(contextOrPath.runState)
        ? contextOrPath.runState
        : {};
    const requirementsDoc = isRecord(contextOrPath.requirements)
      ? contextOrPath.requirements
      : isRecord(contextOrPath.requirementsDocument)
        ? contextOrPath.requirementsDocument
        : isRecord(runState.requirements)
          ? runState.requirements
          : undefined;
    const graphDoc = isRecord(contextOrPath.graph)
      ? contextOrPath.graph
      : isRecord(contextOrPath.graphDocument)
        ? contextOrPath.graphDocument
        : isRecord(runState.graph)
          ? runState.graph
          : undefined;

    return {
      repoRoot:
        typeof contextOrPath.repoRoot === "string" ? contextOrPath.repoRoot : fallbackRepoRoot,
      prompt,
      runState,
      requirementsDocument: requirementsDoc,
      graphDocument: graphDoc,
    };
  }

  return {
    repoRoot: fallbackRepoRoot,
    prompt: "",
    runState: {},
  };
}

function parseCompletionGate(completionGate: string | readonly string[]): string[] {
  if (typeof completionGate === "string") {
    return completionGate
      .trim()
      .split(/\s+/u)
      .filter((t) => t.length > 0);
  }
  return completionGate.map((item) => String(item).trim()).filter((item) => item.length > 0);
}

export function compileUnifiedHighLeveragePlan(input: UnifiedPlanInput): UnifiedPlanResult {
  const repoRoot = typeof input.repoRoot === "string" ? input.repoRoot : ".";
  const revision = input.revision ?? 1;
  const maxLanes = input.maxLanes ?? 40;
  const autoDecouple = input.autoDecouple ?? true;
  const strictBypassCheck = input.strictBypassCheck ?? true;
  const preserveJustified = input.preserveJustified ?? true;
  const completionGate = parseCompletionGate(input.completionGate);

  if (completionGate.length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "the mandatory run-completion gate needs a declared command; nothing can stand in for it",
    );
  }

  if (input.tasks.length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "at least one task must be declared in planning input",
    );
  }

  const context = detectCapsuleContext(input.capsuleRoot ?? input.runState, repoRoot);
  const prompt = input.prompt ?? context.prompt;
  const runState: JsonObject = input.runState ? input.runState : context.runState;

  let requirementsDocument: Record<string, unknown>;
  let requirementIdsByTask = new Map<string, string[]>();
  const allWarnings: string[] = [];

  if (input.requirementsDocument) {
    requirementsDocument = jsonCopy(input.requirementsDocument);
    input.tasks.forEach((task) => {
      requirementIdsByTask.set(task.id, [`req-${task.id.replace(/^task-?/, "")}`]);
    });
  } else if (prompt.trim().length > 0) {
    const compiledReqs: CompiledRequirementsResult = compileRequirementsFromPrompt(
      prompt,
      input.tasks,
    );
    requirementsDocument = compiledReqs.requirementsDocument;
    requirementIdsByTask = compiledReqs.requirementIdsByTask;
    allWarnings.push(...compiledReqs.warnings);
  } else {
    const reqs: Record<string, unknown>[] = [];
    input.tasks.forEach((task, idx) => {
      const reqId = `req-${task.id.replace(/^task-?/, "")}`;
      reqs.push({
        id: reqId,
        source_lines: [idx + 1],
        source_excerpt: task.label,
        instruction: task.goal ?? task.label,
        implementation: `Implement requirements for ${task.label}`,
        subsystem: "runtime/planning",
        acceptance: [
          {
            id: `crit-${reqId}-1`,
            criterion: `Task ${task.id} gate passes`,
            evidence: [`Gate execution output for ${task.id}`],
          },
        ],
        candidate_gates: [
          {
            argv: typeof task.gate === "string" ? task.gate.split(/\s+/u) : [...task.gate],
            cwd: ".",
          },
        ],
        priority: task.priority ?? 50,
        risk: "medium",
        ambiguity: [],
        dependencies: (task.deps ?? []).map((d) => `req-${d.replace(/^task-?/, "")}`),
        disposition: "actionable",
        status: "planned",
      });
      requirementIdsByTask.set(task.id, [reqId]);
    });

    requirementsDocument = {
      schema: "harness.requirements",
      version: 1,
      prompt_sha256: "0000000000000000000000000000000000000000000000000000000000000000",
      requirements: reqs,
      dispositions: reqs.map((r, i) => ({
        line: i + 1,
        kind: "requirement",
        requirement_id: r.id,
      })),
    };
  }

  const compiledGraph: CompiledGraphResult = compileGraphDocument(
    input.tasks,
    requirementsDocument,
    requirementIdsByTask,
    revision,
    completionGate,
  );

  let workingGraph = compiledGraph.graphDocument;
  let decoupledResult: DecoupledGraphResult | null = null;

  if (autoDecouple) {
    decoupledResult = decoupleDisjointTasks(workingGraph, { maxLanes, preserveJustified });
    workingGraph = decoupledResult.graph;
    allWarnings.push(...decoupledResult.warnings.map((w) => `[PARALLEL DECOUPLER]: ${w.message}`));
  }

  const auditTasks: AuditTaskInput[] = input.tasks.map((t) => ({
    taskId: t.id,
    writeScope: t.writeScope,
    deps: t.deps ?? [],
    gate: typeof t.gate === "string" ? t.gate : t.gate.join(" "),
    effort: t.effort,
  }));

  const auditResult = auditPlan(repoRoot, auditTasks, runState, prompt);
  const blocking = blockingFindings(auditResult);

  if (blocking.length > 0) {
    const acceptAudit = input.acceptAudit ?? {};
    const unaccepted: AuditFinding[] = [];

    for (const finding of blocking) {
      const overrideReason = acceptAudit[finding.invariant];
      if (typeof overrideReason === "string" && overrideReason.trim().length > 0) {
        allWarnings.push(
          `[AUDIT OVERRIDE ACCEPTED]: Invariant ${finding.invariant} accepted with rationale: "${overrideReason.trim()}"`,
        );
      } else {
        unaccepted.push(finding);
      }
    }

    if (unaccepted.length > 0) {
      const messages = unaccepted.map((u) => `[${u.invariant}]: ${u.message}`).join("; ");
      throw new HarnessError(
        "INTEGRITY",
        `Plan audit blocked compilation with ${unaccepted.length} finding(s): ${messages}. Use acceptAudit: { '<invariant>': '<reason>' } to override if justified.`,
      );
    }
  }

  const nodes = Array.isArray(workingGraph.nodes)
    ? (workingGraph.nodes as Record<string, unknown>[])
    : [];
  const edges = Array.isArray(workingGraph.edges)
    ? (workingGraph.edges as Record<string, unknown>[])
    : [];

  const bypassCheck = detectTransitiveBypasses(nodes, edges);
  allWarnings.push(...bypassCheck.warnings);

  if (strictBypassCheck && bypassCheck.hasBypass) {
    const firstBypass = bypassCheck.violations[0]!;
    throw new HarnessError(
      "INTEGRITY",
      `Plan failed transitive bypass validation: ${firstBypass.reason}. ` +
        `Cognitive Guidance: ${firstBypass.guidance.summary} Remediation: ${firstBypass.guidance.remediationAction}`,
    );
  }

  const { dependencies } = dependencyData(nodes, edges);
  const order = topologicalOrder(dependencies);

  const waves = decoupledResult?.waves ?? [];
  const lanes = decoupledResult?.lanes ?? [];
  const metrics = decoupledResult?.metrics ?? {
    totalWork: input.tasks.reduce((acc, t) => acc + (t.effort ?? 1), 0),
    criticalSpan: 1,
    parallelismFactor: 1,
    optimalLanes: 1,
    maxSupportedLanes: maxLanes,
    efficiency: 1,
  };

  const topology: ExecutableTopology = {
    order,
    waves,
    lanes,
    metrics,
    dependencies,
  };

  return {
    graphDocument: workingGraph,
    requirementsDocument,
    audit: auditResult,
    bypassDiagnostic: bypassCheck,
    decoupled: decoupledResult,
    topology,
    warnings: allWarnings,
    cognitiveGuidance: bypassCheck.violations.map((v) => v.guidance),
  };
}

export function expandDynamicPlanUnified(
  currentGraph: Record<string, unknown>,
  expansion: DynamicExpansionPlan | DeeperExpansionRequest | WiderExpansionRequest,
  requirementsDocument?: Record<string, unknown>,
  options: DynamicExpansionOptions & {
    readonly repoRoot?: string;
    readonly prompt?: string;
    readonly runState?: JsonObject;
  } = {},
): UnifiedPlanResult {
  const dynamicResult = expandDynamicPlan(currentGraph, expansion, requirementsDocument, options);
  const graphDoc = dynamicResult.graphDocument;
  const repoRoot = typeof options.repoRoot === "string" ? options.repoRoot : ".";
  const prompt = typeof options.prompt === "string" ? options.prompt : "";
  const runState: JsonObject = options.runState ? options.runState : {};
  const maxLanes = options.maxLanes ?? 40;

  const nodes = Array.isArray(graphDoc.nodes) ? (graphDoc.nodes as Record<string, unknown>[]) : [];
  const edges = Array.isArray(graphDoc.edges) ? (graphDoc.edges as Record<string, unknown>[]) : [];

  const taskNodes = nodes.filter((n) => isRecord(n) && n.type === "task");
  const auditTasks: AuditTaskInput[] = taskNodes.map((n) => {
    const id = String(n.id);
    const writeScope = Array.isArray(n.write_scope) ? (n.write_scope as string[]) : [];
    const deps = edges
      .filter(
        (e) =>
          isRecord(e) && e.type === "depends_on" && e.source === id && typeof e.target === "string",
      )
      .map((e) => String(e.target));
    const effort = typeof n.effort === "number" ? n.effort : 1;
    const taskGate = Array.isArray(graphDoc.gates)
      ? (graphDoc.gates as Record<string, unknown>[]).find(
          (g) => isRecord(g) && g.scope === "task" && g.id === `gate-${id.replace(/^task-?/, "")}`,
        )
      : undefined;
    const gateStr =
      taskGate && Array.isArray(taskGate.command)
        ? (taskGate.command as string[]).join(" ")
        : typeof taskGate?.command === "string"
          ? taskGate.command
          : "bun test tests/unit";
    return {
      taskId: id,
      writeScope,
      deps,
      gate: gateStr,
      effort,
    };
  });

  const audit = auditPlan(repoRoot, auditTasks, runState, prompt);
  const bypassDiagnostic = detectTransitiveBypasses(nodes, edges);
  const decoupledResult = decoupleDisjointTasks(graphDoc, { maxLanes });
  const { dependencies } = dependencyData(nodes, edges);
  const order = topologicalOrder(dependencies);

  const topology: ExecutableTopology = {
    order,
    waves: decoupledResult.waves,
    lanes: decoupledResult.lanes,
    metrics: decoupledResult.metrics,
    dependencies,
  };

  const reqDoc = requirementsDocument ?? {
    schema: "harness.requirements",
    version: 1,
    requirements: [],
    dispositions: [],
  };

  return {
    graphDocument: decoupledResult.graph,
    requirementsDocument: reqDoc,
    audit,
    bypassDiagnostic,
    decoupled: decoupledResult,
    topology,
    warnings: [...dynamicResult.warnings, ...bypassDiagnostic.warnings],
    cognitiveGuidance: dynamicResult.cognitiveGuidance,
  };
}
