import type { IntegrityIssue } from "../../core/contracts/index.ts";
import type { DoctorDiagnosticFinding } from "./types.ts";

export interface DoctorRemedialAction {
  readonly issueCode: string;
  readonly command: string;
  readonly description: string;
  readonly rationale?: string | undefined;
}

export interface GuidanceGenerationOptions {
  readonly runRoot: string;
  readonly repoRoot?: string | undefined;
  readonly findings?: readonly DoctorDiagnosticFinding[] | undefined;
  readonly integrityIssues?: readonly IntegrityIssue[] | undefined;
  readonly completionBlockers?: readonly string[] | undefined;
  readonly missingRunGates?: readonly string[] | undefined;
  readonly orphanEvidence?: readonly string[] | undefined;
  readonly criticStatus?: string | null | undefined;
}

export interface DoctorGuidanceResult {
  readonly remedialActions: readonly DoctorRemedialAction[];
  readonly guidanceSummary: readonly string[];
}

const STATE_PROJECTION_ISSUE_CODE = "STATE_PROJECTION";
const TORN_EVENT_TAIL_CODE = "TORN_EVENT_TAIL";

export function remedialActionsForIntegrityIssues(
  runRoot: string,
  integrityIssues: readonly IntegrityIssue[],
): readonly DoctorRemedialAction[] {
  const actions: DoctorRemedialAction[] = [];
  if (integrityIssues.some((issue) => issue.code === STATE_PROJECTION_ISSUE_CODE)) {
    actions.push({
      issueCode: STATE_PROJECTION_ISSUE_CODE,
      command: `bun harness.ts doctor:repair --run ${runRoot} --actor <ACTOR>`,
      description:
        "state.json no longer matches the event chain's final projection; doctor:repair re-derives it from the last complete event, quarantining any torn tail.",
    });
  }
  if (integrityIssues.some((issue) => issue.code === TORN_EVENT_TAIL_CODE)) {
    actions.push({
      issueCode: TORN_EVENT_TAIL_CODE,
      command: `bun harness.ts recover --run ${runRoot}`,
      description:
        "Torn trailing JSON line in events.jsonl; recover quarantines invalid bytes into quarantine/ and truncates log to last valid record.",
    });
  }
  return actions;
}

