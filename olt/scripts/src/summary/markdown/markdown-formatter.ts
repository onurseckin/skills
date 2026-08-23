import type { Manifest } from "../../core/contracts/capsule.ts";
import type { CommandRecord } from "../../core/contracts/commands.ts";
import type { WorkflowState } from "../../workflow/types.ts";
import { renderChecklistCoverage } from "./markdown-checklist-coverage.ts";
import {
  renderGates,
  renderProbesAndPushbacks,
  renderScripts,
  renderTools,
} from "./markdown-evidence-sections.ts";
import { renderCritic, renderTelemetry, renderTimeline } from "./markdown-run-sections.ts";
import {
  renderAgents,
  renderBranches,
  renderFilesChanged,
  renderPhases,
  renderTaskTrajectory,
} from "./markdown-execution-sections.ts";
import {
  renderEnhancedPlan,
  renderOriginalPrompt,
  renderRequirements,
  renderRunIdentity,
  renderTaskGraph,
  renderTopology,
} from "./markdown-plan-sections.ts";
import { buildReportContext } from "./markdown-report-context.ts";
import { renderActionProvenance } from "./markdown-step-provenance.ts";
import type { GraphDataset, RollupMetrics, TimelineEventRecord } from "../types.ts";

export interface MarkdownFormatterInput {
  runId: string;
  runRoot: string;
  manifest: Manifest;
  promptText: string;
  metrics: RollupMetrics;
  timeline: TimelineEventRecord[];
  state: Readonly<WorkflowState>;
  commands: Record<string, CommandRecord>;
  graph: GraphDataset;
}

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
    ...renderActionProvenance(context),
    ...renderChecklistCoverage(context),
    "---",
    `Generated from the capsule at \`${context.runRoot}\`. Every value is labelled with the evidence that supports it.`,
    "",
  ];
  return lines.join("\n");
}
