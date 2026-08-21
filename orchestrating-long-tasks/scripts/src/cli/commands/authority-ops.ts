import { workflowPort } from "../../integration/store-ports.ts";
import { recordAuthorityDecision } from "../../workflow/authority/record-authority-decision.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { enforceLineLimit } from "../formatters/line-limiter.ts";
import { textFlag, type Flags } from "../options.ts";

export function authorityDecideCommand(flags: Flags): Record<string, unknown> {
  const run = textFlag(flags, "run")!;
  const requirementId = textFlag(flags, "requirement")!;
  const actor = textFlag(flags, "actor")!;
  const decision = textFlag(flags, "decision")!;
  const rationale = textFlag(flags, "rationale")!;
  if (decision !== "grant" && decision !== "decline") {
    throw new HarnessError("INVALID_ARGUMENT", "--decision must be grant or decline");
  }

  const state = recordAuthorityDecision(workflowPort(run), requirementId, actor, {
    decision,
    rationale,
  });
  const requirement = state.requirements.find((entry) => entry.id === requirementId);
  const md = [
    `### Authority Decision Recorded: \`${requirementId}\``,
    `- **Decision**: ${decision.toUpperCase()}`,
    `- **Rationale**: ${rationale}`,
    `- **Decided By**: \`${actor}\``,
  ].join("\n");
  return {
    markdown: enforceLineLimit(md, 30),
    run_root: run,
    requirement: requirement ?? null,
  };
}
