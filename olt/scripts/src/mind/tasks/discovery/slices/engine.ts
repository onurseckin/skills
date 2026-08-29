import {
  getSourceEmpiricalCommand,
  mapDiscoveryCategoryToSourceId,
} from "../../../memory/sources/index.ts";
import { sanitizeSlug } from "../scanners/index.ts";
import type { DiscoveryItem, DiscoveredTaskPlan, TaskDiscoveryResult } from "../types.ts";

export function synthesizeTaskFromDiscovery(item: DiscoveryItem, index = 1): DiscoveredTaskPlan {
  const taskSlug = sanitizeSlug(item.id);
  const taskId = `task-p49-discovery-${index}-${taskSlug}`;
  const implementerRole = `implementer-p49-discovery-${taskSlug}`;
  const validatorRole = `validator-p49-discovery-${taskSlug}`;

  const writeScope =
    item.writeScope.length > 0
      ? item.writeScope
      : item.targetFiles.length > 0
        ? item.targetFiles
        : ["olt/scripts/src/mind/"];

  const gate =
    item.gate.trim().length > 0 ? item.gate : "bun test tests/unit/mind && bun run typecheck";

  const acceptanceCriteria =
    item.acceptanceCriteria.length > 0
      ? item.acceptanceCriteria
      : [
          `Remediate discovery issue: ${item.description.slice(0, 100)}`,
          `Verify gate passes cleanly: ${gate}`,
          "Enforce 100% strict TypeScript types with 0 any and 0 compiler suppressions",
        ];

  const sourceId = mapDiscoveryCategoryToSourceId(item.category);
  const empiricalCommand = getSourceEmpiricalCommand(sourceId);

  return {
    id: taskId,
    label: item.title.slice(0, 100),
    write_scope: writeScope,
    gate,
    charter_goals: item.charterGoals.length > 0 ? item.charterGoals : ["G1"],
    acceptance_criteria: acceptanceCriteria,
    dependencies: [],
    source_type: item.sourceType,
    priority: item.priority,
    rationale: item.description,
    assigned_tier: "Tier_3_Implementer",
    assigned_implementer: implementerRole,
    assigned_validator: validatorRole,
    candidate_id: item.sourceReference,
    metadata: {
      discovery_category: item.category,
      discovery_source_id: sourceId,
      empirical_command: empiricalCommand,
      assigned_implementer: implementerRole,
      assigned_validator: validatorRole,
      source_reference: item.sourceReference ? item.sourceReference : null,
      ...item.metadata,
    },
  };
}

export function formatTaskDiscoveryBrief(result: TaskDiscoveryResult): string {
  const lines: string[] = [
    `### Mind Cognitive Task Discovery: ${result.stats.totalFindings} Finding(s)`,
    `- **Scanned At**: \`${result.scannedAt}\``,
    `- **Code Quality**: ${result.stats.codeQualityCount} finding(s)`,
    `- **Test Coverage**: ${result.stats.testCoverageCount} gap(s)`,
    `- **Cognitive Gaps**: ${result.stats.cognitiveGapCount} gap(s)`,
    `- **Dormant Criteria**: ${result.stats.dormantCriteriaCount} goal(s)`,
    `- **Architectural Health**: ${result.stats.architecturalHealthCount} finding(s)`,
    `- **Pending Feedback**: ${result.stats.feedbackCount} item(s)`,
    `- **Open Defects**: ${result.stats.defectCount} item(s)`,
    `- **Synthesized Plans**: ${result.synthesizedPlans.length} task(s)`,
    `- **Auto-Enqueued**: ${result.enqueuedTasks.length} task(s)`,
  ];

  if (result.synthesizedPlans.length > 0) {
    lines.push("", "#### Synthesized Tasks:");
    for (const plan of result.synthesizedPlans.slice(0, 5)) {
      lines.push(`- **${plan.id}** [${plan.priority}]: ${plan.label}`);
    }
  }

  return lines.join("\n");
}
