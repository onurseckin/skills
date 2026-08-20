import { enforceLineLimit } from "./line-limiter.ts";

export interface OrchestrateBriefParams {
  readonly runId: string;
  readonly runRoot: string;
  readonly promptSha256: string;
  readonly promptBytes: number;
  readonly runIdWasDerived: boolean;
}

/**
 * The brief IS the "opening sequence" contract B16 asks for: the harness cannot read the repo or
 * decompose the work itself (R9 — it never calls a model), so this hands the calling agent the
 * fixed next-step checklist, bound to the run `orchestrate` just opened, instead of leaving it to
 * reconstruct the sequence from the playbook by hand.
 */
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
    "**Next, in order — nothing here is optional and nothing is done for you:**",
    "1. Read the repository yourself, then record what you found with `plan:enhance` " +
      `(\`--run ${params.runRoot}\`). The harness invents nothing here; every field is your claim.`,
    "2. Register each task with `plan:add`, one disjoint write scope per task, bound to the",
    "   prompt lines it implements.",
    "3. `plan:compile --completion-gate \"<the whole-run gate>\"` — this also records the topology",
    "   every later reader uses instead of re-deriving parallelism.",
    "4. `queue:wave` to see what is claimable, then register and dispatch an implementer paired",
    "   with its own independent validator for every claimable task. Never one without the other.",
    "",
    "Full command reference: `references/cli-capabilities.md`. Phase-by-phase detail if a step is",
    "unclear: `references/run-playbook.md`.",
  ].join("\n");
  return enforceLineLimit(md, 30);
}
