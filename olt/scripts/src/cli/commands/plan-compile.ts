import { basename, resolve, join } from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { getHarnessConfig } from "../../core/config/index.ts";
import type { RunFiles } from "../../core/contracts/index.ts";
import type { JsonValue } from "../../core/contracts/index.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { compileGraphDocument, compilePlanMarkdown } from "../../graph/compiler.ts";
import { executeDagViewCommand } from "./dag-view.ts";
import { advisoryFindings, blockingFindings } from "../../graph/plan-audit.ts";
import { projectPlan } from "../../graph/project-plan.ts";
import { guardPlanRevision } from "../../graph/revision-guard.ts";
import { analyzeScopeIndependence } from "../../graph/scope-analyzer.ts";
import {
  analyzeTopologyDeclaration,
  assertTopologyJustified,
} from "../../graph/topology-declaration.ts";
import { dependencyData } from "../../graph/topology.ts";
import {
  compileRequirementsFromPrompt,
  type TaskDeclaration,
} from "../../requirements/compiler.ts";
import { recordTopology } from "../../engine/scheduler/index.ts";
import { loadRun } from "../../engine/store/index.ts";
import { transact } from "../../engine/store/index.ts";
import { formatPlanCompileBrief } from "../formatters/index.ts";
import { actorFlag, listFlag, textFlag, type Flags } from "../options.ts";
import { parseAuditAcceptance, recordAuditAcceptance, recordPlanAudit } from "./plan-audit.ts";
import { parseGateArgv } from "./plan-replan-bindings.ts";
import type { AssignableTask } from "../../workflow/worktree/assign.ts";
import { provisionWorktrees } from "../../workflow/worktree/provision.ts";
import { probeLiveQuotaTelemetry } from "../../workflow/lifecycle/quota-lifecycle.ts";

function promptText(prompt: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(prompt);
}

function hasBrainstormingExecuted(loaded: RunFiles, runRoot: string): boolean {
  if (Array.isArray(loaded.events)) {
    for (const evt of loaded.events) {
      if (
        evt &&
        typeof evt === "object" &&
        (("kind" in evt && evt.kind === "plan-brainstormed") ||
          ("type" in evt && (evt as Record<string, unknown>).type === "plan-brainstormed") ||
          ("event" in evt && (evt as Record<string, unknown>).event === "plan-brainstormed"))
      ) {
        return true;
      }
    }
  }

  const state = loaded.state as Record<string, unknown>;
  if (state && typeof state === "object") {
    if (
      "brainstorming" in state &&
      state.brainstorming !== null &&
      state.brainstorming !== undefined
    ) {
      return true;
    }
    if (typeof state.planning === "object" && state.planning !== null) {
      const planning = state.planning as Record<string, unknown>;
      if (
        "brainstorming" in planning &&
        planning.brainstorming !== null &&
        planning.brainstorming !== undefined
      ) {
        return true;
      }
    }
    if (Array.isArray(state.events)) {
      for (const evt of state.events) {
        if (
          evt &&
          typeof evt === "object" &&
          (("kind" in evt && (evt as Record<string, unknown>).kind === "plan-brainstormed") ||
            ("type" in evt && (evt as Record<string, unknown>).type === "plan-brainstormed") ||
            ("event" in evt && (evt as Record<string, unknown>).event === "plan-brainstormed"))
        ) {
          return true;
        }
      }
    }
  }

  const candidateRoots = [runRoot, loaded.runRoot];
  for (const root of candidateRoots) {
    if (root) {
      if (existsSync(join(root, "brainstorming.json"))) {
        return true;
      }
      if (existsSync(join(root, ".olt", "brainstorming.json"))) {
        return true;
      }
    }
  }

  return false;
}

