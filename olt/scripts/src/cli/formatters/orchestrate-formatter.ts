import { enforceLineLimit } from "./line-limiter.ts";
import { nextActionsBlock } from "./next-actions.ts";

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
    "   `roles/orchestrator.md` and `agents/orchestrator.yaml`.",
    "",
    "The orchestrator dispatches exactly one Tier 2 coordinator per round; the coordinator dispatches",
    "the execution subagents. The orchestrator composes the finished report and hands it back.",
    ...nextActionsBlock([
      {
        command: `bun harness.ts agent:register --run ${params.runRoot} --agent orchestrator-1 --role orchestrator --host <HOST>`,
        role: "Orchestrator",
        description: "Register Tier 1 autonomous orchestrator",
      },
    ]),
    "",
    "Tier ladder: `references/host-adapters.md`. Command reference: `references/cli-capabilities.md`.",
  ].join("\n");
  return enforceLineLimit(md, 30);
}
