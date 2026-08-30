import type { RepoGovernanceStatus } from "../../mind/governance/index.ts";
import { enforceLineLimit, mindInitNextActions, nextActionsBlock } from "../formatters/index.ts";

export function formatMindInitBrief(params: {
  mindId: string;
  runRoot: string;
  generation: number;
  charterSourcePath: string;
  charterSha256: string;
  goals: readonly string[];
  repoRoots: readonly string[];
  governance?: RepoGovernanceStatus;
}): string {
  const md = [
    `### Mind Initialized: ${params.mindId}`,
    `- **Capsule Root**: \`${params.runRoot}\``,
    `- **Generation**: ${params.generation}`,
    `- **Charter Source**: \`${params.charterSourcePath}\``,
    `- **Charter SHA-256**: \`${params.charterSha256}\``,
    `- **Pinned Goals**: ${params.goals.join(", ")} (${params.goals.length} total)`,
    `- **Repo Roots**: ${params.repoRoots.map((r) => `\`${r}\``).join(", ")}`,
    ...(params.governance
      ? [
          `- **Governance**: \`${params.governance.ready ? "ready" : "unready"}\` (policy, backlog, defects, session)`,
        ]
      : []),
    `- **Status**: Substrate ready for wake (\`mind:wake --run ${params.runRoot}\`).`,
    ...nextActionsBlock(mindInitNextActions(params.runRoot)),
  ].join("\n");
  return enforceLineLimit(md, 30);
}
