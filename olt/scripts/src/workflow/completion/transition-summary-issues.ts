import type { AgentGrantRecord } from "../../core/contracts/agents.ts";
import {
  isBranchOpen,
  type BranchRecord,
  type BranchSubTask,
} from "../../core/contracts/branch.ts";
import { readAgentLedger } from "../agents/ledger.ts";
import { readBranchLedger } from "../branch/ledger.ts";
import type { TaskRecord, WorkflowState } from "../types.ts";

function isNonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function subTaskSummaryIssues(branch: BranchRecord, subTask: BranchSubTask): string[] {
  const issues: string[] = [];
  const submitted = subTask.status === "submitted";
  if (submitted && !isNonBlank(subTask.summary))
    issues.push(`branch ${branch.id} sub-task ${subTask.id} is submitted with no recorded summary`);
  if (!submitted && isNonBlank(subTask.summary))
    issues.push(
      `branch ${branch.id} sub-task ${subTask.id} carries a summary but is ${subTask.status}, not submitted`,
    );
  return issues;
}

function branchSummaryIssues(branch: BranchRecord): string[] {
  const issues: string[] = [];
  const open = isBranchOpen(branch);
  if (!open && !isNonBlank(branch.outcome_summary))
    issues.push(`branch ${branch.id} is ${branch.status} with no recorded outcome summary`);
  if (open && isNonBlank(branch.outcome_summary))
    issues.push(`branch ${branch.id} carries an outcome summary but is still ${branch.status}`);
  for (const subTask of branch.sub_tasks) issues.push(...subTaskSummaryIssues(branch, subTask));
  return issues;
}

function grantSummaryIssues(grant: AgentGrantRecord): string[] {
  const issues: string[] = [];
  const released = grant.status === "released";
  if (released && !isNonBlank(grant.release_reason))
    issues.push(`agent ${grant.id} is released with no recorded release reason`);
  if (!released && isNonBlank(grant.release_reason))
    issues.push(`agent ${grant.id} carries a release reason but is still ${grant.status}`);
  return issues;
}

function taskSummaryIssues(task: TaskRecord): string[] {
  const issues: string[] = [];
  if (task.report !== undefined) {
    const summary = (task.report as { summary?: unknown }).summary;
    if (!isNonBlank(summary))
      issues.push(`task ${task.id} has a submission report with no recorded summary`);
  }
  const handedOff =
    isNonBlank(task.repair_assignee) && task.repair_assignee !== task.original_implementer;
  if (handedOff && task.replacement_reason !== undefined && !isNonBlank(task.replacement_evidence))
    issues.push(
      `task ${task.id} was handed off to ${task.repair_assignee} with no recorded handoff evidence`,
    );
  return issues;
}

export function transitionSummaryIssues(state: WorkflowState): string[] {
  const issues: string[] = [];
  for (const branch of readBranchLedger(state)) issues.push(...branchSummaryIssues(branch));
  for (const grant of readAgentLedger(state)) issues.push(...grantSummaryIssues(grant));
  for (const task of Object.values(state.tasks)) issues.push(...taskSummaryIssues(task));
  return [...new Set(issues)].sort();
}
