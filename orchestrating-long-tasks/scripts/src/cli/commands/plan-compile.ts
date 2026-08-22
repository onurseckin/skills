import { basename, resolve } from "node:path";
import { getHarnessConfig } from "../../config/harness-config.ts";
import type { JsonValue } from "../../contracts/json.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { compileGraphDocument } from "../../graph/compiler.ts";
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
import { recordTopology } from "../../scheduler/index.ts";
import { loadRun } from "../../store/index.ts";
import { transact } from "../../store/transaction.ts";
import { formatPlanCompileBrief } from "../formatters/index.ts";
import { actorFlag, listFlag, textFlag, type Flags } from "../options.ts";
import { parseAuditAcceptance, recordAuditAcceptance, recordPlanAudit } from "./plan-audit.ts";
import { parseGateArgv } from "./plan-replan-bindings.ts";
import type { AssignableTask } from "../../workflow/worktree/assign.ts";
import { provisionWorktrees } from "../../workflow/worktree/provision.ts";

function promptText(prompt: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(prompt);
}

export function planCompileCommand(flags: Flags): Record<string, unknown> {
  const run = textFlag(flags, "run")!;
  const actor = actorFlag(flags);
  const completionGate = parseGateArgv(textFlag(flags, "completion-gate")!);
  if (completionGate === undefined)
    throw new HarnessError("INVALID_ARGUMENT", "--completion-gate must name a command");
  const loaded = loadRun(run);
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
  const { graphDocument } = compileGraphDocument(
    buffer,
    requirementsDocument,
    requirementIdsByTask,
    1,
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

  const markdown = formatPlanCompileBrief({
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
    ...(provisioned.enabled ? { worktree_ledger: provisioned.ledger } : {}),
  };
}
