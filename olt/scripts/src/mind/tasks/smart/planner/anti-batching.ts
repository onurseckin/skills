import {
  buildExactAnchorBriefing as buildExactAnchorBriefingCore,
  extractFileAnchors as extractFileAnchorsCore,
  type ExactAnchor,
} from "../../../proposals/builder/index.ts";
import { deriveGateForCategory } from "../executor/orchestrator.ts";
import type { TaskQueueItem } from "../../../../task/queue/index.ts";
import type {
  ExactAnchorBriefing,
  ExactFileAnchor,
  ExactAnchorExtractionOptions,
  BuildExactAnchorBriefingOptions,
} from "./types.ts";
import type { SmartTaskPlan } from "./models.ts";

export function deriveTargetFiles(
  writeScope: readonly string[],
  explicitTargets?: readonly string[],
): readonly string[] {
  if (explicitTargets && explicitTargets.length > 0) {
    return explicitTargets;
  }
  return writeScope.filter((item) => item.includes(".") || !item.endsWith("/"));
}

export function extractFileAnchors(
  filePath: string,
  options: ExactAnchorExtractionOptions = {},
): readonly ExactFileAnchor[] {
  const anchors = extractFileAnchorsCore(filePath, options.symbolHints, {
    baseDir: options.rootDir,
    maxSnippetLines: options.maxSnippetLines,
  });

  return anchors.map((a: ExactAnchor) => ({
    file_path: a.filePath,
    line_start: a.startLine,
    line_end: a.endLine,
    symbol_name: a.symbolName,
    symbol_kind: a.symbolKind,
    context_snippet: a.contextSnippet,
    replacement_anchor: a.replacementTarget,
    ast_reference: a.description,
    token_count: Math.max(1, Math.round((a.contextSnippet?.length ?? 10) / 4)),
  }));
}

export function formatZeroExplorationPrompt(
  briefing: Omit<ExactAnchorBriefing, "zero_exploration_prompt" | "generated_at">,
): string {
  const anchorSections: string[] = [];

  for (const anchor of briefing.file_anchors) {
    const symbolStr =
      anchor.symbol_name !== undefined
        ? ` (\`${anchor.symbol_name}\` [${anchor.symbol_kind ?? "symbol"}])`
        : "";
    anchorSections.push(
      `- **\`${anchor.file_path}\`** (L${anchor.line_start}-L${anchor.line_end})${symbolStr}\n` +
        `  * AST Ref: \`${anchor.ast_reference ?? anchor.file_path}\`\n` +
        `  * Drop-in Anchor: \`${anchor.replacement_anchor ?? anchor.file_path}\``,
    );
  }

  const anchorBlock =
    anchorSections.length > 0
      ? anchorSections.join("\n")
      : briefing.target_files.map((f) => `- **\`${f}\`** (Full file scope)`).join("\n");

  const testCmds =
    briefing.recommended_test_commands.length > 0
      ? briefing.recommended_test_commands.map((c) => `  ${c}`).join("\n")
      : `  bun test`;

  const criteriaBlock =
    briefing.acceptance_criteria.length > 0
      ? briefing.acceptance_criteria.map((c) => `- ${c}`).join("\n")
      : `- Implement required changes cleanly\n- Pass gate verification: \`${briefing.gate_command}\``;

  return [
    `# Zero-Exploration 1-Shot Task Briefing`,
    ``,
    `## Task Identity`,
    `- **Task ID**: \`${briefing.task_id}\``,
    `- **Label**: ${briefing.task_label}`,
    `- **Assigned Tier**: ${briefing.assigned_tier}`,
    `- **Implementer**: \`${briefing.assigned_implementer ?? "unassigned"}\``,
    `- **Validator**: \`${briefing.assigned_validator ?? "unassigned"}\``,
    `- **Standard Async Wait**: \`WaitMsBeforeAsync: ${briefing.async_wait_ms}\``,
    ``,
    `## Target Files & Exact Anchors`,
    anchorBlock,
    ``,
    `## Recommended Test Commands (File-Scoped)`,
    `\`\`\`bash`,
    testCmds,
    `\`\`\``,
    ``,
    `## Mandatory Gate Verification`,
    `\`\`\`bash`,
    `  ${briefing.gate_command}`,
    `\`\`\``,
    ``,
    `## Acceptance Criteria`,
    criteriaBlock,
    ``,
    `## Invariants & Protocol`,
    `- Zero-Exploration Directive: Modify ONLY the exact anchor locations in the assigned write scope.`,
    `- Static Invariants: 0 TypeScript any, 0 compiler/linter suppressions.`,
    `- Execution: Use \`WaitMsBeforeAsync: ${briefing.async_wait_ms}\` on command execution to eliminate polling waste.`,
    `- Submission: Submit task via \`bun harness.ts task:submit\` with lease token and notify Coordinator.`,
  ].join("\n");
}