export async function planCompileCommand(flags: Flags): Promise<Record<string, unknown>> {
  const run = textFlag(flags, "run")!;
  const actor = actorFlag(flags);
  const completionGate = parseGateArgv(textFlag(flags, "completion-gate")!);
  if (completionGate === undefined)
    throw new HarnessError("INVALID_ARGUMENT", "--completion-gate must name a command");
  const loaded = loadRun(run);

  if (!hasBrainstormingExecuted(loaded, run)) {
    throw new HarnessError(
      "INVALID_STATE",
      "[MANDATORY_PLAN_STEP_SKIPPED] Cannot compile plan: plan:brainstorm must be executed first.",
    );
  }

  const prompt = promptText(loaded.prompt);
  const rawBuffer = Array.isArray(loaded.state.planning_buffer) ? loaded.state.planning_buffer : [];
  const buffer = rawBuffer as unknown as TaskDeclaration[];

  const scopeAnalysis = analyzeScopeIndependence(
    buffer.map((t) => ({ taskId: t.id, writeScope: t.writeScope, dependencies: t.deps })),
  );
  if (scopeAnalysis.collisions.length > 0) {
    const c = scopeAnalysis.collisions[0]!;
    throw new HarnessError(
      "INTEGRITY",
      `Scope collision detected between ${c.taskA} and ${c.taskB} on path '${c.conflictingPath}'.`,
    );
  }

  const acceptances = (listFlag(flags, "accept-audit") ?? []).map(parseAuditAcceptance);
  const { result: auditResult } = recordPlanAudit(run, actor, buffer, loaded.state, prompt);
  const blocking = blockingFindings(auditResult);
  const blockingInvariants = new Set(blocking.map((f) => f.invariant));
  for (const acceptance of acceptances) {
    if (!blockingInvariants.has(acceptance.invariant)) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `--accept-audit names ${acceptance.invariant}, which the audit did not raise as blocking; nothing to accept`,
      );
    }
  }
  const acceptedInvariants = new Set(acceptances.map((a) => a.invariant));
  const uncovered = blocking.filter((f) => !acceptedInvariants.has(f.invariant));
  if (uncovered.length > 0) {
    const byInvariant = new Map<string, string[]>();
    for (const f of uncovered)
      byInvariant.set(f.invariant, [...(byInvariant.get(f.invariant) ?? []), f.message]);
    const detail = [...byInvariant.entries()]
      .map(([id, msgs]) => `${id}: ${msgs.join(" | ")}`)
      .join("; ");
    throw new HarnessError(
      "INTEGRITY",
      `plan:audit blocks compilation — ${detail}. Fix the plan, or pass --accept-audit <id>:<reason> ` +
        `naming exactly which invariant you are overriding and why.`,
    );
  }
  for (const acceptance of acceptances) recordAuditAcceptance(run, actor, acceptance);
  const advisories = advisoryFindings(auditResult).map((f) => f.message);

  const topologyDeclaration = analyzeTopologyDeclaration(buffer);
  assertTopologyJustified(topologyDeclaration);

  const { requirementsDocument, requirementIdsByTask, warnings } = compileRequirementsFromPrompt(
    prompt,
    buffer,
  );
  const currentGraph = loaded.state.graph as Record<string, unknown> | undefined;
  const nextRevision = typeof currentGraph?.revision === "number" ? currentGraph.revision + 1 : 1;
  const { graphDocument } = compileGraphDocument(
    buffer,
    requirementsDocument,
    requirementIdsByTask,
    nextRevision,
    completionGate,
  );
  const { dependencies } = dependencyData(
    graphDocument.nodes as Record<string, unknown>[],
    graphDocument.edges as Record<string, unknown>[],
  );

  transact(run, actor, "plan-compiled", { tasks_count: buffer.length }, (state) => {
    if (!Array.isArray(state.plan_history)) {
      state.plan_history = [];
    }
    guardPlanRevision(
      state as unknown as Record<string, unknown>,
      requirementsDocument,
      graphDocument,
      dependencies,
    );
    projectPlan(
      state as unknown as Record<string, unknown>,
      requirementsDocument,
      graphDocument,
      dependencies,
    );
    state.planning_tasks = buffer as unknown as JsonValue;
  });

  const repoRoot = resolve(run, "..", "..");
  const config = getHarnessConfig(repoRoot, run);
  const { topology } = recordTopology(run, actor, config);

  const tasksById = new Map<string, AssignableTask>(
    buffer.map((task) => [task.id, { write_scope: task.writeScope }]),
  );
  const provisioned = provisionWorktrees({
    runRoot: run,
    repoRoot,
    runId: basename(run),
    actor,
    topology,
    tasksById,
    config,
  });

  const quotaTelemetry = await probeLiveQuotaTelemetry();

  let markdown = formatPlanCompileBrief({
    revision: 1,
    totalTasks: buffer.length,
    topology: {
      revision: topology.revision,
      maxParallel: topology.max_parallel,
      waves: topology.waves.map((wave) => ({ wave: wave.wave, taskIds: wave.task_ids })),
    },
    topologyDeclaration: {
      independentRoots: topologyDeclaration.independentRoots.length,
      edgeCount: topologyDeclaration.edges.length,
    },
    collisions: scopeAnalysis.collisions.length,
    requirementsCount: requirementIdsByTask.size,
    runId: basename(run),
    advisories,
    warnings,
    auditAccepted: acceptances,
    auditNotEvaluated: auditResult.not_evaluated.map((n) => n.reason),
  });

  if (quotaTelemetry.quotaBadge) {
    markdown += `\n- **Quota Telemetry**: ${quotaTelemetry.quotaBadge} (${quotaTelemetry.activeHost})`;
  }

  const planningDir = join(run, "planning");
  mkdirSync(planningDir, { recursive: true });

  const planMd = compilePlanMarkdown(buffer, requirementsDocument);
  writeFileSync(join(planningDir, "plan.md"), planMd, "utf-8");

  const dagReport = executeDagViewCommand(["--run", run]);
  writeFileSync(join(planningDir, "dag.txt"), dagReport.ascii_dag, "utf-8");

  const reqLines = (
    Array.isArray(requirementsDocument.requirements) ? requirementsDocument.requirements : []
  )
    .map((r) => JSON.stringify(r))
    .join("\n");
  writeFileSync(
    join(planningDir, "requirements.jsonl"),
    reqLines + (reqLines ? "\n" : ""),
    "utf-8",
  );

  return {
    markdown,
    run_root: run,
    revision: 1,
    total_tasks: buffer.length,
    warnings,
    topology,
    topology_declaration: {
      independent_roots: topologyDeclaration.independentRoots,
      edges: topologyDeclaration.edges,
    },
    audit: {
      blocking_count: blocking.length,
      advisory_count: advisories.length,
      accepted: acceptances,
      not_evaluated: auditResult.not_evaluated,
    },
    quota_telemetry: quotaTelemetry,
    ...(provisioned.enabled ? { worktree_ledger: provisioned.ledger } : {}),
  };
}
