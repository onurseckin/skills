import { enforceLineLimit } from "./line-limiter.ts";

export interface OrchestrateBriefParams {
  readonly runId: string;
  readonly runRoot: string;
  readonly promptSha256: string;
  readonly promptBytes: number;
  readonly runIdWasDerived: boolean;
}

export function formatOrchestrateBrief(params: OrchestrateBriefParams): string {
  const md = [
    `### Orchestration Opened: ${params.runId}`,
    `- **Capsule Root**: \`${params.runRoot}\``,
    `- **Prompt SHA-256**: \`${params.promptSha256}\` (${params.promptBytes.toLocaleString()} bytes, captured verbatim)`,
    params.runIdWasDerived
      ? "- **Run id**: derived from the prompt; pass `--run` next time to choose your own."
      : "- **Run id**: the one you supplied.",
    "- **This skill is now driving.** Stand down the host's own todo/workflow tool for this run;",
    "  every step below is recorded in the capsule instead.",
    "",
    "**Exactly one next step — nothing here is optional and nothing is done for you:**",
    `1. Register and dispatch a single Tier 1 orchestrator (\`--run ${params.runRoot}\`), bound to`,
    "   `roles/orchestrator.md` and `agents/orchestrator.yaml`. Do not read the repository, stage",
    "   tasks, compile the graph, or dispatch a coordinator or any implementer/validator yourself —",
    "   every one of those is the orchestrator's job, never the caller's.",
    "",
    "The orchestrator dispatches exactly one Tier 2 coordinator per round; the coordinator dispatches",
    "every planner, plan-validator, implementer, validator and completeness-critic the round needs;",
    "the orchestrator composes the finished report and hands it back to you. Nothing here is bubbled",
    "up half-done.",
    "",
    "Tier ladder and per-host dispatch: `references/host-adapters.md`. Full command reference:",
    "`references/cli-capabilities.md`. Phase-by-phase detail: `references/run-playbook.md`.",
  ].join("\n");
  return enforceLineLimit(md, 30);
}