export function buildExactAnchorBriefing(
  task:
    | SmartTaskPlan
    | TaskQueueItem
    | {
        readonly id: string;
        readonly label?: string | undefined;
        readonly title?: string | undefined;
        readonly write_scope?: readonly string[] | undefined;
        readonly target_files?: readonly string[] | undefined;
        readonly gate?: string | undefined;
        readonly acceptance_criteria?: readonly string[] | undefined;
        readonly rationale?: string | undefined;
        readonly description?: string | undefined;
        readonly assigned_tier?: string | undefined;
        readonly assigned_implementer?: string | undefined;
        readonly assigned_validator?: string | undefined;
      },
  options: BuildExactAnchorBriefingOptions = {},
): ExactAnchorBriefing {
  const taskId = task.id;
  const label =
    ("label" in task && typeof task.label === "string" && task.label) ||
    ("title" in task && typeof task.title === "string" && task.title) ||
    `Task ${taskId}`;

  const writeScope =
    "write_scope" in task && Array.isArray(task.write_scope) ? task.write_scope : [];
  const explicitTargets =
    "target_files" in task && Array.isArray(task.target_files) ? task.target_files : undefined;
  const targetFiles = deriveTargetFiles(writeScope, explicitTargets);

  const gateCommand =
    "gate" in task && typeof task.gate === "string" && task.gate.trim()
      ? task.gate.trim()
      : deriveGateForCategory("CORE_ENGINE", writeScope);

  const criteria =
    "acceptance_criteria" in task && Array.isArray(task.acceptance_criteria)
      ? task.acceptance_criteria.filter((c: unknown): c is string => typeof c === "string")
      : [`Complete implementation for ${label}`, `Pass gate: ${gateCommand}`];

  const rationale =
    ("rationale" in task && typeof task.rationale === "string" && task.rationale) ||
    ("description" in task && typeof task.description === "string" && task.description) ||
    `Task execution for ${label}`;

  const assignedTier =
    "assigned_tier" in task && typeof task.assigned_tier === "string"
      ? task.assigned_tier
      : "Tier_3_Implementer";

  const assignedImplementer =
    "assigned_implementer" in task && typeof task.assigned_implementer === "string"
      ? task.assigned_implementer
      : undefined;

  const assignedValidator =
    "assigned_validator" in task && typeof task.assigned_validator === "string"
      ? task.assigned_validator
      : undefined;

  const asyncWaitMs = options.asyncWaitMs ?? 10000;

  const coreBriefing = buildExactAnchorBriefingCore({
    taskId,
    label,
    writeScope,
    targetFiles,
    gateCommands: gateCommand ? [gateCommand] : [],
    acceptanceCriteria: criteria,
    targetSymbols: options.symbolHints,
    baseDir: options.rootDir,
  });

  const fileAnchors: ExactFileAnchor[] = coreBriefing.anchors.map((a) => ({
    file_path: a.filePath,
    line_start: a.startLine,
    line_end: a.endLine,
    symbol_name: a.symbolName,
    symbol_kind: a.symbolKind,
    context_snippet: a.contextSnippet,
    replacement_anchor: a.replacementTarget,
    ast_reference: a.description,
    token_count: Math.max(1, Math.round((a.contextSnippet?.length ?? 10) / 4)),
  }));

  const baseBriefing = {
    task_id: taskId,
    task_label: label,
    write_scope: writeScope,
    target_files: targetFiles,
    file_anchors: fileAnchors,
    recommended_test_commands: coreBriefing.recommendedCommands,
    gate_command: gateCommand,
    acceptance_criteria: criteria,
    rationale,
    assigned_tier: assignedTier,
    assigned_implementer: assignedImplementer,
    assigned_validator: assignedValidator,
    async_wait_ms: asyncWaitMs,
  };

  const zeroExplorationPrompt = formatZeroExplorationPrompt(baseBriefing);

  return {
    ...baseBriefing,
    zero_exploration_prompt: zeroExplorationPrompt,
    generated_at: new Date().toISOString(),
  };
}

export function enrichTaskPlanWithExactAnchors(
  plan: SmartTaskPlan,
  options: BuildExactAnchorBriefingOptions = {},
): SmartTaskPlan {
  const briefing = buildExactAnchorBriefing(plan, options);
  const targetFiles = briefing.target_files;
  const exactAnchors = briefing.file_anchors;

  return {
    ...plan,
    target_files: targetFiles,
    exact_anchors: exactAnchors,
    exact_briefing: briefing,
    metadata: {
      ...(plan.metadata ?? {}),
      ...(plan.feedback_id !== undefined ? { feedback_id: plan.feedback_id } : {}),
      ...(plan.candidate_id !== undefined ? { candidate_id: plan.candidate_id } : {}),
      target_files: targetFiles,
      exact_anchors: exactAnchors,
      exact_briefing: briefing,
      zero_exploration_1shot_brief: briefing.zero_exploration_prompt,
      async_wait_ms: briefing.async_wait_ms,
      assigned_implementer: plan.assigned_implementer,
      assigned_validator: plan.assigned_validator,
    },
  };
}

export function prepareExactAnchorBriefingForTask(
  task: SmartTaskPlan | TaskQueueItem,
  options: BuildExactAnchorBriefingOptions = {},
): ExactAnchorBriefing {
  return buildExactAnchorBriefing(task, options);
}

export function dispatchTaskWithExactAnchors(
  task: SmartTaskPlan,
  options: BuildExactAnchorBriefingOptions = {},
): {
  readonly plan: SmartTaskPlan;
  readonly briefing: ExactAnchorBriefing;
  readonly zero_exploration_prompt: string;
} {
  const briefing = buildExactAnchorBriefing(task, options);
  const enrichedPlan = enrichTaskPlanWithExactAnchors(task, options);

  return {
    plan: enrichedPlan,
    briefing,
    zero_exploration_prompt: briefing.zero_exploration_prompt,
  };
}
