import { loadRun } from "../../engine/store/index.ts";
import { decideProposal } from "../../mind/proposal.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import { recordAuthorityDecision } from "../../workflow/authority/record-authority-decision.ts";
import { HarnessError } from "../../core/errors/harness-error.ts";
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

  const rawRun = loadRun(run);
  const rawState = rawRun.state as Record<string, unknown>;
  if (rawState.mind || Array.isArray(rawState.candidates)) {
    const proposal = decideProposal(run, requirementId, actor, {
      decision: decision as "grant" | "decline",
      rationale,
    });
    const md = [
      `### Authority Decision Recorded: \`${requirementId}\``,
      `- **Decision**: ${decision.toUpperCase()}`,
      `- **Rationale**: ${rationale}`,
      `- **Decided By**: \`${actor}\``,
      `- **Candidate**: \`${proposal.id}\``,
      `- **Witness**: \`${proposal.witness ?? "none"}\``,
    ].join("\n");
    return {
      markdown: enforceLineLimit(md, 30),
      run_root: run,
      proposal,
    };
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
