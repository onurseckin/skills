import { resolve } from "node:path";
import { isJsonObject, type JsonObject } from "../../core/contracts/index.ts";
import { HarnessError } from "../../core/errors/index.ts";
import {
  AUDIT_INVARIANT_IDS,
  auditPlan,
  blockingFindings,
  isAuditInvariantId,
  type AuditInvariantId,
  type AuditTaskInput,
  type PlanAuditResult,
} from "../../graph/plan-audit.ts";
import type { TaskDeclaration } from "../../requirements/compiler.ts";
import { loadRun } from "../../engine/store/index.ts";
import { transact } from "../../engine/store/transaction.ts";
import { formatPlanAuditBrief } from "../formatters/index.ts";
import { actorFlag, textFlag, type Flags } from "../options.ts";

function gateText(gate: TaskDeclaration["gate"]): string {
  return typeof gate === "string" ? gate : gate.join(" ");
}

function promptText(prompt: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(prompt);
}

function auditTasksFromBuffer(buffer: readonly TaskDeclaration[]): AuditTaskInput[] {
  return buffer.map((t) => ({
    taskId: t.id,
    writeScope: t.writeScope,
    deps: t.deps ?? [],
    gate: gateText(t.gate),
    ...(t.effort === undefined ? {} : { effort: t.effort }),
  }));
}

export interface AuditAcceptance {
  invariant: AuditInvariantId;
  reason: string;
}

export function parseAuditAcceptance(raw: string): AuditAcceptance {
  const sep = raw.indexOf(":");
  if (sep <= 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `--accept-audit must be "<invariant-id>:<reason>", got "${raw}"`,
    );
  }
  const invariant = raw.slice(0, sep).trim();
  const reason = raw.slice(sep + 1).trim();
  if (!isAuditInvariantId(invariant)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `--accept-audit names an unknown invariant "${invariant}"; expected one of ${AUDIT_INVARIANT_IDS.join(", ")}`,
    );
  }
  if (!reason) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `--accept-audit for ${invariant} must carry a reason after the colon`,
    );
  }
  return { invariant, reason };
}

export function recordPlanAudit(
  run: string,
  actor: string,
  buffer: readonly TaskDeclaration[],
  state: JsonObject,
  prompt = "",
): { result: PlanAuditResult; revision: number } {
  const repoRoot = resolve(run, "..", "..");
  const tasks = auditTasksFromBuffer(buffer);
  const result = auditPlan(repoRoot, tasks, state, prompt);
  let revision = 1;
  transact(
    run,
    actor,
    "plan-audited",
    {
      task_count: buffer.length,
      blocking_count: blockingFindings(result).length,
      findings: result.findings,
      not_evaluated: result.not_evaluated,
    },
    (state) => {
      const planning = isJsonObject(state.planning) ? state.planning : {};
      const previous = isJsonObject(planning.audit) ? planning.audit : undefined;
      const previousRevision = previous?.revision;
      revision = typeof previousRevision === "number" ? previousRevision + 1 : 1;
      state.planning = {
        ...planning,
        audit: { revision, findings: result.findings, not_evaluated: result.not_evaluated },
      };
    },
  );
  return { result, revision };
}

export function recordAuditAcceptance(
  run: string,
  actor: string,
  acceptance: AuditAcceptance,
): void {
  transact(
    run,
    actor,
    "plan-audit-accepted",
    { invariant: acceptance.invariant, reason: acceptance.reason },
    () => {},
  );
}

export function planAuditCommand(flags: Flags): Record<string, unknown> {
  const run = textFlag(flags, "run")!;
  const actor = actorFlag(flags);
  const loaded = loadRun(run);
  const rawBuffer = Array.isArray(loaded.state.planning_buffer) ? loaded.state.planning_buffer : [];
  const buffer = rawBuffer as unknown as TaskDeclaration[];
  if (buffer.length === 0)
    throw new HarnessError("INVALID_STATE", "cannot audit empty planning buffer");

  const { result, revision } = recordPlanAudit(
    run,
    actor,
    buffer,
    loaded.state,
    promptText(loaded.prompt),
  );
  const blocking = blockingFindings(result);
  const markdown = formatPlanAuditBrief({
    runId: loaded.manifest.run_id,
    revision,
    findings: result.findings,
    notEvaluated: result.not_evaluated,
  });
  return {
    markdown,
    run_root: run,
    revision,
    findings: result.findings,
    not_evaluated: result.not_evaluated,
    blocking_count: blocking.length,
  };
}
