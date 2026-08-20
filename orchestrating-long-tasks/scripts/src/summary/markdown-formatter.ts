import type { Manifest } from "../contracts/capsule.ts";
import type { CommandRecord } from "../contracts/commands.ts";
import type { WorkflowState } from "../workflow/types.ts";
import {
  renderAgents,
  renderBranches,
  renderFilesChanged,
  renderPhases,
  renderTaskTrajectory,
} from "./markdown-execution-sections.ts";
import {
  renderCritic,
  renderGates,
  renderProbesAndPushbacks,
  renderScripts,
  renderTelemetry,
  renderTimeline,
  renderTools,
} from "./markdown-evidence-sections.ts";
import {
  renderEnhancedPlan,
  renderOriginalPrompt,
  renderRequirements,
  renderRunIdentity,
  renderTaskGraph,
  renderTopology,
} from "./markdown-plan-sections.ts";
import { buildReportContext } from "./markdown-report-context.ts";
import type { RollupMetrics, TimelineEventRecord } from "./types.ts";

export interface MarkdownFormatterInput {
  runId: string;
  /** Capsule root, so the report can quote the planning and review artifacts the run wrote. */
  runRoot: string;
  manifest: Manifest;
  /** The verbatim prompt bytes, decoded. The report quotes them rather than paraphrasing. */
  promptText: string;
  metrics: RollupMetrics;
  timeline: TimelineEventRecord[];
  state: Readonly<WorkflowState>;
  /** Command records read from the capsule, merged over the ones the projection carries. */
  commands: Record<string, CommandRecord>;
}

/**
 * The human-readable sibling of `graph.json`: read top to bottom it is the whole run, in run order,
 * complete on its own. Anything the run did not record renders as unknown rather than as a default,
 * so a reader can tell the difference between a zero and a silence.
 */
export function formatSummaryMarkdown(input: MarkdownFormatterInput): string {
  const context = buildReportContext(input);
  const lines: string[] = [
    `# Execution Run Report: \`${context.runId}\``,
    "",
    ...renderRunIdentity(context),
    ...renderOriginalPrompt(context),
    ...renderEnhancedPlan(context),
    ...renderRequirements(context),
    ...renderTopology(context),
    ...renderTaskGraph(context),
    ...renderPhases(context),
    ...renderTaskTrajectory(context),
    ...renderAgents(context),
    ...renderBranches(context),
    ...renderFilesChanged(context),
    ...renderScripts(context),
    ...renderTools(context),
    ...renderProbesAndPushbacks(context),
    ...renderGates(context),
    ...renderCritic(context),
    ...renderTelemetry(context),
    ...renderTimeline(context),
    "---",
    `Generated from the capsule at \`${context.runRoot}\`. Every value is labelled with the evidence that supports it.`,
    "",
  ];
  return lines.join("\n");
}
