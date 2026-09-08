import type { JsonObject } from "../../core/contracts/index.ts";
import { findRepoRoot } from "../../core/shared/index.ts";
import { MindAuditorEngine } from "../../mind/auditing/cognitive/index.ts";
import { enforceLineLimit } from "../formatters/index.ts";
import type { CommandContext } from "../index.ts";

export async function mindAuditLiveCommand(
  flags: Record<string, unknown>,
  _context: CommandContext = {},
): Promise<JsonObject> {
  const repoRoot = typeof flags["repo"] === "string" ? String(flags["repo"]) : findRepoRoot();
  const threshold = typeof flags["threshold"] === "number" ? Number(flags["threshold"]) : 120;
  const conversationId =
    typeof flags["conversation-id"] === "string" ? String(flags["conversation-id"]) : undefined;
  const asJson = Boolean(flags["json"]);

  const result = MindAuditorEngine.auditMindPulse(repoRoot, {
    stagnationThresholdSeconds: threshold,
    conversationId,
  });

  const lines = [
    `# Tier 0 Mind Live Audit: ${result.stagnant ? "STAGNANT" : "HEALTHY"}`,
    "",
    `- Idle Duration: ${result.idleDurationSeconds}s (Threshold: ${threshold}s)`,
    `- Status: ${result.stagnant ? "⚠️ STAGNANT (>120s)" : "✓ ACTIVE"}`,
    `- Recovery Action: ${result.remediation}`,
    `- Pending Backlog Items: ${result.telemetry.pendingBacklogCount}`,
    `- Unresolved Defects: ${result.telemetry.unresolvedDefectCount}`,
    `- Local Defects: ${result.localDefectCount}`,
    `- Defect Logged: ${result.defectCreated ? "YES" : "NO"}`,
    `- Worktree Occupancy: ${result.parallelismProvocation?.worktreeOccupancy ?? "n/a"}`,
    `- Disjoint Backlog Clusters: ${result.parallelismProvocation?.disjointClusterCount ?? "n/a"}`,
    `- Cursor Timestamp: ${result.cursor.lastInspectedTimestamp}`,
  ];

  if (result.injectionPrompt) {
    lines.push(
      "",
      "## Verbatim Injection Prompt Generated:",
      "```text",
      result.injectionPrompt.slice(0, 500) + "...",
      "```",
    );
  }

  const output = enforceLineLimit(lines.join("\n"), 30);

  return {
    stagnant: result.stagnant,
    idle_duration_seconds: result.idleDurationSeconds,
    pending_backlog_count: result.telemetry.pendingBacklogCount,
    unresolved_defect_count: result.telemetry.unresolvedDefectCount,
    local_defect_count: result.localDefectCount,
    remediation: result.remediation,
    defect_created: Boolean(result.defectCreated),
    parallelism_provocation_delivered: Boolean(result.parallelismProvocation?.provocationDelivered),
    worktree_occupancy: result.parallelismProvocation?.worktreeOccupancy ?? null,
    disjoint_cluster_count: result.parallelismProvocation?.disjointClusterCount ?? null,
    injection_prompt: result.injectionPrompt ?? null,
    cursor: result.cursor as unknown as JsonObject,
    output,
    markdown: output,
    ...(asJson ? { json: true } : {}),
  };
}