export function generateRemedialGuidance(
  options: GuidanceGenerationOptions,
): DoctorGuidanceResult {
  const actions: DoctorRemedialAction[] = [];
  const guidance: string[] = [];
  const seenCodes = new Set<string>();

  const integrityIssues = options.integrityIssues ?? [];
  for (const action of remedialActionsForIntegrityIssues(options.runRoot, integrityIssues)) {
    if (!seenCodes.has(action.issueCode)) {
      seenCodes.add(action.issueCode);
      actions.push(action);
      guidance.push(`[${action.issueCode}] ${action.description} -> Run: \`${action.command}\``);
    }
  }

  const findings = options.findings ?? [];
  for (const f of findings) {
    if (seenCodes.has(f.code)) continue;

    if (f.code === "UNAPPROVED_ROOT_FILE" || f.code === "STATIC_PACKAGE_RUNTIME_POLLUTION" || f.code === "UNCONFINED_SCRATCH_SCRIPT") {
      seenCodes.add(f.code);
      const act: DoctorRemedialAction = {
        issueCode: f.code,
        command: `bun harness.ts doctor --fix`,
        description: "Relocate loose files or static package runtime files to scratch/ or .olt/ to comply with Invariant 30.",
        rationale: "Invariant 30 strictly enforces zero loose root files and static package purity.",
      };
      actions.push(act);
      guidance.push(`[${f.code}] ${act.description} -> Run: \`${act.command}\``);
    } else if (f.code === "PUSHBACK_QUOTA_DEFICIT" || f.code === "PUSHBACK_QUOTA_DEFICIT_ERROR") {
      seenCodes.add(f.code);
      const act: DoctorRemedialAction = {
        issueCode: f.code,
        command: `bun harness.ts task:probe --run ${options.runRoot} --task <TASK_ID>`,
        description: "Task requires 5 cognitive pushbacks and 5 adversarial probes before completion.",
        rationale: "Pushback quotas ensure comprehensive adversarial validation before task closure.",
      };
      actions.push(act);
      guidance.push(`[${f.code}] ${act.description} -> Run: \`${act.command}\``);
    } else if (f.code === "EXPLICIT_ANY" || f.code === "ANY_TYPE_ASSERTION" || f.code === "COMPILER_SUPPRESSION_DIRECTIVE") {
      seenCodes.add(f.code);
      const act: DoctorRemedialAction = {
        issueCode: f.code,
        command: `bun harness.ts task:check --run ${options.runRoot}`,
        description: "Remove explicit 'any' type assertions and compiler suppressions (@ts-ignore/@ts-expect-error) from code.",
        rationale: "AST purity mandates zero 'any' types and zero compiler suppressions across harness code.",
      };
      actions.push(act);
      guidance.push(`[${f.code}] ${act.description}`);
    } else if (f.code.startsWith("WORKTREE_")) {
      seenCodes.add(f.code);
      const act: DoctorRemedialAction = {
        issueCode: f.code,
        command: `bun harness.ts branch:cleanup`,
        description: "Clean up orphaned worktree directories, merged track branches, and dead-PID worktree locks.",
        rationale: "Worktree health ensures isolated git working trees do not leak stale locks or dead branches.",
      };
      actions.push(act);
      guidance.push(`[${f.code}] ${act.description} -> Run: \`${act.command}\``);
    } else if (f.code.startsWith("MAILBOX_")) {
      seenCodes.add(f.code);
      const act: DoctorRemedialAction = {
        issueCode: f.code,
        command: `bun harness.ts doctor --fix`,
        description: "Rebuild mailbox cursor from valid inbox envelopes and prune orphaned mailboxes.",
        rationale: "Mailbox health ensures inter-agent communication channels remain uncorrupted.",
      };
      actions.push(act);
      guidance.push(`[${f.code}] ${act.description} -> Run: \`${act.command}\``);
    } else if (f.code === "GIT_INDEX_LOCKED" || f.code === "UNCOMMITTED_COMPLETED_ARTIFACTS") {
      seenCodes.add(f.code);
      const act: DoctorRemedialAction = {
        issueCode: f.code,
        command: `git add -A`,
        description: "Stage all modified artifacts immediately to persist loose Git objects for reflog safety.",
        rationale: "Sub-domain completion git staging invariant guarantees recoverability across crashes.",
      };
      actions.push(act);
      guidance.push(`[${f.code}] ${act.description} -> Run: \`${act.command}\``);
    }
  }

  const orphanEvidence = options.orphanEvidence ?? [];
  if (orphanEvidence.length > 0 && !seenCodes.has("ORPHAN_EVIDENCE")) {
    seenCodes.add("ORPHAN_EVIDENCE");
    const act: DoctorRemedialAction = {
      issueCode: "ORPHAN_EVIDENCE",
      command: `bun harness.ts evidence:disposition --run ${options.runRoot}`,
      description: "Record dispositions for undispositioned orphan evidence before sealing run completion.",
      rationale: "Every piece of orphan evidence must be explicitly dispositioned prior to run:complete.",
    };
    actions.push(act);
    guidance.push(`[ORPHAN_EVIDENCE] ${act.description} -> Run: \`${act.command}\``);
  }

  const missingRunGates = options.missingRunGates ?? [];
  if (missingRunGates.length > 0 && !seenCodes.has("MISSING_RUN_GATES")) {
    seenCodes.add("MISSING_RUN_GATES");
    const act: DoctorRemedialAction = {
      issueCode: "MISSING_RUN_GATES",
      command: `bun harness.ts gate:verify --run ${options.runRoot} --actor coordinator`,
      description: "Execute all run-scoped gate verifications before triggering terminal completion.",
      rationale: "Terminal completion requires all run-level gates to be satisfied and evidenced.",
    };
    actions.push(act);
    guidance.push(`[MISSING_RUN_GATES] ${act.description} -> Run: \`${act.command}\``);
  }

  if (options.criticStatus === null || options.criticStatus === "expired" || options.criticStatus === "assigned") {
    if (!seenCodes.has("CRITIC_REVIEW_PENDING")) {
      seenCodes.add("CRITIC_REVIEW_PENDING");
      const act: DoctorRemedialAction = {
        issueCode: "CRITIC_REVIEW_PENDING",
        command: `bun harness.ts critic:start --run ${options.runRoot} --critic <CRITIC_ID>`,
        description: "Obtain completeness critic review and approval token prior to run:complete.",
        rationale: "Terminal run:complete requires an active critic review approval token.",
      };
      actions.push(act);
      guidance.push(`[CRITIC_REVIEW_PENDING] ${act.description} -> Run: \`${act.command}\``);
    }
  }

  return { remedialActions: actions, guidanceSummary: guidance };
}
