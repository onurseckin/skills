import type { BranchRecord } from "../contracts/branch.ts";
import type { JsonObject } from "../contracts/json.ts";
import { workflowPort } from "../integration/store-ports.ts";
import { completionIssues } from "../workflow/completion/completion-state.ts";
import { orphanEvidenceSha256 } from "../workflow/orphan-evidence/digest.ts";
import { isLeaseSuspended } from "../workflow/lease/suspension.ts";
import type { TaskRecord, WorkflowState } from "../workflow/types.ts";
import { trustedHostEvidence } from "../contracts/trusted-host.ts";

function taskView(task: TaskRecord): JsonObject {
  const validations = task.validations ?? [];
  return {
    id: task.id,
    status: task.status,
    requirement_ids: [...task.requirement_ids],
    dependencies: [...task.dependencies],
    owner: task.lease?.agent_id ?? task.repair_assignee ?? null,
    role: task.lease?.role ?? null,
    attempt: task.lease?.attempt ?? validations[0]?.attempt ?? null,
    lease_expires_at: task.lease?.expires_at ?? null,
    original_implementer: task.original_implementer ?? null,
    repair_assignee: task.repair_assignee ?? null,
    validation: validations.map((validation) => ({
      validator_id: validation.validator_id,
      domain: validation.domain,
      attempt: validation.attempt,
      deadline_at: validation.deadline_at,
      verdict: validation.verdict ?? null,
    })),
    open_finding_ids: (task.findings ?? [])
      .filter(({ status }) => status === "open")
      .map(({ id }) => id)
      .sort(),
    gate_results: structuredClone(task.gate_results ?? []),
    report_recorded: task.report !== undefined,
    repair_round: task.repair_round,
    probe_round: task.probe_round ?? 0,
  };
}

function branchView(branch: BranchRecord): JsonObject {
  return {
    id: branch.id,
    parent_task_id: branch.parent_task_id,
    parent_agent_id: branch.parent_agent_id,
    status: branch.status,
    reason: branch.reason,
    depth: branch.depth,
    opened_at: branch.opened_at,
    collected_at: branch.collected_at ?? null,
    outcome_summary: branch.outcome_summary ?? null,
    files_changed: structuredClone(branch.files_changed ?? null),
    sub_tasks: branch.sub_tasks.map((subTask) => ({
      id: subTask.id,
      label: subTask.label,
      status: subTask.status,
      agent_id: subTask.agent_id ?? null,
      write_scope: [...subTask.write_scope],
    })),
  };
}

function staleEvidence(state: WorkflowState, now: Date): string[] {
  const current = now.getTime();
  const issues = Object.values(state.tasks)
    .flatMap((task) => {
      const issues: string[] = [];
      const lease = task.lease;
      if (lease && !isLeaseSuspended(lease) && Date.parse(lease.expires_at) <= current)
        issues.push(`task ${task.id} lease expired at ${lease.expires_at}`);
      if (task.status === "validating") {
        for (const validation of task.validations ?? []) {
          if (validation.verdict === undefined && Date.parse(validation.deadline_at) <= current)
            issues.push(
              `task ${task.id} ${validation.domain} validation expired at ${validation.deadline_at}`,
            );
        }
      }
      return issues;
    })
    .sort();
  const critic = state.completion_critic;
  if (
    critic &&
    (critic.status === "assigned" || critic.status === "packet_published") &&
    Date.parse(critic.deadline_at) <= current
  )
    issues.push(`completion critic ${critic.critic_id} expired at ${critic.deadline_at}`);
  return issues.sort();
}

export function workflowView(runRoot: string, now = new Date()): JsonObject {
  const state = workflowPort(runRoot).read();
  const critic = state.completion_critic;
  const tasks = Object.values(state.tasks)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(taskView);
  const requirements = [...state.requirements]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(({ id, status, evidence, disposition, authority_status, authority_history }) => ({
      id,
      status,
      evidence: [...evidence],
      disposition: disposition ?? null,
      authority_status: authority_status ?? null,
      authority_history: structuredClone(authority_history ?? []),
    }));
  const commands = Object.values(state.commands)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(
      ({
        id,
        actor,
        status,
        task_id,
        gate_id,
        exit_code,
        fingerprint,
        assurance,
        repository_before,
        repository_after,
      }) => ({
        id,
        actor,
        status,
        task_id,
        gate_id,
        exit_code,
        fingerprint,
        assurance: assurance ?? null,
        repository_before: structuredClone(repository_before ?? null),
        repository_after: structuredClone(repository_after ?? null),
      }),
    );
  return {
    gate_evidence: trustedHostEvidence(),
    tasks,
    requirements,
    gates: structuredClone(state.gates),
    commands,
    packets: Object.values(state.packets ?? {}).sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
    branches: (state.branches ?? []).map(branchView),
    orphan_evidence: state.orphan_evidence.map((evidence) => ({
      orphan_sha256: orphanEvidenceSha256(evidence),
      evidence: structuredClone(evidence),
    })),
    orphan_evidence_dispositions: structuredClone(state.orphan_evidence_dispositions ?? []),
    current_repository_binding: structuredClone(state.current_repository_binding ?? null),
    completion_critic:
      critic === undefined
        ? null
        : {
            critic_id: critic.critic_id,
            attempt: critic.attempt,
            status: critic.status,
            started_at: critic.started_at,
            deadline_at: critic.deadline_at,
            readiness_sha256: critic.readiness_sha256,
            repository_binding: structuredClone(critic.repository_binding),
            packet_id: critic.packet_id ?? null,
          },
    completion_critic_history: (state.completion_critic_history ?? []).map((entry) => ({
      critic_id: entry.critic_id,
      attempt: entry.attempt,
      status: entry.status,
      started_at: entry.started_at,
      deadline_at: entry.deadline_at,
      readiness_sha256: entry.readiness_sha256,
      repository_binding: structuredClone(entry.repository_binding),
      packet_id: entry.packet_id ?? null,
    })),
    completion_review: structuredClone(state.completion_review ?? null),
    completion_reviews: structuredClone(state.completion_reviews ?? []),
    completion_remediations: structuredClone(state.completion_remediations ?? []),
    completion_verification: structuredClone(state.completion_verification ?? null),
    completion_result: structuredClone(state.completion_result ?? null),
    completion_blockers: completionIssues(state),
    stale_evidence: staleEvidence(state, now),
  };
}
