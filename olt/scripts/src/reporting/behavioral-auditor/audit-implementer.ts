import type { CommandRecord, JsonObject } from "../../core/contracts/index.ts";
import { isJsonObject } from "../../core/contracts/index.ts";
import type { TaskRecord, ValidationAttempt } from "../../workflow/types.ts";
import { isImplementerRole } from "./predicates.ts";
import { GRAPH_MUTATION_COMMANDS, VALIDATION_COMMANDS, type BehavioralFinding } from "./types.ts";

export function auditImplementerSelfGradingAndTopology(
  roleMap: Map<string, string>,
  tasks: readonly TaskRecord[],
  commands: readonly CommandRecord[],
  events: readonly JsonObject[],
  findings: BehavioralFinding[],
): void {
  for (const task of tasks) {
    const implementerIds = new Set<string>();
    if (task.original_implementer) implementerIds.add(task.original_implementer);
    if (task.lease && isImplementerRole(task.lease.role)) {
      implementerIds.add(task.lease.agent_id);
    }
    for (const attempt of task.attempts ?? []) {
      if (
        isJsonObject(attempt) &&
        typeof attempt.agent_id === "string" &&
        (attempt.role === "implementer" ||
          attempt.kind === "implementation" ||
          attempt.kind === "repair")
      ) {
        implementerIds.add(attempt.agent_id);
      }
    }
    for (const hist of task.history ?? []) {
      if (
        hist.from === "ready" ||
        hist.from === "retry_ready" ||
        hist.to === "submitted" ||
        hist.to === "leased"
      ) {
        if (hist.actor) implementerIds.add(hist.actor);
      }
    }

    const allValidations: readonly ValidationAttempt[] = [
      ...(task.validations ?? []),
      ...(task.validation_history ?? []),
    ];
    for (const val of allValidations) {
      if (val.validator_id && implementerIds.has(val.validator_id)) {
        findings.push({
          agent_id: val.validator_id,
          role: "implementer",
          violation_type: "implementer_self_grading",
          severity: "critical",
          observation: `Implementer agent "${val.validator_id}" performed validation review for task "${task.id}" which it previously implemented`,
          remediation:
            "Implementers must never validate or sign off on their own work. Validation requires independent Tier 3 Validators.",
          evidence: {
            task_id: task.id,
            validator_id: val.validator_id,
            ...(val.verdict ? { verdict: val.verdict } : {}),
            ...(val.domain ? { domain: val.domain } : {}),
          },
        });
      }
    }
  }

  for (const cmd of commands) {
    const role = roleMap.get(cmd.actor) ?? (isImplementerRole(cmd.actor) ? "implementer" : "");
    if (!isImplementerRole(role)) continue;

    const argv = cmd.argv ?? [];

    const valCmd = argv.find((arg) => VALIDATION_COMMANDS.has(arg));
    if (valCmd) {
      findings.push({
        agent_id: cmd.actor,
        role: "implementer",
        violation_type: "implementer_self_grading",
        severity: "critical",
        observation: `Implementer agent "${cmd.actor}" executed validation/grading command "${valCmd}" in command "${cmd.id}"`,
        remediation:
          "Validation commands (task:validate-start, task:review, task:probe, task:reject, gate:prove) are strictly restricted to independent Tier 3 Validators.",
        evidence: {
          command_id: cmd.id,
          argv: [...cmd.argv],
          validation_subcommand: valCmd,
        },
      });
    }

    const graphCmd = argv.find((arg) => GRAPH_MUTATION_COMMANDS.has(arg));
    if (graphCmd) {
      findings.push({
        agent_id: cmd.actor,
        role: "implementer",
        violation_type: "implementer_graph_mutation",
        severity: "critical",
        observation: `Implementer agent "${cmd.actor}" attempted to mutate graph topology via command "${graphCmd}" in command "${cmd.id}"`,
        remediation:
          "Implementers cannot alter task graph topology or compile plans. Graph mutations belong exclusively to Tier 2 Coordinators.",
        evidence: {
          command_id: cmd.id,
          argv: [...cmd.argv],
          graph_subcommand: graphCmd,
        },
      });
    }
  }

  for (const ev of events) {
    if (!isJsonObject(ev)) continue;
    const actor = typeof ev.actor === "string" ? ev.actor : "";
    const kind = typeof ev.kind === "string" ? ev.kind : "";
    const role = roleMap.get(actor) ?? (isImplementerRole(actor) ? "implementer" : "");
    if (!isImplementerRole(role)) continue;

    if (
      kind === "plan-compiled" ||
      kind === "plan-applied" ||
      kind === "plan-enhanced" ||
      kind === "plan-replan-requested" ||
      kind === "mind-candidate-recorded"
    ) {
      findings.push({
        agent_id: actor,
        role: "implementer",
        violation_type: "implementer_graph_mutation",
        severity: "critical",
        observation: `Implementer actor "${actor}" emitted graph topology mutation event "${kind}"`,
        remediation:
          "Implementers cannot alter task graph topology. Re-assign planning tasks to Tier 2 Coordinators.",
        evidence: {
          event_kind: kind,
          sequence: typeof ev.sequence === "number" ? ev.sequence : 0,
        },
      });
    }
  }
}
