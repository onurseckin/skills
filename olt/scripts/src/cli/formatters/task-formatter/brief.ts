import { enforceLineLimit } from "../index.ts";
import { nextActionsBlock } from "../next-actions/index.ts";
import type { TaskBriefParams } from "./types.ts";

export function formatTaskBrief(params: TaskBriefParams): string {
  const scopeStr =
    params.writeScope.length > 0 ? params.writeScope.map((s) => `\`${s}\``).join(", ") : "`none`";
  const mdLines: string[] = [`### 🌌 Zero-Exploration Briefing: ${params.taskId}`];
  if (params.label !== undefined && params.label.trim() !== "") {
    mdLines.push(`- **Label**: ${params.label}`);
  }
  if (params.role !== undefined || params.agent !== undefined) {
    const rolePart = params.role !== undefined ? `Role: \`${params.role}\`` : "";
    const agentPart = params.agent !== undefined ? `Agent: \`${params.agent}\`` : "";
    mdLines.push(
      `- **Assignment**: ${[rolePart, agentPart].filter((s) => s.length > 0).join(" · ")}`,
    );
  }
  mdLines.push(`- **Assigned Write Scope**: ${scopeStr}`);
  if (params.worktreePath !== undefined) {
    mdLines.push(`- **Isolated Worktree**: \`${params.worktreePath}\``);
  }
  if (params.targetFiles !== undefined && params.targetFiles.length > 0) {
    mdLines.push(
      `- **Suggested Target Files**: ${params.targetFiles.map((f) => `\`${f}\``).join(", ")}`,
    );
  }
  if (params.recommendedCommands !== undefined && params.recommendedCommands.length > 0) {
    mdLines.push(`- **Recommended Commands**:`);
    for (const cmd of params.recommendedCommands) mdLines.push(`  - \`${cmd}\``);
  }
  if (params.gateCommands !== undefined && params.gateCommands.length > 0) {
    mdLines.push(`- **Gate Commands**:`);
    for (const cmd of params.gateCommands) mdLines.push(`  - \`${cmd}\``);
  }
  if (params.acceptanceCriteria !== undefined && params.acceptanceCriteria.length > 0) {
    mdLines.push(`- **Acceptance Criteria**:`);
    for (const ac of params.acceptanceCriteria) mdLines.push(`  - ${ac}`);
  }
  if (params.nextSteps !== undefined && params.nextSteps.length > 0) {
    mdLines.push(...nextActionsBlock(params.nextSteps));
  }
  return enforceLineLimit(mdLines.join("\n"), 30);
}
