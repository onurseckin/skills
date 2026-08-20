import { workflowPort } from "../../integration/store-ports.ts";
import { dispositionOrphanEvidence } from "../../workflow/orphan-evidence/disposition.ts";
import { enforceLineLimit } from "../formatters/line-limiter.ts";
import { listFlag, textFlag, type Flags } from "../options.ts";

/**
 * Undisposed orphan evidence blocks completion (see completionIssues). Disposing it is a
 * coordinator judgement call, never a silent drop: a rationale and command evidence are mandatory,
 * matching every other terminal recorded decision in the harness.
 */
export function orphanDisposeCommand(flags: Flags): Record<string, unknown> {
  const run = textFlag(flags, "run")!;
  const actor = textFlag(flags, "actor")!;
  const orphanSha = textFlag(flags, "orphan-sha256")!;
  const disposition = textFlag(flags, "disposition")!;
  const rationale = textFlag(flags, "rationale")!;
  const evidenceIds = listFlag(flags, "evidence", true)!;

  const state = dispositionOrphanEvidence(workflowPort(run), actor, {
    orphan_sha256: orphanSha,
    disposition,
    rationale,
    evidence: evidenceIds.map((id) => ({ command_id: id })),
  });
  const recorded = (state.orphan_evidence_dispositions ?? []).find(
    (entry) => entry.orphan_sha256 === orphanSha,
  )!;
  const md = [
    `### Orphan Evidence Dispositioned: \`${orphanSha}\``,
    `- **Disposition**: ${recorded.disposition}`,
    `- **Rationale**: ${recorded.rationale}`,
    `- **Recorded By**: \`${actor}\``,
  ].join("\n");
  return {
    markdown: enforceLineLimit(md, 30),
    run_root: run,
    disposition: recorded,
    orphan_evidence_dispositions: state.orphan_evidence_dispositions,
  };
}
